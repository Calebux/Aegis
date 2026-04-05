/**
 * Scribe Agent
 *
 * Receives all three sub-agent results plus the original task, then uses
 * the Anthropic Claude API (claude-sonnet-4-6) to synthesise everything
 * into a clean, structured report — the final output the user sees on
 * the dashboard.
 *
 * Pre-flight:  authorize_spend on Shield Contract
 * Post-flight: record_success on Identity Registry
 */

import Anthropic from "@anthropic-ai/sdk";
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
import { getHorizonServer } from "@aegis/shared";

// ── Sub-agent result types ────────────────────────────────────────────────────

export interface ScoutResult {
  answer: string;
  sources: Array<{ name: string; url?: string }>;
}

export interface LedgerResult {
  networkStats: Record<string, unknown>;
  accountData: Record<string, unknown>;
}

export interface SignalResult {
  xlmUsdcPrice: number;
  priceRange24h: { low: number; high: number };
  recentTrades: Array<Record<string, unknown>>;
}

// ── I/O types ─────────────────────────────────────────────────────────────────

export interface ScribeParams {
  task: string;
  keypair: Keypair;
  shieldContractId: string;
  registryContractId: string;
  scoutResult: ScoutResult;
  ledgerResult: LedgerResult;
  signalResult: SignalResult;
}

export interface ScribeResult {
  agentId: "scribe";
  report: string;
  walletAddress: string;
  amountSpent: number;
  model: "claude-sonnet-4-6";
  tokensUsed: number;
}

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
const SPEND_CAP_STROOPS = BigInt(10_000_000); // 1 XLM

function networkPassphrase(): string {
  return STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC;
}

// ── Contract helpers ──────────────────────────────────────────────────────────

/**
 * Simulate authorize_spend on the Shield contract for Scribe's wallet.
 * Silently skips if shieldContractId is empty (dev / no-contract mode).
 */
async function authorizeSpend(
  keypair: Keypair,
  shieldContractId: string
): Promise<void> {
  if (!shieldContractId) {
    console.log("   🛡️  No Shield contract — skipping authorize_spend (dev mode)");
    return;
  }

  try {
    const rpc = new SorobanRpc.Server(RPC_URL);
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
          nativeToScVal(SPEND_CAP_STROOPS, { type: "i128" })
        )
      )
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(sim)) {
      console.warn(
        `   🛡️  authorize_spend simulation error: ${sim.error} — proceeding anyway`
      );
    } else {
      console.log("   🛡️  authorize_spend ✅");
    }
  } catch (err) {
    console.warn("   🛡️  authorize_spend threw — proceeding anyway:", err);
  }
}

/**
 * Simulate record_success on the Identity Registry contract.
 * Silently skips if registryContractId is empty (dev / no-contract mode).
 */
async function recordSuccess(
  keypair: Keypair,
  registryContractId: string
): Promise<void> {
  if (!registryContractId) {
    console.log("   📋 No Identity Registry — skipping record_success (dev mode)");
    return;
  }

  try {
    const rpc = new SorobanRpc.Server(RPC_URL);
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
          new Address(keypair.publicKey()).toScVal()
        )
      )
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(sim)) {
      console.warn(
        `   📋 record_success simulation error: ${sim.error} — continuing`
      );
    } else {
      console.log("   📋 record_success ✅");
    }
  } catch (err) {
    console.warn("   📋 record_success threw — continuing:", err);
  }
}

// ── ScribeAgent ───────────────────────────────────────────────────────────────

export class ScribeAgent {
  private readonly anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async run(params: ScribeParams): Promise<ScribeResult> {
    const {
      task,
      keypair,
      shieldContractId,
      registryContractId,
      scoutResult,
      ledgerResult,
      signalResult,
    } = params;

    console.log("\n✍️  Scribe synthesizing results…");

    // 1. Authorize spend on Shield Contract
    await authorizeSpend(keypair, shieldContractId);

    // 2. Build the user message from all sub-agent outputs
    const userMessage = `Original task: ${task}

Scout (Web Research) found:
${scoutResult.answer}
Sources: ${scoutResult.sources.map((s) => s.name).join(", ")}

Ledger (On-chain Data) found:
Network stats: ${JSON.stringify(ledgerResult.networkStats)}
Account data: ${JSON.stringify(ledgerResult.accountData)}

Signal (Market Data) found:
XLM/USDC Price: $${signalResult.xlmUsdcPrice}
24h Range: $${signalResult.priceRange24h.low} - $${signalResult.priceRange24h.high}
Recent trades: ${signalResult.recentTrades.length} trades recorded

Synthesize all of this into a structured Aegis report.`;

    // 3. Call Claude API
    console.log("   🧠 Calling Claude API…");

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: `You are Scribe, the synthesis agent of Aegis — a multi-agent research system built on Stellar.
You receive research from three specialized agents and synthesize it into a clear, actionable report.
Always structure your report with these sections:
- Executive Summary (2-3 sentences)
- Key Findings (bullet points from Scout's web research)
- On-Chain Insights (from Ledger's Stellar network data)
- Market Intelligence (from Signal's price and order book data)
- Recommendations (3 concrete actionable points)
- Data Sources (list Scout's sources)
Be concise, factual, and specific. Avoid filler language.`,
      messages: [{ role: "user", content: userMessage }],
    });

    const report =
      response.content[0].type === "text" ? response.content[0].text : "";
    const tokensUsed =
      response.usage.input_tokens + response.usage.output_tokens;

    // 4. Record success on Identity Registry
    await recordSuccess(keypair, registryContractId);

    console.log(
      `   ✅ Scribe complete — report ready (${tokensUsed} tokens used)`
    );

    return {
      agentId: "scribe",
      report,
      walletAddress: keypair.publicKey(),
      amountSpent: 0, // Claude API cost not yet mapped to stroops
      model: "claude-sonnet-4-6",
      tokensUsed,
    };
  }

  /**
   * Legacy interface used by the orchestrator stub.
   * Delegates to `run` with zero-value placeholders for untyped results.
   */
  async synthesise(
    originalPrompt: string,
    contributions: Array<{ agentId: string; result: string; spentStroops: bigint }>
  ): Promise<string> {
    const scoutContrib = contributions.find((c) => c.agentId === "scout");
    const ledgerContrib = contributions.find((c) => c.agentId === "ledger");
    const signalContrib = contributions.find((c) => c.agentId === "signal");

    const scoutResult: ScoutResult = {
      answer: scoutContrib?.result ?? "(no data)",
      sources: [],
    };
    const ledgerResult: LedgerResult = {
      networkStats: { raw: ledgerContrib?.result ?? "(no data)" },
      accountData: {},
    };
    const signalResult: SignalResult = {
      xlmUsdcPrice: 0,
      priceRange24h: { low: 0, high: 0 },
      recentTrades: [],
    };

    // Use a throw-away keypair for legacy calls (no contract interaction possible)
    const keypair = Keypair.random();

    const result = await this.run({
      task: originalPrompt,
      keypair,
      shieldContractId: process.env.SHIELD_CONTRACT_ID ?? "",
      registryContractId: process.env.REGISTRY_CONTRACT_ID ?? "",
      scoutResult,
      ledgerResult,
      signalResult,
    });

    return result.report;
  }
}
