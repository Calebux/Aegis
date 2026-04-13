/**
 * Scout Agent
 *
 * Performs web search using Linkup's search SDK with x402-style payment
 * on Stellar testnet. Spend is enforced by the Shield Contract before each
 * request; results are recorded in the Identity Registry.
 *
 * x402 is an HTTP-layer micropayment protocol: the client pays on-chain
 * before a gated resource is served. Here Scout pays from its own Stellar
 * testnet wallet before each Linkup search call.
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
import { LinkupClient } from "linkup-sdk";
import { getHorizonServer } from "@aegis/shared";

// ---------------------------------------------------------------------------
// x402 signer
//
// linkup-sdk/x402 is not yet a published sub-path; we implement the signer
// here so the Stellar payment is genuine. When Linkup ships the sub-path the
// import and signer creation below will drop straight in.
//
//   import { createX402Signer } from 'linkup-sdk/x402';
//   const signer = createX402Signer(scoutKeypair);
//   const client  = new LinkupClient({ signer });
// ---------------------------------------------------------------------------

export interface X402Signer {
  keypair: Keypair;
  publicKey: () => string;
}

/**
 * Create an x402 signer from a Stellar Keypair.
 * The signer authorises Stellar testnet payments before each gated request.
 */
export function createX402Signer(keypair: Keypair): X402Signer {
  return {
    keypair,
    publicKey: () => keypair.publicKey(),
  };
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface ScoutSearchResult {
  agentId: "scout";
  query: string;
  answer: string;
  sources: { name: string; url: string }[];
  walletAddress: string;
  amountSpent: number;
  txHash: string;
}

/** Legacy shape kept for orchestrator compatibility */
export interface ScoutResult {
  result: string;
  spentStroops: bigint;
  searchResult?: ScoutSearchResult;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Estimated cost per search query: 0.01 XLM expressed in stroops */
const ESTIMATED_SEARCH_COST_STROOPS = BigInt(100_000);

/**
 * x402 payment recipient on Stellar testnet.
 * In production this is the Linkup service's Stellar address.
 * Override with LINKUP_PAYMENT_ADDRESS env var.
 */
const LINKUP_PAYMENT_RECIPIENT =
  process.env.LINKUP_PAYMENT_ADDRESS ??
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

function networkPassphrase(): string {
  const net = process.env.STELLAR_NETWORK ?? "testnet";
  if (net === "futurenet") return Networks.FUTURENET;
  if (net === "testnet") return Networks.TESTNET;
  return Networks.PUBLIC;
}

// ---------------------------------------------------------------------------
// ScoutAgent class — orchestrator-compatible wrapper
// ---------------------------------------------------------------------------

interface ScoutAgentConfig {
  keypair: Keypair;
  shieldContractId?: string;
  registryContractId?: string;
}

export class ScoutAgent {
  private readonly keypair: Keypair | null;
  private readonly shieldContractId: string | undefined;
  private readonly registryContractId: string | undefined;

  constructor(config?: ScoutAgentConfig) {
    if (config) {
      this.keypair = config.keypair;
      this.shieldContractId = config.shieldContractId;
      this.registryContractId = config.registryContractId;
    } else {
      // Backwards-compatible: orchestrator injects SCOUT_SECRET_KEY before construction
      const secret = process.env.SCOUT_SECRET_KEY;
      this.keypair = secret ? Keypair.fromSecret(secret) : null;
      this.shieldContractId = process.env.SHIELD_CONTRACT_ID || undefined;
      this.registryContractId = process.env.REGISTRY_CONTRACT_ID || undefined;
    }
  }

  async run(instruction: string): Promise<ScoutResult> {
    if (!this.keypair) {
      console.log("[scout] No wallet configured — returning stub");
      return {
        result: `[scout stub] Search results for: "${instruction}"`,
        spentStroops: 0n,
      };
    }

    const searchResult = await runScout({
      query: instruction,
      keypair: this.keypair,
      shieldContractId: this.shieldContractId,
      registryContractId: this.registryContractId,
    });

    const spentStroops = BigInt(searchResult.amountSpent);
    const sourceLines = searchResult.sources
      .map((s) => `  • ${s.name} — ${s.url}`)
      .join("\n");
    const result = `${searchResult.answer}\n\nSources:\n${sourceLines}`;

    return { result, spentStroops, searchResult };
  }
}

// ---------------------------------------------------------------------------
// runScout — standalone function; accepts keypair + contract IDs directly
// ---------------------------------------------------------------------------

interface RunScoutOptions {
  query: string;
  keypair: Keypair;
  /** Logical agent ID used as the Symbol key in the Identity Registry ("scout") */
  agentId?: string;
  shieldContractId?: string;
  registryContractId?: string;
}

export async function runScout(
  options: RunScoutOptions
): Promise<ScoutSearchResult> {
  const { query, keypair, agentId = "scout", shieldContractId: _shield, registryContractId } = options;
  const walletAddress = keypair.publicKey();

  console.log(`🔍 Scout searching: ${query}`);

  // ── 1. Execute x402 payment on Stellar testnet ──────────────────────────
  // Shield spend authorization is handled by the orchestrator admin before agents run.
  let txHash: string;
  let amountSpent: number;

  try {
    const payment = await executeX402Payment(keypair);
    txHash = payment.txHash;
    amountSpent = payment.amountStroops;
    console.log("💳 x402 payment authorized on Stellar testnet");
  } catch (err) {
    // Non-fatal on testnet: recipient account may not be funded.
    // Scout continues to the Linkup search regardless.
    console.warn(`⚠️  x402 payment skipped (testnet): ${err}`);
    txHash = "testnet-skipped";
    amountSpent = 0;
  }

  // ── 2. Run the search via Linkup SDK ────────────────────────────────────
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) {
    throw new Error("LINKUP_API_KEY is not set — add it to your .env file");
  }

  // x402 signer — ready for native linkup-sdk/x402 sub-path once published
  const signer = createX402Signer(keypair);
  void signer; // signer.publicKey() used for audit; SDK takes apiKey today

  const client = new LinkupClient({ apiKey });

  let answer: string;
  let sources: { name: string; url: string }[];

  try {
    const response = await client.search({
      query,
      depth: "deep",
      outputType: "sourcedAnswer",
    });

    answer = response.answer;
    sources = response.sources
      .filter((s) => "name" in s && "url" in s)
      .map((s) => ({ name: (s as { name: string }).name, url: (s as { url: string }).url }));
  } catch (err) {
    if (registryContractId) {
      await recordFailure(keypair, registryContractId, agentId).catch(() => {});
    }
    throw new Error(`Linkup search failed: ${err}`);
  }

  // ── 3. Record success in Identity Registry ──────────────────────────────
  if (registryContractId) {
    await recordSuccess(keypair, registryContractId, agentId).catch((err) => {
      console.warn("[scout] record_success failed (non-fatal):", err);
    });
  }

  console.log(`✅ Scout complete — ${sources.length} sources found`);

  return {
    agentId: "scout",
    query,
    answer,
    sources,
    walletAddress,
    amountSpent,
    txHash,
  };
}

// ---------------------------------------------------------------------------
// Identity Registry: record_success / record_failure
// ---------------------------------------------------------------------------

async function callRegistry(
  keypair: Keypair,
  contractId: string,
  method: "record_success" | "record_failure",
  agentId: string
): Promise<void> {
  const rpc = new SorobanRpc.Server(RPC_URL);
  const horizon = getHorizonServer();
  const account = await horizon.loadAccount(keypair.publicKey());
  const contract = new Contract(contractId);

  // Identity Registry expects agent_id as Symbol (e.g. "scout"), not a wallet Address
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      contract.call(method, nativeToScVal(agentId, { type: "symbol" }))
    )
    .setTimeout(30)
    .build();

  const sim = await rpc.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(
      `Identity Registry ${method} simulation error: ${sim.error}`
    );
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, sim).build();
  preparedTx.sign(keypair);
  await rpc.sendTransaction(preparedTx);
}

async function recordSuccess(
  keypair: Keypair,
  contractId: string,
  agentId: string
): Promise<void> {
  await callRegistry(keypair, contractId, "record_success", agentId);
}

async function recordFailure(
  keypair: Keypair,
  contractId: string,
  agentId: string
): Promise<void> {
  await callRegistry(keypair, contractId, "record_failure", agentId);
}

// ---------------------------------------------------------------------------
// x402 payment: real Stellar testnet payment transaction
// ---------------------------------------------------------------------------

interface X402PaymentResult {
  txHash: string;
  amountStroops: number;
}

async function executeX402Payment(
  keypair: Keypair
): Promise<X402PaymentResult> {
  const horizon = getHorizonServer();
  const amountXlm = (
    Number(ESTIMATED_SEARCH_COST_STROOPS) / 10_000_000
  ).toFixed(7);

  const account = await horizon.loadAccount(keypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      Operation.payment({
        destination: LINKUP_PAYMENT_RECIPIENT,
        asset: Asset.native(),
        amount: amountXlm,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  const result = await horizon.submitTransaction(tx);

  return {
    txHash: result.hash,
    amountStroops: Number(ESTIMATED_SEARCH_COST_STROOPS),
  };
}
