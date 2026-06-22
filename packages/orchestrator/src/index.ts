/**
 * Cal-AgentKit Master Orchestrator — Bus-Based Pipeline (Upgrades 1–7)
 *
 * Pipeline flow:
 *   1. Generate task graph via Planner (Upgrade 6)
 *   2. Reputation-based routing for each agent (Upgrade 3)
 *   3. Provision wallets + register on Soroban contracts
 *   4. Wire ConsensusManager + (conditional) Validator (Upgrade 4)
 *   5. Wire Signal accumulator + Scribe listener (Upgrade 1)
 *   6. Fire Scout + Ledger in parallel (Upgrade 2)
 *   7. Await final report via bus
 *
 * External API: runTask(prompt, emitter?) — unchanged for dashboard compatibility.
 */

import * as dotenv from "dotenv";
import * as nodePath from "path";
dotenv.config({ path: nodePath.resolve(__dirname, "../../../.env") });
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { Keypair, SorobanRpc } from "@stellar/stellar-sdk";
import { fundTestnetAccount } from "@calagent/shared";
import {
  ShieldContract,
  IdentityRegistry,
  createStellarSettlement,
  createCeloSettlement,
  createBaseSettlement,
  getDefaultChainPreference,
} from "@calagent/agent-kit";
import type { OrchestratorReport, SettlementProvider, LLMProvider } from "@calagent/agent-kit";

import { bus, type AgentMessage, type AgentTopic } from "./lib/bus.js";
import { generateTaskGraph, graphHasAgent, type TaskGraph } from "./orchestrator/planner.js";
import { resolveRouting } from "./orchestrator/router.js";
import { ConsensusManager } from "./agents/consensus.js";
import { ScoutAgent } from "./agents/scout.js";
import { LedgerAgent } from "./agents/ledger.js";
import { SignalAgent } from "./agents/signal.js";
import { ScribeAgent } from "./agents/scribe.js";
import { ExecutorAgent } from "./agents/executor.js";
import { startHorizonX402Server } from "./services/horizon-x402-server.js";

export type { OrchestratorReport as CalagentReport };

// Celo pipeline entry point (re-exported for dashboard compatibility)
export { runCeloTask } from "./celo-index.js";

// ── Default demo task ─────────────────────────────────────────────────────────

const TASK =
  "Analyze the current state of crypto adoption in Nigeria and the best DeFi options available to African users right now";

// ── Helpers ───────────────────────────────────────────────────────────────────

type EmitFn = (type: string, payload: unknown) => void;

function makeEmit(emitter?: EventEmitter): EmitFn {
  return (type, payload) => emitter?.emit(type, payload);
}

/** Wait for Scribe's final consensus:reached (agentId === 'scribe') */
function waitForFinalOutput(runId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bus.clear(runId);
      reject(new Error(`Pipeline timed out for run ${runId}`));
    }, 120_000);

    const unsubscribe = bus.subscribe(
      "consensus:reached",
      (msg) => {
        if (msg.runId !== runId) return;
        if (msg.agentId !== "scribe") return; // wait for Scribe's final publish
        clearTimeout(timeout);
        unsubscribe();
        resolve((msg.payload as { agreedOutput: string }).agreedOutput);
      },
      runId
    );
  });
}

