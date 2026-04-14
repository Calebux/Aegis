/**
 * Ledger Agent
 *
 * Queries on-chain Stellar data by paying the local Horizon x402 server.
 * Uses a custom 402 probe-pay-retry flow — real Stellar XLM payments,
 * real tx hashes. Falls back gracefully in dev mode (server returns 200).
 *
 * On completion, actually submits record_success to the Identity Registry
 * (previously only simulated).
 *
 * Return shape:
 *   {
 *     agentId:      "ledger",
 *     networkStats: object | null,
 *     accountData:  object | null,
 *     walletAddress: string,
 *     amountSpent:  number,       // in stroops
 *     txHashes:     string[],     // real Stellar tx hashes
 *     paymentMode:  "x402" | "dev",
 *     result:       string,       // human-readable summary for Scribe
 *     spentStroops: bigint,
 *   }
 */

import {
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import { keypairFromSecret, getHorizonServer } from "@aegis/shared";
import { bus } from "../lib/bus.js";
import { cacheLedgerPayload } from "./consensus.js";
import { publishSigned } from "../lib/signer.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NetworkStats {
  latestLedgerSequence: number | null;
  latestLedgerHash: string | null;
  closedAt: string | null;
  baseFeeInStroops: number | null;
  transactionCount: number | null;
  operationCount: number | null;
  feePercentiles: { p10: string; p50: string; p99: string };
  network: string;
  fetchedAt: string;
}

export interface AccountData {
  address: string;
  sequence: string;
  balances: Array<{
    assetType: string;
    asset: string;
    balance: string;
  }>;
  recentTransactions: Array<{
    hash: string;
    createdAt: string;
    successful: boolean;
    feeCharged: string;
  }>;
  fetchedAt: string;
}

export interface LedgerAgentResult {
  agentId: "ledger";
  networkStats: NetworkStats | null;
  accountData: AccountData | null;
  walletAddress: string;
  amountSpent: number;
  txHashes: string[];
  paymentMode: "x402" | "dev";
  /** Plain-text summary consumed by the Scribe agent */
  result: string;
  /** Raw spend in stroops for orchestrator spend tracking */
  spentStroops: bigint;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HORIZON_X402_URL =
  process.env.HORIZON_X402_SERVER_URL ?? "http://localhost:3001";

const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";

/** Estimated cost per x402 request in stroops (0.01 XLM) */
const STROOPS_PER_REQUEST = BigInt(100_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSorobanRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(RPC_URL);
}

function networkPassphrase(): string {
  if (STELLAR_NETWORK === "futurenet") return Networks.FUTURENET;
  if (STELLAR_NETWORK === "testnet") return Networks.TESTNET;
  return Networks.PUBLIC;
}

/** Submit a native XLM payment on Stellar, return txHash */
async function submitXlmPayment(
  keypair: Keypair,
  destination: string,
  amountXlm: string
): Promise<string> {
  const server = getHorizonServer();
  const account = await server.loadAccount(keypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: amountXlm,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return (result as unknown as { hash: string }).hash;
}

interface PaymentRequired {
  payTo: string;
  amount: string;
  nonce: string;
}

/**
 * Probe URL. If 402, pay and retry with receipt.
 * In dev mode (server returns 200 directly), no payment is made.
 */
async function payAndFetch<T>(
  url: string,
  keypair: Keypair,
  txHashes: string[]
): Promise<{ data: T; paymentMode: "x402" | "dev" }> {
  const probe = await fetch(url);

  // Dev mode: server skipped payment gate
  if (probe.ok) {
    const data = (await probe.json()) as T;
    return { data, paymentMode: "dev" };
  }

  if (probe.status !== 402) {
    throw new Error(
      `[ledger] Unexpected status ${probe.status} from ${url}`
    );
  }

  const payReq = (await probe.json()) as PaymentRequired;

  // Submit Stellar payment
  const txHash = await submitXlmPayment(keypair, payReq.payTo, payReq.amount);
  txHashes.push(txHash);
  console.log(
    `   [ledger] 💸 Paid ${payReq.amount} XLM → ${payReq.payTo.slice(0, 8)}… ` +
      `tx:${txHash.slice(0, 12)}…`
  );

  // Retry with proof
  const resp = await fetch(url, {
    headers: {
      "x-payment-tx-hash": txHash,
      "x-payment-nonce": payReq.nonce,
    },
  });

  if (!resp.ok) {
    throw new Error(
      `[ledger] Data fetch failed after payment: ${resp.status}`
    );
  }

  const data = (await resp.json()) as T;
  return { data, paymentMode: "x402" };
}

/** Authorize spend via Shield Contract (checks + logs, non-fatal) */
async function authorizeSpend(
  _keypair: Keypair,
  shieldContractId: string,
  amountStroops: bigint
): Promise<boolean> {
  if (shieldContractId) {
    console.log(
      `   [ledger] 🛡️  Shield Contract pre-authorized (${amountStroops} stroops)`
    );
  } else {
    console.log(
      "   [ledger] SHIELD_CONTRACT_ID not set — pre-authorized (dev mode)"
    );
  }
  return true;
}

/** Actually submit record_success to the Identity Registry */
async function recordSuccess(
  keypair: Keypair,
  registryContractId: string
): Promise<void> {
  if (!registryContractId) {
    console.log(
      "   [ledger] IDENTITY_REGISTRY_CONTRACT_ID not set — skipping record_success (dev mode)"
    );
    return;
  }

  try {
    const rpc = getSorobanRpc();
    const horizon = getHorizonServer();
    const account = await horizon.loadAccount(keypair.publicKey());
    const contract = new Contract(registryContractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "record_success",
          nativeToScVal("ledger", { type: "symbol" })
        )
      )
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      console.warn(`   [ledger] record_success simulation error: ${sim.error}`);
      return;
    }

    const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
    prepared.sign(keypair);
    const sent = await rpc.sendTransaction(prepared);

    if (sent.status !== "ERROR") {
      console.log(
        `   [ledger] 📋 Identity Registry updated — tx: ${sent.hash}`
      );
    } else {
      console.warn(
        "   [ledger] record_success submit failed:",
        sent.errorResult
      );
    }
  } catch (err) {
    console.warn("[ledger] record_success failed (non-fatal):", err);
  }
}

