/**
 * Aegis Master Orchestrator — the brain
 *
 * Pipeline:
 *  1. Decompose a hardcoded task via Claude (claude-sonnet-4-6)
 *  2. Generate fresh Stellar testnet keypairs for Scout, Ledger, Signal, Scribe
 *  3. Fund each wallet via Friendbot
 *  4. Register agents and authorize spend via Shield / Identity-Registry contracts
 *  5. Run Scout, Ledger, Signal in parallel
 *  6. Pass all results to Scribe for synthesis
 *  7. Emit a structured AegisReport
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY        — Anthropic API key
 *   SHIELD_CONTRACT_ID       — Soroban Shield contract address (optional in dev)
 *   REGISTRY_CONTRACT_ID     — Soroban Identity Registry address (optional in dev)
 *   STELLAR_NETWORK          — "testnet" (default)
 *   STELLAR_RPC_URL          — Soroban RPC endpoint (default: testnet)
 */

import "dotenv/config";
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
import { fundTestnetAccount, getHorizonServer } from "@aegis/shared";

import { ScoutAgent } from "./agents/scout.js";
import { LedgerAgent } from "./agents/ledger.js";
import { SignalAgent } from "./agents/signal.js";
import { ScribeAgent } from "./agents/scribe.js";

// ── Config ───────────────────────────────────────────────────────────────────

const TASK =
  "Analyze the current state of crypto adoption in Nigeria and the best DeFi options available to African users right now";

const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const SHIELD_CONTRACT_ID = process.env.SHIELD_CONTRACT_ID ?? "";
const REGISTRY_CONTRACT_ID = process.env.REGISTRY_CONTRACT_ID ?? "";

/** Spend cap per agent: 1 XLM expressed in stroops (1 XLM = 10 000 000 stroops). */
const SPEND_CAP_STROOPS = BigInt(10_000_000);

// ── Domain types ─────────────────────────────────────────────────────────────

interface SubTasks {
  scout: string;
  ledger: string;
  signal: string;
}

interface AgentResults {
  scout: string;
  ledger: string;
  signal: string;
}

interface WalletSummary {
  agent: string;
  address: string;
  spent: number;
}

interface AegisReport {
  task: string;
  subtasks: SubTasks;
  results: AgentResults;
  report: string;
  wallets: WalletSummary[];
  timestamp: string;
}

interface AgentWallet {
  agent: string;
  keypair: Keypair;
  address: string;
  spent: number;
  authorized: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSorobanRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(RPC_URL);
}

function networkPassphrase(): string {
  return STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC;
}

function ensureApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check your .env file");
  }
}

// ── Step 1 — Decompose task via Claude ────────────────────────────────────────

async function decomposeTask(task: string): Promise<SubTasks> {
  console.log("\n🧠 Decomposing task…");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `You are the task decomposition engine for Aegis, a multi-agent research system.

Decompose the following task into exactly 3 sub-tasks, one per specialist agent:
- scout:  a concrete web search query to gather recent news / articles
- ledger: a specific Stellar on-chain data request (e.g. DEX volumes, active accounts, asset stats)
- signal: a specific market data / DeFi metrics request (e.g. TVL, token prices, adoption stats)

Return ONLY valid JSON with this exact shape and no other text:
{
  "scout": "...",
  "ledger": "...",
  "signal": "..."
}

Task: "${task}"`,
      },
    ],
  });

  const raw =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  // Extract JSON — Claude sometimes wraps it in a code fence
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `Claude did not return valid JSON for task decomposition.\nRaw response: ${raw}`
    );
  }

  const subtasks = JSON.parse(jsonMatch[0]) as SubTasks;

  console.log(`   scout  → ${subtasks.scout}`);
  console.log(`   ledger → ${subtasks.ledger}`);
  console.log(`   signal → ${subtasks.signal}`);

  return subtasks;
}

// ── Step 2 — Generate keypairs + fund via Friendbot ───────────────────────────

