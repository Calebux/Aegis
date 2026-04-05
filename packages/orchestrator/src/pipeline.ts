/**
 * Aegis Pipeline
 *
 * Exports `runAegis()` as a reusable function so it can be called from both
 * the CLI entry-point (index.ts) and external consumers (e.g. the dashboard
 * Next.js API route) without triggering side-effects on import.
 *
 * The optional `onEvent` callback lets callers receive structured progress
 * events in real-time — used by the dashboard to drive its SSE stream.
 */

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

// ── Event types ───────────────────────────────────────────────────────────────

export type LogLevel = "info" | "success" | "error";
export type AgentId = "scout" | "ledger" | "signal" | "scribe";
export type AgentStatus = "idle" | "running" | "complete" | "error";

export type OnEvent = (type: string, payload: unknown) => void;

// ── Domain types ──────────────────────────────────────────────────────────────

export interface SubTasks {
  scout: string;
  ledger: string;
  signal: string;
}

export interface WalletSummary {
  agent: string;
  address: string;
  spent: number;
}

export interface AegisReport {
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

interface WalletMap {
  scout: Keypair;
  ledger: Keypair;
  signal: Keypair;
  scribe: Keypair;
}

// ── Config ────────────────────────────────────────────────────────────────────

const STELLAR_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const SPEND_CAP_STROOPS = BigInt(10_000_000); // 1 XLM

function getSorobanRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(RPC_URL);
}

function networkPassphrase(): string {
  return STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC;
}

// ── Step 1 — Decompose task via Claude ────────────────────────────────────────

async function decomposeTask(
  task: string,
  emit: OnEvent
): Promise<SubTasks> {
  emit("log", { message: "🧠 Decomposing task via Claude Sonnet 4.6…", level: "info" });

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

  emit("log", { message: `   scout  → ${subtasks.scout}`, level: "info" });
  emit("log", { message: `   ledger → ${subtasks.ledger}`, level: "info" });
  emit("log", { message: `   signal → ${subtasks.signal}`, level: "info" });

  return subtasks;
}

// ── Step 2 — Generate keypairs ────────────────────────────────────────────────

function generateWallets(emit: OnEvent): WalletMap {
  emit("log", { message: "🔑 Generating agent keypairs…", level: "info" });

  const agents = ["scout", "ledger", "signal", "scribe"] as const;
  const map: Record<string, Keypair> = {};

  for (const agent of agents) {
    map[agent] = Keypair.random();
    emit("log", { message: `   ${agent.padEnd(8)} → ${map[agent].publicKey()}`, level: "info" });
  }

  return map as unknown as WalletMap;
}

// ── Step 3 — Fund wallets via Friendbot ───────────────────────────────────────

async function fundWallets(
  wallets: WalletMap,
  emit: OnEvent
): Promise<void> {
  emit("log", { message: "💧 Funding wallets via Friendbot…", level: "info" });

  await Promise.all(
    (Object.entries(wallets) as [string, Keypair][]).map(
      async ([agent, keypair]) => {
        try {
          await fundTestnetAccount(keypair.publicKey());
          emit("log", { message: `   ${agent.padEnd(8)} ✓ funded`, level: "success" });
        } catch (err) {
          emit("log", { message: `   ${agent.padEnd(8)} ⚠ Friendbot failed: ${err}`, level: "error" });
        }
      }
    )
  );
}

// ── Step 4 — Register agents ──────────────────────────────────────────────────

async function registerAgents(
  wallets: WalletMap,
  shieldId: string,
  registryId: string,
  emit: OnEvent
): Promise<void> {
  emit("log", { message: "🛡️  Registering agents…", level: "info" });

  if (!shieldId && !registryId) {
    emit("log", {
      message: "   ℹ️  No contract IDs set — dev mode, all agents pre-authorized",
      level: "info",
    });
    return;
  }

  const rpc = getSorobanRpc();
  const horizon = getHorizonServer();

  for (const [agent, keypair] of Object.entries(wallets) as [string, Keypair][]) {
    if (!shieldId) {
      emit("log", { message: `   ${agent.padEnd(8)} ✓ pre-authorized (no SHIELD_CONTRACT_ID)`, level: "info" });
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
        emit("log", { message: `   ${agent.padEnd(8)} ⚠ authorize_spend sim error: ${sim.error}`, level: "error" });
      } else {
        emit("log", { message: `   ${agent.padEnd(8)} ✓ authorized on Shield Contract`, level: "success" });
      }
    } catch (err) {
      emit("log", { message: `   ${agent.padEnd(8)} ⚠ authorization failed: ${err}`, level: "error" });
    }
  }
}

// ── Steps 5a-c — Sub-agents ───────────────────────────────────────────────────

async function runScout(
  keypair: Keypair,
  instruction: string,
  emit: OnEvent
): Promise<{ result: string; spent: number }> {
  emit("agent_status", { agent: "scout", status: "running" });
  emit("log", { message: "🔍 Scout running web research…", level: "info" });

  process.env.SCOUT_SECRET_KEY = keypair.secret();
  const agent = new ScoutAgent();
  const { result, spentStroops } = await agent.run(instruction);
  const spent = Number(spentStroops);

  emit("agent_status", { agent: "scout", status: "complete", spent });
  emit("log", { message: `✅ Scout complete — ${spent} stroops spent`, level: "success" });

  return { result, spent };
}