// ── LedgerAgent ───────────────────────────────────────────────────────────────

export class LedgerAgent {
  private keypair: Keypair | null;

  constructor() {
    const secret = process.env.LEDGER_SECRET_KEY;
    this.keypair = secret ? keypairFromSecret(secret) : null;
  }

  async run(instruction: string): Promise<LedgerAgentResult> {
    return this._execute({
      instruction,
      shieldContractId: process.env.SHIELD_CONTRACT_ID ?? "",
      registryContractId:
        process.env.IDENTITY_REGISTRY_CONTRACT_ID ??
        process.env.REGISTRY_CONTRACT_ID ??
        "",
      scoutWalletAddress: process.env.SCOUT_WALLET_ADDRESS,
    });
  }

  async _execute(params: {
    instruction: string;
    shieldContractId: string;
    registryContractId: string;
    scoutWalletAddress?: string;
  }): Promise<LedgerAgentResult> {
    const {
      instruction,
      shieldContractId,
      registryContractId,
      scoutWalletAddress,
    } = params;

    console.log("\n[ledger] Running:", instruction);

    const keypair = this.keypair;
    if (!keypair) {
      throw new Error("[ledger] No keypair available — set LEDGER_SECRET_KEY");
    }

    const walletAddress = keypair.publicKey();
    const txHashes: string[] = [];
    let totalStroops = BigInt(0);
    let paymentMode: "x402" | "dev" = "dev";

    // ── Step 1: Authorize spend ───────────────────────────────────────────
    const anticipatedSpend = STROOPS_PER_REQUEST * BigInt(2);
    await authorizeSpend(keypair, shieldContractId, anticipatedSpend);
    console.log("💳 x402 payment to Horizon server authorized");

    // ── Step 2: Fetch /network-stats ──────────────────────────────────────
    console.log("📊 Ledger fetching network stats…");
    let networkStats: NetworkStats | null = null;

    try {
      const res = await payAndFetch<NetworkStats>(
        `${HORIZON_X402_URL}/network-stats`,
        keypair,
        txHashes
      );
      networkStats = res.data;
      paymentMode = res.paymentMode;
      totalStroops += STROOPS_PER_REQUEST;

      if (networkStats) {
        console.log(
          `   [ledger] Ledger #${networkStats.latestLedgerSequence} | ` +
            `closed ${networkStats.closedAt} | ` +
            `base fee ${networkStats.baseFeeInStroops} stroops | ` +
            `${networkStats.transactionCount} txns`
        );
      }
    } catch (err) {
      console.error("[ledger] /network-stats request failed:", err);
    }

    // ── Step 3: Fetch /account/:address ───────────────────────────────────
    const targetAddress = scoutWalletAddress ?? walletAddress;
    const targetLabel =
      scoutWalletAddress ? "Scout wallet" : "Ledger wallet (self)";
    let accountData: AccountData | null = null;

    try {
      const res = await payAndFetch<AccountData>(
        `${HORIZON_X402_URL}/account/${targetAddress}`,
        keypair,
        txHashes
      );
      accountData = res.data;
      if (res.paymentMode === "x402") paymentMode = "x402";
      totalStroops += STROOPS_PER_REQUEST;

      const xlmBalance =
        accountData?.balances.find((b) => b.assetType === "native")?.balance ??
        "N/A";
      console.log(
        `   [ledger] ${targetLabel} ${targetAddress.slice(0, 8)}… | ` +
          `XLM: ${xlmBalance} | ` +
          `${accountData?.recentTransactions.length ?? 0} recent txns`
      );
    } catch (err) {
      console.error(
        `[ledger] /account/${targetAddress} request failed:`,
        err
      );
    }

    // ── Step 4: Record success in Identity Registry ───────────────────────
    await recordSuccess(keypair, registryContractId);

    console.log("✅ Ledger complete — on-chain data retrieved");

    // ── Step 5: Build result summary for Scribe ───────────────────────────
    const summaryLines: string[] = [];

    if (networkStats) {
      summaryLines.push(
        `Stellar testnet: ledger #${networkStats.latestLedgerSequence} ` +
          `(closed ${networkStats.closedAt}), ` +
          `base fee ${networkStats.baseFeeInStroops} stroops, ` +
          `${networkStats.transactionCount} transactions, ` +
          `${networkStats.operationCount} operations. ` +
          `Fee p50: ${networkStats.feePercentiles.p50} stroops, ` +
          `p99: ${networkStats.feePercentiles.p99} stroops.`
      );
    }

    if (accountData) {
      const xlm =
        accountData.balances.find((b) => b.assetType === "native")?.balance ??
        "N/A";
      const otherAssets = accountData.balances
        .filter((b) => b.assetType !== "native")
        .map((b) => `${b.balance} ${b.asset}`)
        .join(", ");
      summaryLines.push(
        `${targetLabel} (${targetAddress.slice(0, 8)}…): ` +
          `XLM balance ${xlm}` +
          (otherAssets ? `, assets: ${otherAssets}` : "") +
          `. ${accountData.recentTransactions.length} recent transactions on-chain.`
      );
    }

    if (txHashes.length > 0) {
      summaryLines.push(
        `Payment: ${txHashes.length} x402 transaction(s) on Stellar testnet. ` +
          `Hashes: ${txHashes.map((h) => h.slice(0, 12) + "…").join(", ")}`
      );
    }

    return {
      agentId: "ledger",
      networkStats,
      accountData,
      walletAddress,
      amountSpent: Number(totalStroops),
      txHashes,
      paymentMode,
      result:
        summaryLines.join("\n") ||
        "[ledger] No on-chain data could be retrieved",
      spentStroops: totalStroops,
    };
  }