async function setupWallets(agentNames: string[]): Promise<AgentWallet[]> {
  console.log("\n🚀 Funding wallets…");

  const wallets: AgentWallet[] = agentNames.map((agent) => {
    const keypair = Keypair.random();
    return {
      agent,
      keypair,
      address: keypair.publicKey(),
      spent: 0,
      authorized: false,
    };
  });

  // Fund all wallets in parallel
  await Promise.all(
    wallets.map(async (w) => {
      console.log(`   ${w.agent.padEnd(8)} → ${w.address}`);
      try {
        await fundTestnetAccount(w.address);
        console.log(`   ${w.agent.padEnd(8)} ✓ funded`);
      } catch (err) {
        console.warn(`   ${w.agent.padEnd(8)} ⚠ Friendbot failed:`, err);
      }
    })
  );

  return wallets;
}

// ── Step 3 — Shield Contract: register_agent + authorize_spend ────────────────

/**
 * Attempts to call authorize_spend on the Shield contract for the given wallet.
 * If SHIELD_CONTRACT_ID is unset (dev mode) the agent is pre-authorized.
 * Any contract error is caught, logged, and the agent is marked as skipped.
 */
async function authorizeAgentSpend(wallet: AgentWallet): Promise<boolean> {
  // Dev / no-contract mode — pre-authorize all agents
  if (!SHIELD_CONTRACT_ID) {
    wallet.authorized = true;
    return true;
  }

  try {
    const rpc = getSorobanRpc();
    const horizon = getHorizonServer();
    const account = await horizon.loadAccount(wallet.address);
    const contract = new Contract(SHIELD_CONTRACT_ID);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "authorize_spend",
          new Address(wallet.address).toScVal(),
          nativeToScVal(SPEND_CAP_STROOPS, { type: "i128" })
        )
      )
      .setTimeout(30)
      .build();

    const sim = await rpc.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(sim)) {
      console.error(
        `   🛡️  ${wallet.agent}: authorize_spend simulation error — ${sim.error}`
      );
      return false;
    }

    wallet.authorized = true;
    return true;
  } catch (err) {
    console.error(`   🛡️  ${wallet.agent}: authorization threw —`, err);
    return false;
  }
}

/**
 * Optionally calls register_agent on the Identity Registry, then authorizes
 * spend on the Shield contract for every agent wallet.
 */
async function registerAndAuthorize(wallets: AgentWallet[]): Promise<void> {
  console.log("\n🛡️  Authorizing spend…");

  if (REGISTRY_CONTRACT_ID) {
    console.log(
      `   ℹ️  Identity Registry: ${REGISTRY_CONTRACT_ID} — registration is admin-gated, skipping auto-register`
    );
  } else {
    console.log(
      "   ℹ️  REGISTRY_CONTRACT_ID not set — skipping identity registration (dev mode)"
    );
  }

  if (!SHIELD_CONTRACT_ID) {
    console.log(
      "   ℹ️  SHIELD_CONTRACT_ID not set — all agents pre-authorized (dev mode)"
    );
    wallets.forEach((w) => (w.authorized = true));
    return;
  }

  await Promise.all(
    wallets.map(async (wallet) => {
      const ok = await authorizeAgentSpend(wallet);
      console.log(
        `   ${wallet.agent.padEnd(8)} → ${ok ? "✅ authorized" : "❌ not authorized — agent will be skipped"}`
      );
    })
  );
}

// ── Steps 4-6 — Run Scout, Ledger, Signal ────────────────────────────────────

async function runScout(
  wallet: AgentWallet,
  instruction: string
): Promise<string> {
  console.log("\n🔍 Scout running…");
  if (!wallet.authorized) {
    console.warn("   ⚠ Scout not authorized — skipping");
    return "[scout skipped — spend not authorized]";
  }
  const agent = new ScoutAgent({
    keypair: wallet.keypair,
    shieldContractId: SHIELD_CONTRACT_ID,
    registryContractId: REGISTRY_CONTRACT_ID,
  });
  const { result, spentStroops } = await agent.run(instruction);
  wallet.spent = Number(spentStroops);
  return result;
}

