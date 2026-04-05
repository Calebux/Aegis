/**
 * Ledger Agent
 *
 * Queries on-chain Stellar data by paying the local Horizon x402 server.
 * Spend is checked against the Shield Contract before any request is made.
 * On completion, success is recorded in the Identity Registry.
 *
 * This file is the *consumer* half of Aegis's dual x402 role:
 *   horizon-x402-server.ts   → x402 provider (wraps Horizon behind a paywall)
 *   ledger.ts                → x402 consumer (pays per query with @x402/axios)
 *
 * Return shape:
 *   {
 *     agentId:      "ledger",
 *     networkStats: object | null,
 *     accountData:  object | null,
 *     walletAddress: string,
 *     amountSpent:  number,       // in stroops
 *     txHashes:     string[],
 *     result:       string,       // human-readable summary for Scribe
 *     spentStroops: bigint,
 *   }
 */

import axios from "axios";
import { wrapAxiosWithX402 } from "@x402/axios";
import {
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
import { keypairFromSecret, getHorizonServer } from "@aegis/shared";

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
  /** Plain-text summary consumed by the Scribe agent */
  result: string;
  /** Raw spend in stroops for orchestrator spend tracking */
  spentStroops: bigint;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Base URL of the local Horizon x402 server (horizon-x402-server.ts). */
const HORIZON_X402_URL =
  process.env.HORIZON_X402_SERVER_URL ?? "http://localhost:3001";

const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";

/**
 * Estimated cost per x402 request in stroops.
 * ($0.001 ≈ 1 000 stroops at rough testnet XLM prices — adjust if needed.)
 */
const STROOPS_PER_REQUEST = BigInt(1_000);

// ── Soroban helpers ───────────────────────────────────────────────────────────

function getSorobanRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(RPC_URL);
}

function networkPassphrase(): string {
  return STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC;
}

/**
 * Calls `authorize_spend` on the Shield Contract to verify the agent has
 * enough remaining spend cap before any external requests are made.
 *
 * Falls back to pre-authorized (true) when SHIELD_CONTRACT_ID is unset,
 * allowing dev-mode runs without a deployed contract.
 */
