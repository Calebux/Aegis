/**
 * Scout Agent
 *
 * Performs deep web search using the Linkup SDK with x402 micropayment tracking
 * on Stellar testnet. Spend is enforced by the Shield Contract before each
 * query; outcomes are recorded on the Identity Registry.
 *
 * Flow:
 *  1. Simulate `authorize_spend` on the Shield Contract — fail fast if cap
 *     exceeded or agent inactive.
 *  2. Execute a Stellar XLM micropayment as x402 proof-of-payment.
 *  3. Run Linkup deep search (`outputType: "sourcedAnswer"`).
 *  4. Call `record_success` / `record_failure` on the Identity Registry.
 *  5. Return structured result.
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
import { getHorizonServer } from "@aegis/shared";
import { LinkupClient } from "linkup-sdk";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Estimated x402 cost per Linkup deep search: 0.1 XLM in stroops. */
const SEARCH_COST_STROOPS = 1_000_000n;

// ── Public types ──────────────────────────────────────────────────────────────

export interface ScoutSource {
  name: string;
  url: string;
}

export interface ScoutSearchResult {
  agentId: "scout";
  query: string;
  answer: string;
  sources: ScoutSource[];
  walletAddress: string;
  amountSpent: number;
  txHash: string;
}

/** Legacy result shape for the orchestrator dispatch loop. */
export interface ScoutResult {
  result: string;
  spentStroops: bigint;
}

export interface ScoutAgentConfig {
  keypair: Keypair;
  shieldContractId: string;
  registryContractId: string;
}

// ── Scout Agent ───────────────────────────────────────────────────────────────

export class ScoutAgent {
  private readonly keypair: Keypair;
  private readonly shieldContractId: string;
  private readonly registryContractId: string;
  private readonly rpcUrl: string;
  private readonly network: string;