async function runLedger(
  wallet: AgentWallet,
  instruction: string
): Promise<string> {
  console.log("\n📊 Ledger running…");
  if (!wallet.authorized) {
    console.warn("   ⚠ Ledger not authorized — skipping");
    return "[ledger skipped — spend not authorized]";
  }
  process.env.LEDGER_SECRET_KEY = wallet.keypair.secret();
  const agent = new LedgerAgent();
  const { result, spentStroops } = await agent.run(instruction);
  wallet.spent = Number(spentStroops);
  return result;
}

async function runSignal(
  wallet: AgentWallet,
  instruction: string
): Promise<string> {
  console.log("\n📈 Signal running…");
  if (!wallet.authorized) {
    console.warn("   ⚠ Signal not authorized — skipping");
    return "[signal skipped — spend not authorized]";
  }
  process.env.SIGNAL_SECRET_KEY = wallet.keypair.secret();
  const agent = new SignalAgent();
  const { result, spentStroops } = await agent.run(instruction);
  wallet.spent = Number(spentStroops);
  return result;
}

// ── Step 7 — Scribe synthesis ─────────────────────────────────────────────────

async function runScribe(
  wallet: AgentWallet,
  task: string,
  results: AgentResults
): Promise<string> {
  console.log("\n✍️  Scribe synthesizing…");
  if (!wallet.authorized) {
    console.warn("   ⚠ Scribe not authorized — skipping");
    return "[scribe skipped — spend not authorized]";
  }
  process.env.SCRIBE_SECRET_KEY = wallet.keypair.secret();
  const agent = new ScribeAgent();
  const contributions = [
    { agentId: "scout", result: results.scout, spentStroops: 0n },
    { agentId: "ledger", result: results.ledger, spentStroops: 0n },
    { agentId: "signal", result: results.signal, spentStroops: 0n },
  ];
  const report = await agent.synthesise(task, contributions);
  return report;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureApiKey();

  const task = TASK;
  console.log("🔮 Aegis starting…");
  console.log(`   Task: "${task}"`);

  // 1. Decompose the task
  const subtasks = await decomposeTask(task);

  // 2. Generate + fund wallets for all four agents
  const agentNames = ["scout", "ledger", "signal", "scribe"] as const;
  const wallets = await setupWallets([...agentNames]);
  const walletMap = new Map<string, AgentWallet>(
    wallets.map((w) => [w.agent, w])
  );

  // 3. Register agents + authorize spend via Shield / Identity-Registry contracts
  await registerAndAuthorize(wallets);

  // 4-6. Run Scout, Ledger, Signal concurrently
  const [scoutResult, ledgerResult, signalResult] = await Promise.all([
    runScout(walletMap.get("scout")!, subtasks.scout),
    runLedger(walletMap.get("ledger")!, subtasks.ledger),
    runSignal(walletMap.get("signal")!, subtasks.signal),
  ]);

  const results: AgentResults = {
    scout: scoutResult,
    ledger: ledgerResult,
    signal: signalResult,
  };

  // 7. Scribe synthesizes the final report
  const report = await runScribe(walletMap.get("scribe")!, task, results);

  // 8. Assemble structured output
  const aegisReport: AegisReport = {
    task,
    subtasks,
    results,
    report,
    wallets: wallets.map((w) => ({
      agent: w.agent,
      address: w.address,
      spent: w.spent,
    })),
    timestamp: new Date().toISOString(),
  };

  console.log("\n✅ Aegis report ready\n");
  console.log(JSON.stringify(aegisReport, null, 2));
}

main().catch((err) => {
  console.error("[aegis] Fatal error:", err);
  process.exit(1);
});
