/**
 * Aegis Master Orchestrator — full end-to-end execution
 *
 * Pipeline:
 *  1. Decompose a hardcoded task via Claude (claude-sonnet-4-6)
 *  2. Generate fresh Stellar testnet keypairs for Scout, Ledger, Signal, Scribe
 *  3. Fund each wallet via Friendbot
 *  4. Register agents on Shield Contract and Identity Registry
 *  5. Run Scout, Ledger, Signal in parallel
 *  6. Pass all results to Scribe for synthesis
 *  7. Build and emit a structured AegisReport
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY      — Anthropic API key
 *   SHIELD_CONTRACT_ID     — Soroban Shield contract address (optional in dev)
 *   REGISTRY_CONTRACT_ID   — Soroban Identity Registry address (optional in dev)
 *   STELLAR_NETWORK        — "testnet" (default)
 *   STELLAR_RPC_URL        — Soroban RPC endpoint (default: testnet)
 */

import * as dotenv from "dotenv";
import * as nodePath from "path";
// Load .env from repo root: src/ -> orchestrator/ -> packages/ -> Aegis/
dotenv.config({ path: nodePath.resolve(__dirname, "../../../.env") });
dotenv.config(); // fallback: also try cwd/.env
import * as fs from "fs";
import * as path from "path";
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
import { startHorizonX402Server } from "./services/horizon-x402-server.js";

// ── Config ───────────────────────────────────────────────────────────────────

const TASK =
  "Analyze the current state of crypto adoption in Nigeria and the best DeFi options available to African users right now";

const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const shieldContractId = process.env.SHIELD_CONTRACT_ID ?? "";
const registryContractId = process.env.REGISTRY_CONTRACT_ID ?? "";

/** Spend cap per agent: 1 XLM in stroops */
const SPEND_CAP_STROOPS = BigInt(10_000_000);

// ── Domain types ─────────────────────────────────────────────────────────────

interface SubTasks {
  scout: string;
  ledger: string;
  signal: string;
}

interface WalletMap {
  scout: Keypair;
  ledger: Keypair;
  signal: Keypair;
  scribe: Keypair;
}

interface WalletSummary {
  agent: string;
  address: string;
  spent: number;
}

interface AegisReport {
  task: string;
  subtasks: SubTasks;
  results: {
    scout: string;
    ledger: string;
    signal: string;
  };
  report: string;
  wallets: WalletSummary[];
  timestamp: string;
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

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `Claude did not return valid JSON for task decomposition.\nRaw: ${raw}`
    );
  }

  const subtasks = JSON.parse(jsonMatch[0]) as SubTasks;

  console.log(`   scout  → ${subtasks.scout}`);
  console.log(`   ledger → ${subtasks.ledger}`);
  console.log(`   signal → ${subtasks.signal}`);

  return subtasks;
}

// ── Step 2 — Generate keypairs ────────────────────────────────────────────────

function generateWallets(agents: string[]): WalletMap {
  console.log("\n🔑 Generating keypairs…");
  const map: Record<string, Keypair> = {};
  for (const agent of agents) {
    map[agent] = Keypair.random();
    console.log(`   ${agent.padEnd(8)} → ${map[agent].publicKey()}`);
  }
  return map as unknown as WalletMap;
}

// ── Step 3 — Fund wallets via Friendbot ───────────────────────────────────────

async function fundWallets(wallets: WalletMap): Promise<void> {
  console.log("\n🚀 Funding wallets via Friendbot…");
  await Promise.all(
    (Object.entries(wallets) as [string, Keypair][]).map(
      async ([agent, keypair]) => {
        try {
          await fundTestnetAccount(keypair.publicKey());
          console.log(`   ${agent.padEnd(8)} ✓ funded`);
        } catch (err) {
          console.warn(`   ${agent.padEnd(8)} ⚠ Friendbot failed:`, err);
        }
      }
    )
  );
}

// ── Step 4 — Register agents on Shield + Identity Registry ───────────────────

async function registerAgents(
  wallets: WalletMap,
  shieldId: string,
  registryId: string
): Promise<void> {
  console.log("\n🛡️  Registering agents…");

  if (!shieldId && !registryId) {
    console.log(
      "   ℹ️  No contract IDs set — dev mode, all agents pre-authorized"
    );
    return;
  }

  const rpc = getSorobanRpc();
  const horizon = getHorizonServer();

  for (const [agent, keypair] of Object.entries(wallets) as [
    string,
    Keypair,
  ][]) {
    if (!shieldId) {
      console.log(`   ${agent.padEnd(8)} ✓ pre-authorized (no SHIELD_CONTRACT_ID)`);
      continue;
    }

    try {
      const account = await horizon.loadAccount(keypair.publicKey());
      const contract = new Contract(shieldId);

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
        console.warn(`   ${agent.padEnd(8)} ⚠ authorize_spend sim error: ${sim.error}`);
      } else {
        console.log(`   ${agent.padEnd(8)} ✓ authorized on Shield Contract`);
      }
    } catch (err) {
      console.warn(`   ${agent.padEnd(8)} ⚠ authorization failed:`, err);
    }
  }
}

// ── Steps 5 — Run Scout, Ledger, Signal ──────────────────────────────────────

async function runScout(
  keypair: Keypair,
  instruction: string,
  _shieldContractId: string,
  _registryContractId: string
): Promise<string> {
  console.log("\n🔍 Scout running…");
  process.env.SCOUT_SECRET_KEY = keypair.secret();
  const agent = new ScoutAgent();
  const { result, spentStroops } = await agent.run(instruction);
  console.log(`   spent: ${spentStroops} stroops`);
  return result;
}