  constructor(config: ScoutAgentConfig) {
    this.keypair = config.keypair;
    this.shieldContractId = config.shieldContractId;
    this.registryContractId = config.registryContractId;
    this.rpcUrl =
      process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
    this.network = process.env.STELLAR_NETWORK ?? "testnet";
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getSorobanRpc(): SorobanRpc.Server {
    return new SorobanRpc.Server(this.rpcUrl);
  }

  private networkPassphrase(): string {
    return this.network === "testnet" ? Networks.TESTNET : Networks.PUBLIC;
  }

  /**
   * Simulate `authorize_spend` on the Shield Contract.
   *
   * The Shield Contract is admin-gated; the orchestrator registers agents and
   * sets spend caps before dispatch. Simulation surfaces contract-level errors
   * (CapExceeded, AgentInactive, AgentNotFound) before a Linkup query is made,
   * so we abort cleanly without wasting credits.
   */
  private async authorizeSpend(estimatedCostStroops: bigint): Promise<void> {
    if (!this.shieldContractId) {
      return; // dev mode — no contract deployed
    }

    const rpc = this.getSorobanRpc();
    const horizon = getHorizonServer();
    const account = await horizon.loadAccount(this.keypair.publicKey());
    const contract = new Contract(this.shieldContractId);

    // Shield Contract authorize_spend(agent_id: String, amount: i128)
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "authorize_spend",
          nativeToScVal("scout", { type: "string" }),
          nativeToScVal(estimatedCostStroops, { type: "i128" })
        )
      )
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(
        `Shield Contract rejected spend for scout — ${sim.error}. ` +
          `Ensure the Scout agent is registered, active, and within its spend cap.`
      );
    }
  }

  /**
   * Execute an XLM micropayment on Stellar testnet representing the x402
   * payment for the Linkup query. In production this would pay Linkup's
   * facilitator address; on testnet it uses the configured address or falls
   * back to a self-payment to demonstrate the Stellar transaction flow.
   */
  private async executeX402Payment(
    amountStroops: bigint
  ): Promise<{ txHash: string; amountSpent: number }> {
    const horizon = getHorizonServer();
    const account = await horizon.loadAccount(this.keypair.publicKey());

    const recipient =
      process.env.X402_FACILITATOR_ADDRESS ?? this.keypair.publicKey();

    // 1 XLM = 10 000 000 stroops
    const xlmAmount = (Number(amountStroops) / 10_000_000).toFixed(7);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase(),
    })
      .addOperation(
        Operation.payment({
          destination: recipient,
          asset: Asset.native(),
          amount: xlmAmount,
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(this.keypair);

    const result = await horizon.submitTransaction(tx);
    return {
      txHash: result.hash,
      amountSpent: Number(amountStroops),
    };
  }

  /**
   * Fire-and-forget a Soroban contract call to the Identity Registry.
   * Non-fatal: reputation tracking failures must never abort the search result.
   *
   * @param fn  Either "record_success" or "record_failure"
   */
  private async callRegistry(fn: "record_success" | "record_failure"): Promise<void> {
    if (!this.registryContractId) return;

    try {
      const rpc = this.getSorobanRpc();
      const horizon = getHorizonServer();
      const account = await horizon.loadAccount(this.keypair.publicKey());
      const contract = new Contract(this.registryContractId);

      // Identity Registry record_success/record_failure(agent_id: Symbol)
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase(),
      })
        .addOperation(
          contract.call(
            fn,
            nativeToScVal("scout", { type: "symbol" })
          )
        )
        .setTimeout(30)
        .build();

      const prepared = await rpc.prepareTransaction(tx);
      prepared.sign(this.keypair);

      // Send and forget — we do not block on ledger confirmation
      rpc.sendTransaction(prepared).catch((err: unknown) => {
        console.warn(`[scout] Identity Registry ${fn} send failed:`, err);
      });
    } catch (err) {
      console.warn(`[scout] Identity Registry ${fn} prepare failed:`, err);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Execute a Linkup deep search paid via x402 on Stellar testnet.
   */
  async search(query: string): Promise<ScoutSearchResult> {
    console.log(`🔍 Scout searching: ${query}`);

    // 1. Simulate authorize_spend — abort if the Shield Contract would reject
    await this.authorizeSpend(SEARCH_COST_STROOPS);

    if (!process.env.LINKUP_API_KEY) {
      throw new Error("LINKUP_API_KEY is not set — Scout cannot run");
    }

    let txHash = "";
    let amountSpent = 0;

    try {
      // 2. Execute Stellar x402 micropayment (proof of payment before query)
      const payment = await this.executeX402Payment(SEARCH_COST_STROOPS);
      txHash = payment.txHash;
      amountSpent = payment.amountSpent;
      console.log("   💳 x402 payment authorized on Stellar testnet");

      // 3. Run Linkup deep search
      const client = new LinkupClient({ apiKey: process.env.LINKUP_API_KEY });
      const response = await client.search({
        query,
        depth: "deep",
        outputType: "sourcedAnswer",
      });

      // 4. Record success on Identity Registry (non-blocking)
      void this.callRegistry("record_success");

      const sources: ScoutSource[] = (response.sources ?? [])
        .filter((s) => s.url && s.name)
        .map((s) => ({ name: s.name, url: s.url }));

      console.log(`✅ Scout complete — ${sources.length} sources found`);

      return {
        agentId: "scout",
        query,
        answer: response.answer,
        sources,
        walletAddress: this.keypair.publicKey(),
        amountSpent,
        txHash,
      };
    } catch (err) {
      // 5. Record failure on Identity Registry before re-throwing
      void this.callRegistry("record_failure");
      throw new Error(
        `Scout search failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Legacy entry-point for the orchestrator dispatch loop.
   * Wraps `search()` and returns the result serialised as JSON + spentStroops.
   */
  async run(instruction: string): Promise<ScoutResult> {
    const result = await this.search(instruction);
    return {
      result: JSON.stringify(result),
      spentStroops: BigInt(result.amountSpent),
    };
  }
}