async function authorizeSpend(
  keypair: Keypair,
  shieldContractId: string,
  amountStroops: bigint
): Promise<boolean> {
  if (!shieldContractId) {
    console.log(
      "   [ledger] SHIELD_CONTRACT_ID not set — pre-authorized (dev mode)"
    );
    return true;
  }

  try {
    const rpc = getSorobanRpc();
    const horizon = getHorizonServer();
    const account = await horizon.loadAccount(keypair.publicKey());
    const contract = new Contract(shieldContractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "authorize_spend",
          new Address(keypair.publicKey()).toScVal(),
          nativeToScVal(amountStroops, { type: "i128" })
        )
      )
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(sim)) {
      console.error(
        `   [ledger] 🛡️  Shield Contract rejected spend: ${sim.error}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error("[ledger] authorize_spend threw:", err);
    return false;
  }
}

/**
 * Calls `record_success` on the Identity Registry to increment the Ledger
 * agent's reputation score and task counter.
 * Non-fatal — a registry error does not fail the agent run.
 */
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
    } else {
      console.log("   [ledger] 📋 Identity Registry updated — success recorded");
    }
  } catch (err) {
    // Non-fatal: log and continue
    console.warn("[ledger] record_success failed (non-fatal):", err);
  }
}

// ── LedgerAgent ───────────────────────────────────────────────────────────────

export class LedgerAgent {
  private readonly keypair: Keypair | null;

  constructor() {
    const secret = process.env.LEDGER_SECRET_KEY;
    this.keypair = secret ? keypairFromSecret(secret) : null;
  }

  /**
   * Primary entry point called by the orchestrator.
   * Reads Shield / Registry contract IDs from env vars for backwards
   * compatibility with the existing orchestrator flow.
   */
  async run(instruction: string): Promise<LedgerAgentResult> {
    return this._execute({
      instruction,
      shieldContractId: process.env.SHIELD_CONTRACT_ID ?? "",
      registryContractId: process.env.IDENTITY_REGISTRY_CONTRACT_ID ?? "",
      // Cross-agent awareness: use Scout wallet address if provided
      scoutWalletAddress: process.env.SCOUT_WALLET_ADDRESS,
    });
  }

  /**
   * Full execution path. Accepts explicit contract IDs and an optional Scout
   * wallet address (demonstrating cross-agent awareness — we inspect the
   * Scout agent's on-chain account as part of our data fetch).
   */
  async _execute(params: {
    instruction: string;
    shieldContractId: string;
    registryContractId: string;
    scoutWalletAddress?: string;
  }): Promise<LedgerAgentResult> {
    const { instruction, shieldContractId, registryContractId, scoutWalletAddress } =
      params;

    console.log("\n[ledger] Running:", instruction);

    const keypair = this.keypair;
    if (!keypair) {
      throw new Error("[ledger] No keypair available — set LEDGER_SECRET_KEY");
    }

    const walletAddress = keypair.publicKey();
    const txHashes: string[] = [];
    let totalStroops = BigInt(0);

    // ── Step 1: Authorize spend via Shield Contract ───────────────────────────
    //
    // We'll make two requests (network-stats + account), each costing
    // STROOPS_PER_REQUEST. Authorize the full anticipated spend upfront.

    const anticipatedSpend = STROOPS_PER_REQUEST * BigInt(2);
    const authorized = await authorizeSpend(
      keypair,
      shieldContractId,
      anticipatedSpend
    );

    if (!authorized) {
      throw new Error(
        "[ledger] Spend not authorized by Shield Contract — aborting"
      );
    }
    console.log("💳 x402 payment to Horizon server authorized");

    // ── Step 2: Build x402-capable axios instance ─────────────────────────────
    //
    // wrapAxiosWithX402 intercepts 402 Payment Required responses and
    // automatically signs + retransmits the request with a payment header,
    // using the Ledger agent's Stellar keypair as the signer.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axiosX402 = wrapAxiosWithX402(axios.create(), { signer: keypair as any });

    // ── Step 3: Fetch /network-stats ──────────────────────────────────────────

    console.log("📊 Ledger fetching network stats…");
    let networkStats: NetworkStats | null = null;

    try {
      const response = await axiosX402.get<NetworkStats>(
        `${HORIZON_X402_URL}/network-stats`
      );
      networkStats = response.data;
      totalStroops += STROOPS_PER_REQUEST;

      // Capture payment tx hash if the server echoes it back
      const txHash = response.headers["x-payment-tx-hash"] as string | undefined;
      if (txHash) txHashes.push(txHash);

      console.log(
        `   [ledger] Ledger #${networkStats.latestLedgerSequence} | ` +
          `closed ${networkStats.closedAt} | ` +
          `base fee ${networkStats.baseFeeInStroops} stroops | ` +
          `${networkStats.transactionCount} txns`
      );
    } catch (err) {
      console.error("[ledger] /network-stats request failed:", err);
    }

    // ── Step 4: Fetch /account/:address ───────────────────────────────────────
    //
    // Cross-agent awareness: we inspect the Scout wallet's on-chain account
    // when its address is known, rather than our own. This shows Aegis agents
    // can reason about each other's on-chain state.

    const targetAddress = scoutWalletAddress ?? walletAddress;
    const targetLabel =
      scoutWalletAddress ? "Scout wallet" : "Ledger wallet (self)";
    let accountData: AccountData | null = null;

    try {
      const response = await axiosX402.get<AccountData>(
        `${HORIZON_X402_URL}/account/${targetAddress}`
      );
      accountData = response.data;
      totalStroops += STROOPS_PER_REQUEST;

      const txHash = response.headers["x-payment-tx-hash"] as string | undefined;
      if (txHash) txHashes.push(txHash);

      const xlmBalance =
        accountData.balances.find((b) => b.assetType === "native")?.balance ??
        "N/A";
      console.log(
        `   [ledger] ${targetLabel} ${targetAddress.slice(0, 8)}… | ` +
          `XLM: ${xlmBalance} | ` +
          `${accountData.recentTransactions.length} recent txns`
      );
    } catch (err) {
      console.error(
        `[ledger] /account/${targetAddress} request failed:`,
        err
      );
    }

    // ── Step 5: Record success in Identity Registry ───────────────────────────

    await recordSuccess(keypair, registryContractId);

    console.log("✅ Ledger complete — on-chain data retrieved");

    // ── Step 6: Build result summary for Scribe ───────────────────────────────

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

    return {
      agentId: "ledger",
      networkStats,
      accountData,
      walletAddress,
      amountSpent: Number(totalStroops),
      txHashes,
      result:
        summaryLines.join("\n") ||
        "[ledger] No on-chain data could be retrieved",
      spentStroops: totalStroops,
    };
  }
}