async function runLedger(
  keypair: Keypair,
  instruction: string,
  emit: OnEvent
): Promise<{ result: string; spent: number }> {
  emit("agent_status", { agent: "ledger", status: "running" });
  emit("log", { message: "📊 Ledger querying Stellar Horizon…", level: "info" });

  process.env.LEDGER_SECRET_KEY = keypair.secret();
  const agent = new LedgerAgent();
  const { result, spentStroops } = await agent.run(instruction);
  const spent = Number(spentStroops);

  emit("agent_status", { agent: "ledger", status: "complete", spent });
  emit("log", { message: `✅ Ledger complete — ${spent} stroops spent`, level: "success" });

  return { result, spent };
}

async function runSignal(
  keypair: Keypair,
  instruction: string,
  emit: OnEvent
): Promise<{ result: string; spent: number }> {
  emit("agent_status", { agent: "signal", status: "running" });
  emit("log", { message: "📈 Signal aggregating market data…", level: "info" });

  process.env.SIGNAL_SECRET_KEY = keypair.secret();
  const agent = new SignalAgent();
  const { result, spentStroops } = await agent.run(instruction);
  const spent = Number(spentStroops);

  emit("agent_status", { agent: "signal", status: "complete", spent });
  emit("log", { message: `✅ Signal complete — ${spent} stroops spent`, level: "success" });

  return { result, spent };
}

// ── Step 6 — Scribe synthesis ─────────────────────────────────────────────────

async function runScribe(
  keypair: Keypair,
  task: string,
  scoutResult: string,
  ledgerResult: string,
  signalResult: string,
  emit: OnEvent
): Promise<{ report: string; spent: number }> {
  emit("agent_status", { agent: "scribe", status: "running" });
  emit("log", { message: "✍️  Scribe synthesizing final report…", level: "info" });

  process.env.SCRIBE_SECRET_KEY = keypair.secret();
  const agent = new ScribeAgent();

  const report = await agent.synthesise(task, [
    { agentId: "scout", result: scoutResult, spentStroops: 0n },
    { agentId: "ledger", result: ledgerResult, spentStroops: 0n },
    { agentId: "signal", result: signalResult, spentStroops: 0n },
  ]);

  emit("agent_status", { agent: "scribe", status: "complete", spent: 0 });
  emit("log", { message: "✅ Scribe complete — report generated", level: "success" });

  return { report, spent: 0 };
}

// ── runAegis ──────────────────────────────────────────────────────────────────

/**
 * Run the full Aegis multi-agent pipeline.
 *
 * @param task     - The research task to execute.
 * @param onEvent  - Optional callback for structured progress events. Falls
 *                   back to console.log when omitted (CLI mode).
 * @param writeOutput - When true (CLI default), writes output/report.json.
 */
export async function runAegis(
  task: string,
  onEvent?: OnEvent,
  writeOutput = false
): Promise<AegisReport> {
  const shieldContractId = process.env.SHIELD_CONTRACT_ID ?? "";
  const registryContractId = process.env.REGISTRY_CONTRACT_ID ?? "";

  // Default emitter: mirror to console.log when no callback provided
  const emit: OnEvent = onEvent ?? ((type, payload) => {
    if (type === "log") {
      const p = payload as { message: string; level: string };
      console.log(p.message);
    }
  });

  emit("log", { message: "🔮 Aegis starting…", level: "info" });
  emit("log", { message: `📋 Task: "${task.slice(0, 90)}${task.length > 90 ? "…" : ""}"`, level: "info" });

  // Step 1 — Decompose
  const subtasks = await decomposeTask(task, emit);

  // Step 2 — Generate wallets
  const wallets = generateWallets(emit);

  // Broadcast wallet addresses to consumers that track them
  emit("wallets", {
    scout: wallets.scout.publicKey(),
    ledger: wallets.ledger.publicKey(),
    signal: wallets.signal.publicKey(),
    scribe: wallets.scribe.publicKey(),
  });

  // Step 3 — Fund
  await fundWallets(wallets, emit);

  // Step 4 — Register
  await registerAgents(wallets, shieldContractId, registryContractId, emit);

  // Step 5 — Run Scout, Ledger, Signal in parallel
  const [scoutOut, ledgerOut, signalOut] = await Promise.all([
    runScout(wallets.scout, subtasks.scout, emit),
    runLedger(wallets.ledger, subtasks.ledger, emit),
    runSignal(wallets.signal, subtasks.signal, emit),
  ]);

  // Step 6 — Scribe synthesis
  const scribeOut = await runScribe(
    wallets.scribe,
    task,
    scoutOut.result,
    ledgerOut.result,
    signalOut.result,
    emit
  );

  // Step 7 — Build report
  const report: AegisReport = {
    task,
    subtasks,
    results: {
      scout: scoutOut.result,
      ledger: ledgerOut.result,
      signal: signalOut.result,
    },
    report: scribeOut.report,
    wallets: [
      { agent: "scout",  address: wallets.scout.publicKey(),  spent: scoutOut.spent },
      { agent: "ledger", address: wallets.ledger.publicKey(), spent: ledgerOut.spent },
      { agent: "signal", address: wallets.signal.publicKey(), spent: signalOut.spent },
      { agent: "scribe", address: wallets.scribe.publicKey(), spent: scribeOut.spent },
    ],
    timestamp: new Date().toISOString(),
  };

  const totalStroops = report.wallets.reduce((s, w) => s + w.spent, 0);
  const totalXlm = (totalStroops / 10_000_000).toFixed(7);
  emit("log", {
    message: `\n💎 Pipeline complete — total spend: ${totalXlm} XLM`,
    level: "success",
  });

  emit("complete", report);

  if (writeOutput) {
    const outputDir = path.resolve(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, "report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    emit("log", { message: `📁 Report written to: ${reportPath}`, level: "info" });
  }

  return report;
}