/** Convert a bus message into emitter events the SSE stream understands */
function bridgeBusToEmitter(msg: AgentMessage, emit: EmitFn): void {
  const agentTopicMap: Partial<Record<AgentTopic, string>> = {
    "scout:complete": "scout",
    "ledger:complete": "ledger",
    "signal:complete": "signal",
    "validator:complete": "validator",
  };

  if (msg.topic in agentTopicMap) {
    const agentId = agentTopicMap[msg.topic]!;
    const p = msg.payload as Record<string, unknown>;
    emit("agent_status", {
      agent: agentId,
      status: "complete",
      spent: p["amountSpent"] ?? 0,
      txHashes: p["txHashes"] ?? [],
      paymentMode: p["paymentMode"] ?? "dev",
      confidence: msg.confidence,
    });
  }

  if (msg.topic === "consensus:reached" && msg.agentId === "consensus-manager") {
    const p = msg.payload as Record<string, unknown>;
    const needsValidation = p["validationWasRequired"];
    emit("log", {
      message: needsValidation
        ? `🔍 Consensus via Validator — conflict resolved`
        : `✅ Consensus reached (confidence: ${(msg.confidence * 100).toFixed(0)}%)`,
      level: "success",
    });
  }

  // Scribe's final publish — mark scribe as complete in the graph
  if (msg.topic === "consensus:reached" && msg.agentId === "scribe") {
    emit("agent_status", { agent: "scribe", status: "complete", confidence: msg.confidence });
  }

  if (msg.topic === "validator:complete") {
    const p = msg.payload as { validationPassed: boolean; revisedAnalysis?: string };
    emit("log", {
      message: p.validationPassed
        ? `✅ Validator: analysis confirmed`
        : `⚠️  Validator: conflict found — analysis revised`,
      level: p.validationPassed ? "success" : "info",
    });
    emit("agent_status", { agent: "validator", status: "complete", confidence: msg.confidence });
  }

  if (msg.topic === "executor:complete") {
    const p = msg.payload as Record<string, unknown>;
    const notaryTxHash = (p["notaryTxHash"] as string) ?? "";
    const dexTxHash    = (p["dexTxHash"]    as string) ?? "";
    emit("agent_status", {
      agent:       "executor",
      status:      "complete",
      spent:       p["amountSpent"] ?? 0,
      txHashes:    p["txHashes"] ?? [],
      paymentMode: "notary",
      confidence:  msg.confidence,
      sigTxHash:   notaryTxHash || undefined,
      dexTxHash:   dexTxHash    || undefined,
    });
    emit("log", {
      message: [
        notaryTxHash ? `🔏 Soroban: ${notaryTxHash.slice(0, 12)}…` : `🔏 Soroban: skipped`,
        dexTxHash    ? `💱 DEX: ${dexTxHash.slice(0, 12)}…`        : `💱 DEX: failed`,
      ].join("  ·  "),
      level: "success",
    });
  }

  if (msg.topic === "sig:stored") {
    const p = msg.payload as { agentId: string; sigTxHash: string };
    emit("agent_status", { agent: p.agentId, sigTxHash: p.sigTxHash });
  }

  if (msg.topic === "task:error") {
    const p = msg.payload as { error?: string; type?: string };
    if (p.type !== "reputation:updated") {
      emit("log", { message: `⚠️  ${msg.agentId}: ${p.error ?? "error"}`, level: "error" });
    }
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

let horizonServerStarted = false;

export async function runTask(
  prompt: string,
  emitter?: EventEmitter,
  llmProvider?: LLMProvider
): Promise<OrchestratorReport> {
  // Skip port-binding on Vercel serverless (VERCEL env is set automatically)
  if (!horizonServerStarted && !process.env.VERCEL) {
    try {
      await startHorizonX402Server();
      horizonServerStarted = true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        horizonServerStarted = true;
      } else {
        console.warn("[runTask] Could not start Horizon x402 server:", err);
      }
    }
  }

  const emit = makeEmit(emitter);

  // ── 1. Generate task graph ─────────────────────────────────────────────────
  emit("log", { message: "🔮 Cal-AgentKit pipeline initialising…", level: "info" });
  emit("log", {
    message: `📋 Task: "${prompt.slice(0, 90)}${prompt.length > 90 ? "…" : ""}"`,
    level: "info",
  });
  emit("log", { message: "🗺️  Generating task graph…", level: "info" });

  const graph: TaskGraph = await generateTaskGraph(prompt, llmProvider);
  const runId = graph.runId;

  // Emit graph to dashboard (new SSE event type for TaskGraph visual)
  emit("task:graph", graph);
  emit("log", {
    message: `   Graph: ${graph.nodes.map((n) => n.agentType).join(" → ")}`,
    level: "info",
  });

  // ── 2. Reputation routing ─────────────────────────────────────────────────
  const [scoutRouting, ledgerRouting] = await Promise.all([
    resolveRouting("scout"),
    resolveRouting("ledger"),
  ]);
  emit("log", { message: `   🏆 ${scoutRouting.message}`, level: "info" });
  emit("log", { message: `   🏆 ${ledgerRouting.message}`, level: "info" });

  const needsValidator =
    graphHasAgent(graph, "validator") ||
    scoutRouting.requiresValidation ||
    ledgerRouting.requiresValidation;

  // ── 3. Provision wallets ───────────────────────────────────────────────────
  // Use persistent keypairs from env when available so reputation + wallet
  // history accumulates across runs. Falls back to random (dev / first run).
  emit("log", { message: "🔑 Loading agent wallets…", level: "info" });

  function loadKeypair(envKey: string): Keypair {
    const secret = process.env[envKey];
    return secret ? Keypair.fromSecret(secret) : Keypair.random();
  }

  const scoutKp    = loadKeypair("SCOUT_SECRET_KEY");
  const ledgerKp   = loadKeypair("LEDGER_SECRET_KEY");
  const signalKp   = loadKeypair("SIGNAL_SECRET_KEY");
  const scribeKp   = loadKeypair("SCRIBE_SECRET_KEY");
  const executorKp = loadKeypair("EXECUTOR_SECRET_KEY");

  // Fund only wallets that don't yet exist on-chain (friendbot ignores already-funded)
  await Promise.all([
    fundTestnetAccount(scoutKp.publicKey()).catch(() => {}),
    fundTestnetAccount(ledgerKp.publicKey()).catch(() => {}),
    fundTestnetAccount(signalKp.publicKey()).catch(() => {}),
    fundTestnetAccount(scribeKp.publicKey()).catch(() => {}),
    fundTestnetAccount(executorKp.publicKey()).catch(() => {}),
  ]);

  const walletKeys: Record<string, string> = {
    scout:    scoutKp.publicKey(),
    ledger:   ledgerKp.publicKey(),
    signal:   signalKp.publicKey(),
    scribe:   scribeKp.publicKey(),
    executor: executorKp.publicKey(),
  };

  emit("wallets", walletKeys);
  process.env.SCOUT_WALLET_ADDRESS = scoutKp.publicKey();

  for (const agentId of Object.keys(walletKeys)) {
    emit("agent_status", { agent: agentId, status: "idle" });
    emit("log", {
      message: `   ${agentId.padEnd(12)} → ${walletKeys[agentId]}`,
      level: "info",
    });
  }

  // ── 4. Register agents on Soroban contracts ────────────────────────────────
  const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const shieldId = process.env.SHIELD_CONTRACT_ID;
  const registryId = process.env.REGISTRY_CONTRACT_ID ?? process.env.IDENTITY_REGISTRY_CONTRACT_ID;
  const adminSecret = process.env.ORCHESTRATOR_SECRET_KEY;

  // Hoist registry + shield so they're accessible later (reputation reads, consensus wiring)
  let registry: InstanceType<typeof IdentityRegistry> | null = null;

  if ((shieldId || registryId) && adminSecret) {
    emit("log", { message: "🛡️  Registering agents on Soroban contracts…", level: "info" });
    try {
      const adminKp = Keypair.fromSecret(adminSecret);
      const rpc = new SorobanRpc.Server(rpcUrl);
      const shield = shieldId ? new ShieldContract(shieldId, rpc, adminKp) : null;
      registry     = registryId ? new IdentityRegistry(registryId, rpc, adminKp) : null;

      const agentDefs = [
        { id: "scout",    kp: scoutKp    },
        { id: "ledger",   kp: ledgerKp   },
        { id: "signal",   kp: signalKp   },
        { id: "scribe",   kp: scribeKp   },
        { id: "executor", kp: executorKp },
      ];

      for (const { id, kp } of agentDefs) {
        if (shield) {
          await shield.registerAgent(id, kp, BigInt(10_000_000)).catch(() => {});
        }
        if (registry) {
          await registry.registerAgent(id, `${id} agent`, id).catch(() => {});
        }
      }
      emit("log", { message: "   All agents authorized ✓", level: "success" });
    } catch (err) {
      emit("log", { message: `⚠️  On-chain registration failed: ${String(err)}`, level: "error" });
    }
  } else {
    emit("log", {
      message: "   ℹ️  Contracts not configured — running in dev mode",
      level: "info",
    });
  }

  // ── 5. Bridge bus events → SSE emitter ────────────────────────────────────
  bus.onEvent = (msg) => bridgeBusToEmitter(msg, emit);

  // Accumulate per-agent metrics from bus messages
  const spentMap: Record<string, number> = { scout: 0, ledger: 0, signal: 0, scribe: 0, executor: 0 };
  const txHashMap: Record<string, string[]> = { scout: [], ledger: [], signal: [], scribe: [], executor: [] };

  bus.subscribe("scout:complete", (msg) => {
    if (msg.runId !== runId) return;
    const p = msg.payload as Record<string, unknown>;
    spentMap["scout"] = Number(p["amountSpent"] ?? 0);
    txHashMap["scout"] = (p["txHashes"] as string[]) ?? [];
  }, runId);

  bus.subscribe("ledger:complete", (msg) => {
    if (msg.runId !== runId) return;
    const p = msg.payload as Record<string, unknown>;
    spentMap["ledger"] = Number(p["amountSpent"] ?? 0);
    txHashMap["ledger"] = (p["txHashes"] as string[]) ?? [];
  }, runId);

  bus.subscribe("signal:complete", (msg) => {
    if (msg.runId !== runId) return;
    const p = msg.payload as Record<string, unknown>;
    txHashMap["signal"] = (p["txHashes"] as string[]) ?? [];
  }, runId);

  bus.subscribe("executor:complete", (msg) => {
    if (msg.runId !== runId) return;
    const p = msg.payload as Record<string, unknown>;
    spentMap["executor"]  = Number(p["amountSpent"] ?? 0);
    txHashMap["executor"] = (p["txHashes"] as string[]) ?? [];
  }, runId);

  // ── 6. Wire receiving agents ───────────────────────────────────────────────
  const signalAgent = new SignalAgent();
  signalAgent.wire(runId, signalKp, prompt);
  emit("log", { message: "   Signal wired (waiting for Scout + Ledger)", level: "info" });

  const consensusManager = new ConsensusManager(llmProvider);
  const consensusKeypairs = new Map<string, Keypair>([
    ["signal",    signalKp],
    ["validator", Keypair.random()],   // placeholder — validator uses its own ephemeral kp
  ]);
  consensusManager.wire(
    runId,
    registry ?? undefined,
    consensusKeypairs,
    needsValidator   // reputation-gated: probation tier forces Validator regardless of confidence
  );

  const scribeAgent = new ScribeAgent(llmProvider);
  scribeAgent.wire(runId, scribeKp, scoutKp.publicKey());
  emit("log", { message: "   Scribe wired (waiting for consensus)", level: "info" });

  const executorAgent = new ExecutorAgent();

  // Wire multi-chain settlement provider if SETTLEMENT_CHAIN is configured
  const chainPref = getDefaultChainPreference();
  let settlementProvider: SettlementProvider | undefined;
  if (chainPref === "celo" && process.env.CELO_DEPLOYER_PRIVATE_KEY) {
    settlementProvider = createCeloSettlement(process.env.CELO_DEPLOYER_PRIVATE_KEY as `0x${string}`);
    emit("log", { message: "   Settlement: Celo (cUSD)", level: "info" });
  } else if (chainPref === "base" && process.env.BASE_DEPLOYER_PRIVATE_KEY) {
    settlementProvider = createBaseSettlement(process.env.BASE_DEPLOYER_PRIVATE_KEY as `0x${string}`);
    emit("log", { message: "   Settlement: Base (USDC)", level: "info" });
  } else {
    settlementProvider = createStellarSettlement(executorKp);
    emit("log", { message: "   Settlement: Stellar (XLM)", level: "info" });
  }
  if (settlementProvider) {
    executorAgent.setSettlementProvider(settlementProvider);
  }

  executorAgent.wire(runId, executorKp);
  emit("agent_status", { agent: "executor", status: "running" });
  emit("log", { message: "   Executor wired (waiting for consensus — will execute treasury action)", level: "info" });

  if (needsValidator) {
    emit("log", { message: "   🔍 Validator will be spawned if conflict detected", level: "info" });
  }

  // ── 7. Fire Scout + Ledger in parallel (Upgrade 2) ────────────────────────
  emit("log", { message: "▶ Launching Scout and Ledger in parallel…", level: "info" });
  emit("agent_status", { agent: "scout",  status: "running" });
  emit("agent_status", { agent: "ledger", status: "running" });
  emit("agent_status", { agent: "signal", status: "running" });
  emit("agent_status", { agent: "scribe", status: "running" });

  const scoutAgent  = new ScoutAgent(undefined, llmProvider);
  const ledgerAgent = new LedgerAgent();

  await Promise.all([
    scoutAgent.runBus({ task: prompt, runId, keypair: scoutKp }),
    ledgerAgent.runBus({ task: prompt, runId, keypair: ledgerKp }),
  ]);

  emit("log", { message: "   Scout and Ledger complete — Signal analysing…", level: "info" });

  // ── 8. Await final report ─────────────────────────────────────────────────
  const finalReport = await waitForFinalOutput(runId);
  bus.clear(runId);
  bus.onEvent = undefined;

  // ── 9. Build and return OrchestratorReport ────────────────────────────────
  const totalXlm = (Object.values(spentMap).reduce((a, b) => a + b, 0) / 1e7).toFixed(4);
  emit("log", {
    message: `\n💎 Pipeline complete — total spend: ${totalXlm} XLM`,
    level: "success",
  });

  // Read live on-chain reputation scores; fall back to 5000 if contracts not configured
  const reputationMap: Record<string, number> = {};
  const reputationAgents = ["scout", "ledger", "signal", "scribe", "executor"];
  if (registry) {
    await Promise.all(
      reputationAgents.map(async (id) => {
        reputationMap[id] = (await registry.getReputation(id)) ?? 5000;
      })
    );
  } else {
    for (const id of reputationAgents) reputationMap[id] = 5000;
  }

  const finalReportObj: OrchestratorReport = {
    task: prompt,
    subtasks: { scout: prompt, ledger: prompt, signal: prompt },
    results: { scout: "", ledger: "", signal: "" },
    report: finalReport,
    wallets: walletKeys,
    spent: spentMap,
    reputation: reputationMap,
    txHashes: txHashMap,
    timestamp: new Date().toISOString(),
  };

  emit("complete", {
    report: finalReport,
    wallets: walletKeys,
    spent: spentMap,
    reputation: reputationMap,
    txHashes: txHashMap,
    timestamp: finalReportObj.timestamp,
  });

  return finalReportObj;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check your .env file");
  }

  try {
    await startHorizonX402Server();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    console.log("   [main] Horizon x402 server already running on :3001 — continuing");
  }

  console.log("\n🔮 Cal-AgentKit starting…");
  console.log(`   Task: "${TASK}"`);

  const report = await runTask(TASK);

  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  const sep = "━".repeat(60);
  console.log(`\n${sep}`);
  console.log("✅  CAL-AGENTKIT REPORT");
  console.log(sep);
  console.log(`\n📋  TASK\n${report.task}`);
  console.log(`\n✍️   FINAL REPORT\n${report.report}`);
  console.log(`\n📁  Report written to: ${reportPath}`);
  console.log(`⏱️   Timestamp: ${report.timestamp}\n`);
}

const argv1 = process.argv[1] ?? "";
if (argv1.endsWith("index.ts") || argv1.endsWith("index.js")) {
  void main().catch((err) => {
    console.error("[calagent] Fatal error:", err);
    process.exit(1);
  });
}