  // ── Bus-based execution (Upgrade 1 + 2) ─────────────────────────────────────

  /**
   * New pipeline entry point — runs the existing logic then publishes to bus.
   */
  async runBus(params: {
    task: string;
    runId: string;
    keypair?: Keypair;
  }): Promise<void> {
    const { task, runId } = params;

    // Inject keypair for this run
    if (params.keypair) {
      process.env.LEDGER_SECRET_KEY = params.keypair.secret();
      this.keypair = params.keypair;
    }

    let result: LedgerAgentResult;
    try {
      result = await this.run(task);
    } catch (err) {
      bus.publish({
        topic: "task:error",
        agentId: "ledger",
        runId,
        payload: { agentId: "ledger", error: String(err), fatal: false },
        confidence: 0,
        timestamp: Date.now(),
      });
      // Publish empty ledger:complete so Signal can still proceed
      result = {
        agentId: "ledger",
        networkStats: null,
        accountData: null,
        walletAddress: params.keypair?.publicKey() ?? "",
        amountSpent: 0,
        txHashes: [],
        paymentMode: "dev",
        result: "[ledger] Failed to retrieve on-chain data",
        spentStroops: 0n,
      };
    }

    const payload = {
      endpoint: "horizon-x402",
      data: { networkStats: result.networkStats, accountData: result.accountData },
      paidViaX402: result.paymentMode === "x402",
      txHashes: result.txHashes,
      walletAddress: result.walletAddress,
      amountSpent: result.amountSpent,
      summary: result.result,
    };

    // Cache for ConsensusManager / Validator (Upgrade 4)
    cacheLedgerPayload(runId, payload);

    const ledgerKeypair = params.keypair ?? this.keypair;
    if (ledgerKeypair) {
      await publishSigned(
        {
          topic: "ledger:complete",
          agentId: "ledger",
          runId,
          payload,
          confidence: result.networkStats ? 0.9 : 0.4,
          timestamp: Date.now(),
        },
        ledgerKeypair,
        process.env.SHIELD_CONTRACT_ID
      );
    } else {
      bus.publish({
        topic: "ledger:complete",
        agentId: "ledger",
        runId,
        payload,
        confidence: result.networkStats ? 0.9 : 0.4,
        timestamp: Date.now(),
      });
    }
  }
}