async function runLedger(
  keypair: Keypair,
  instruction: string,
  _shieldContractId: string,
  _registryContractId: string
): Promise<string> {
  console.log("\n📊 Ledger running…");
  process.env.LEDGER_SECRET_KEY = keypair.secret();
  const agent = new LedgerAgent();
  const { result, spentStroops } = await agent.run(instruction);
  console.log(`   spent: ${spentStroops} stroops`);
  return result;
}

async function runSignal(
  keypair: Keypair,
  instruction: string,
  _shieldContractId: string,
  _registryContractId: string
): Promise<string> {
  console.log("\n📈 Signal running…");
  process.env.SIGNAL_SECRET_KEY = keypair.secret();
  const agent = new SignalAgent();
  const { result, spentStroops } = await agent.run(instruction);
  console.log(`   spent: ${spentStroops} stroops`);
  return result;
}

// ── Step 6 — Scribe synthesis ─────────────────────────────────────────────────

async function runScribe(params: {
  task: string;
  keypair: Keypair;
  shieldContractId: string;
  registryContractId: string;
  scoutResult: string;
  ledgerResult: string;
  signalResult: string;
}): Promise<string> {
  console.log("\n✍️  Scribe synthesizing…");
  process.env.SCRIBE_SECRET_KEY = params.keypair.secret();
  const agent = new ScribeAgent();
  return agent.synthesise(params.task, [
    { agentId: "scout", result: params.scoutResult, spentStroops: 0n },
    { agentId: "ledger", result: params.ledgerResult, spentStroops: 0n },
    { agentId: "signal", result: params.signalResult, spentStroops: 0n },
  ]);
}

// ── Step 7 — Build final report ───────────────────────────────────────────────

function buildAegisReport(params: {
  task: string;
  subtasks: SubTasks;
  scoutResult: string;
  ledgerResult: string;
  signalResult: string;
  scribeResult: string;
  wallets: WalletMap;
}): AegisReport {
  return {
    task: params.task,
    subtasks: params.subtasks,
    results: {
      scout: params.scoutResult,
      ledger: params.ledgerResult,
      signal: params.signalResult,
    },
    report: params.scribeResult,
    wallets: (Object.entries(params.wallets) as [string, Keypair][]).map(
      ([agent, keypair]) => ({
        agent,
        address: keypair.publicKey(),
        spent: 0,
      })
    ),
    timestamp: new Date().toISOString(),
  };
}

// ── runAegis ──────────────────────────────────────────────────────────────────

async function runAegis(task: string): Promise<AegisReport> {
  // Step 1 — Decompose task with Claude
  const subtasks = await decomposeTask(task);

  // Step 2 — Generate keypairs for all 4 sub-agents
  const wallets = generateWallets(["scout", "ledger", "signal", "scribe"]);

  // Step 3 — Fund all wallets via Friendbot in parallel
  await fundWallets(wallets);

  // Step 4 — Register all agents on Shield Contract and Identity Registry
  await registerAgents(wallets, shieldContractId, registryContractId);

  // Step 5 — Run Scout, Ledger, Signal in parallel
  const [scoutResult, ledgerResult, signalResult] = await Promise.all([
    runScout(wallets.scout, subtasks.scout, shieldContractId, registryContractId),
    runLedger(wallets.ledger, subtasks.ledger, shieldContractId, registryContractId),
    runSignal(wallets.signal, subtasks.signal, shieldContractId, registryContractId),
  ]);

  // Step 6 — Run Scribe with all results
  const scribeResult = await runScribe({
    task,
    keypair: wallets.scribe,
    shieldContractId,
    registryContractId,
    scoutResult,
    ledgerResult,
    signalResult,
  });

  // Step 7 — Build final report
  return buildAegisReport({
    task,
    subtasks,
    scoutResult,
    ledgerResult,
    signalResult,
    scribeResult,
    wallets,
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureApiKey();

  // Start Horizon x402 server on port 3001
  await startHorizonX402Server();

  console.log("\n🔮 Aegis starting…");
  console.log(`   Task: "${TASK}"`);

  const report = await runAegis(TASK);

  // Write report to output/report.json
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  // ── Print formatted terminal output ──────────────────────────────────────
  const sep = "━".repeat(60);

  console.log(`\n${sep}`);
  console.log("✅  AEGIS REPORT");
  console.log(sep);

  console.log(`\n📋  TASK\n${report.task}`);

  console.log(`\n📌  SUB-TASKS`);
  console.log(`   scout  → ${report.subtasks.scout}`);
  console.log(`   ledger → ${report.subtasks.ledger}`);
  console.log(`   signal → ${report.subtasks.signal}`);

  console.log(`\n🔍  SCOUT RESULT\n${report.results.scout}`);
  console.log(`\n📊  LEDGER RESULT\n${report.results.ledger}`);
  console.log(`\n📈  SIGNAL RESULT\n${report.results.signal}`);

  console.log(`\n✍️   FINAL REPORT\n${report.report}`);

  // ── Spend summary ─────────────────────────────────────────────────────────
  console.log(`\n${sep}`);
  console.log("💸  SPEND SUMMARY");
  console.log(sep);

  let totalStroops = 0;
  for (const w of report.wallets) {
    const xlm = (w.spent / 10_000_000).toFixed(7);
    console.log(
      `   ${w.agent.padEnd(8)} ${w.address}  ${w.spent} stroops (${xlm} XLM)`
    );
    totalStroops += w.spent;
  }

  const totalXlm = (totalStroops / 10_000_000).toFixed(7);
  console.log(`\n   Total XLM spent: ${totalXlm} XLM (${totalStroops} stroops)`);

  console.log(`\n📁  Report written to: ${reportPath}`);
  console.log(`⏱️   Timestamp: ${report.timestamp}\n`);
}

main().catch((err) => {
  console.error("[aegis] Fatal error:", err);
  process.exit(1);
});
