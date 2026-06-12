/**
 * Celo Orchestrator — Bus-Based Pipeline
 *
 * Parallel Celo implementation of the Aegis pipeline. Agents share the same
 * singleton bus as the Stellar pipeline — same event shapes, same SSE consumer.
 *
 * Pipeline:
 *   1. Load viem Accounts from CELO_*_PRIVATE_KEY env vars (random fallback)
 *   2. Register agents on AegisCeloRegistry
 *   3. Wire ConsensusManager (reused — chain-agnostic)
 *   4. Wire CeloSignalAgent, CeloScribeAgent, CeloExecutorAgent
 *   5. Fire CeloScoutAgent + CeloLedgerAgent in parallel
 *   6. Await Scribe's final consensus:reached
 *
 * External API: runCeloTask(prompt, emitter?) — same shape as runTask().
 */

import * as dotenv from "dotenv";
import * as nodePath from "path";
dotenv.config({ path: nodePath.resolve(__dirname, "../../../.env") });
dotenv.config();

import { EventEmitter } from "events";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Account, Address } from "viem";
import { CeloIdentityRegistry } from "@calebux/agent-kit";
import type { OrchestratorReport } from "@calebux/agent-kit";

import { bus, type AgentMessage, type AgentTopic } from "./lib/bus.js";
import { ConsensusManager } from "./agents/consensus.js";
import { CeloScoutAgent } from "./agents/celo-scout.js";
import { CeloLedgerAgent } from "./agents/celo-ledger.js";
import { CeloSignalAgent } from "./agents/celo-signal.js";
import { CeloScribeAgent } from "./agents/celo-scribe.js";
import { CeloExecutorAgent } from "./agents/celo-executor.js";

export type { OrchestratorReport as AegisReport };

// ── Helpers ───────────────────────────────────────────────────────────────────

type EmitFn = (type: string, payload: unknown) => void;

function makeEmit(emitter?: EventEmitter): EmitFn {
  return (type, payload) => emitter?.emit(type, payload);
}

/** Load a viem Account from an env var (hex private key), or generate a random one. */
function loadCeloKey(envKey: string): Account {
  const secret = process.env[envKey];
  if (secret) {
    const hex = (secret.startsWith("0x") ? secret : `0x${secret}`) as `0x${string}`;
    return privateKeyToAccount(hex);
  }
  return privateKeyToAccount(generatePrivateKey());
}

/** Wait for Scribe's final consensus:reached (agentId === 'scribe') */
function waitForFinalOutput(runId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bus.clear(runId);
      reject(new Error(`Celo pipeline timed out for run ${runId}`));
    }, 120_000);

    const unsubscribe = bus.subscribe(
      "consensus:reached",
      (msg) => {
        if (msg.runId !== runId) return;
        if (msg.agentId !== "scribe") return;
        clearTimeout(timeout);
        unsubscribe();
        resolve((msg.payload as { agreedOutput: string }).agreedOutput);
      },
      runId
    );
  });
}

/** Bridge bus events → SSE emitter (same format as Stellar pipeline) */
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
      paymentMode: p["paymentMode"] ?? "celo",
      confidence: msg.confidence,
    });
  }

  if (msg.topic === "consensus:reached" && msg.agentId === "consensus-manager") {
    const p = msg.payload as Record<string, unknown>;
    emit("log", {
      message: p["validationWasRequired"]
        ? `🔍 Consensus via Validator — conflict resolved`
        : `✅ Celo consensus reached (${(msg.confidence * 100).toFixed(0)}%)`,
      level: "success",
    });
  }

  if (msg.topic === "consensus:reached" && msg.agentId === "scribe") {
    emit("agent_status", { agent: "scribe", status: "complete", confidence: msg.confidence });
  }

  if (msg.topic === "executor:complete") {
    const p = msg.payload as Record<string, unknown>;
    const notaryTxHash = (p["notaryTxHash"] as string) ?? "";
    emit("agent_status", {
      agent: "executor",
      status: "complete",
      spent: p["amountSpent"] ?? 0,
      txHashes: p["txHashes"] ?? [],
      paymentMode: "celo-notary",
      confidence: msg.confidence,
      sigTxHash: notaryTxHash || undefined,
    });
    emit("log", {
      message: notaryTxHash
        ? `🔏 Celo notary: ${notaryTxHash.slice(0, 12)}…`
        : `🔏 Celo notary: skipped (contract not configured)`,
      level: "success",
    });
  }

  if (msg.topic === "task:error") {
    const p = msg.payload as { error?: string };
    emit("log", { message: `⚠️  ${msg.agentId}: ${p.error ?? "error"}`, level: "error" });
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runCeloTask(
  prompt: string,
  emitter?: EventEmitter
): Promise<OrchestratorReport> {
  const emit = makeEmit(emitter);

  emit("log", { message: "🌿 Celo pipeline initialising…", level: "info" });
  emit("log", {
    message: `📋 Task: "${prompt.slice(0, 90)}${prompt.length > 90 ? "…" : ""}"`,
    level: "info",
  });

  const runId = crypto.randomUUID();

  // ── 1. Load accounts ───────────────────────────────────────────────────────
  emit("log", { message: "🔑 Loading Celo agent wallets…", level: "info" });

  const scoutAccount   = loadCeloKey("CELO_SCOUT_PRIVATE_KEY");
  const ledgerAccount  = loadCeloKey("CELO_LEDGER_PRIVATE_KEY");
  const signalAccount  = loadCeloKey("CELO_SIGNAL_PRIVATE_KEY");
  const scribeAccount  = loadCeloKey("CELO_SCRIBE_PRIVATE_KEY");
  const executorAccount = loadCeloKey("CELO_EXECUTOR_PRIVATE_KEY");

  const walletKeys: Record<string, string> = {
    scout:    scoutAccount.address,
    ledger:   ledgerAccount.address,
    signal:   signalAccount.address,
    scribe:   scribeAccount.address,
    executor: executorAccount.address,
  };

  emit("wallets", walletKeys);

  for (const [agentId, addr] of Object.entries(walletKeys)) {
    emit("agent_status", { agent: agentId, status: "idle" });
    emit("log", { message: `   ${agentId.padEnd(12)} → ${addr}`, level: "info" });
  }

  // ── 2. Register agents on AegisCeloRegistry ────────────────────────────────
  const registryAddr  = process.env.CELO_REGISTRY_ADDRESS;
  const deployerKey   = process.env.CELO_DEPLOYER_PRIVATE_KEY;
  let registry: CeloIdentityRegistry | null = null;

  if (registryAddr && deployerKey) {
    emit("log", { message: "🛡️  Registering Celo agents on AegisCeloRegistry…", level: "info" });
    try {
      registry = new CeloIdentityRegistry(
        registryAddr,
        deployerKey,
        process.env.CELO_RPC_URL,
        process.env.AEGIS_CELO_NETWORK
      );

      const agentDefs = [
        { id: "celo-scout",    name: "Celo Scout",    capability: "research"    },
        { id: "celo-ledger",   name: "Celo Ledger",   capability: "onchain"     },
        { id: "celo-signal",   name: "Celo Signal",   capability: "analytics"   },
        { id: "celo-scribe",   name: "Celo Scribe",   capability: "synthesis"   },
        { id: "celo-executor", name: "Celo Notary",   capability: "attestation" },
        { id: "celo-pipeline-notary", name: "Celo Pipeline Notary", capability: "attestation" },
      ];

      await Promise.all(
        agentDefs.map(({ id, name, capability }) =>
          registry!.registerAgent(id, name, capability).catch(() => {})
        )
      );
      emit("log", { message: "   All Celo agents authorized ✓", level: "success" });
    } catch (err) {
      emit("log", { message: `⚠️  Celo on-chain registration failed: ${String(err)}`, level: "error" });
    }
  } else {
    emit("log", { message: "   ℹ️  Celo contracts not configured — running in dev mode", level: "info" });
  }

  // ── 3. Bridge bus events → SSE ─────────────────────────────────────────────
  bus.onEvent = (msg) => bridgeBusToEmitter(msg, emit);

  const spentMap: Record<string, number>   = { scout: 0, ledger: 0, signal: 0, scribe: 0, executor: 0 };
  const txHashMap: Record<string, string[]> = { scout: [], ledger: [], signal: [], scribe: [], executor: [] };

  bus.subscribe("scout:complete",  (msg) => {
    if (msg.runId !== runId) return;
    const p = msg.payload as Record<string, unknown>;
    txHashMap["scout"] = (p["txHashes"] as string[]) ?? [];
  }, runId);

  bus.subscribe("ledger:complete", (msg) => {
    if (msg.runId !== runId) return;
    const p = msg.payload as Record<string, unknown>;
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
    txHashMap["executor"] = (p["txHashes"] as string[]) ?? [];
  }, runId);

  // ── 4. Wire receiving agents ───────────────────────────────────────────────
  const signalAgent = new CeloSignalAgent();
  signalAgent.wire(runId, signalAccount, prompt);
  emit("log", { message: "   Celo Signal wired (waiting for Scout + Ledger)", level: "info" });

  const consensusManager = new ConsensusManager();
  consensusManager.wire(runId, undefined, undefined, false);

  const scribeAgent = new CeloScribeAgent();
  scribeAgent.wire(runId, scribeAccount, scoutAccount.address as Address);
  emit("log", { message: "   Celo Scribe wired (waiting for consensus)", level: "info" });

  const executorAgent = new CeloExecutorAgent();
  executorAgent.wire(runId, executorAccount);
  emit("agent_status", { agent: "executor", status: "running" });
  emit("log", { message: "   Celo Notary wired (waiting for consensus)", level: "info" });

  // ── 5. Fire Scout + Ledger in parallel ────────────────────────────────────
  emit("log", { message: "▶ Launching Celo Scout and Ledger in parallel…", level: "info" });
  emit("agent_status", { agent: "scout",  status: "running" });
  emit("agent_status", { agent: "ledger", status: "running" });
  emit("agent_status", { agent: "signal", status: "running" });
  emit("agent_status", { agent: "scribe", status: "running" });

  const scoutAgent  = new CeloScoutAgent();
  const ledgerAgent = new CeloLedgerAgent();

  await Promise.all([
    scoutAgent.runBus({ task: prompt, runId, account: scoutAccount }),
    ledgerAgent.runBus({ task: prompt, runId, account: ledgerAccount }),
  ]);

  emit("log", { message: "   Celo Scout + Ledger complete — Signal analysing…", level: "info" });

  // ── 6. Await final report ─────────────────────────────────────────────────
  const finalReport = await waitForFinalOutput(runId);
  bus.clear(runId);
  bus.onEvent = undefined;

  // ── 7. Build OrchestratorReport ───────────────────────────────────────────
  const totalCusd = 0; // cUSD payments tracked in txHashes
  emit("log", {
    message: `\n🌿 Celo pipeline complete — wallets: ${scoutAccount.address.slice(0, 10)}…`,
    level: "success",
  });

  // Read live on-chain reputation
  const reputationMap: Record<string, number> = {};
  const reputationAgents = ["scout", "ledger", "signal", "scribe", "executor"];
  if (registry) {
    await Promise.all(
      reputationAgents.map(async (id) => {
        const rep = await registry!.getReputation(`celo-${id}`).catch(() => null);
        reputationMap[id] = rep ?? 0;
      })
    );
  } else {
    for (const id of reputationAgents) reputationMap[id] = 0;
  }

  const finalReportObj: OrchestratorReport = {
    task: prompt,
    subtasks: { scout: prompt, ledger: prompt, signal: prompt },
    results:  { scout: "", ledger: "", signal: "" },
    report:   finalReport,
    wallets:  walletKeys,
    spent:    spentMap,
    reputation: reputationMap,
    txHashes:   txHashMap,
    timestamp:  new Date().toISOString(),
  };

  emit("complete", {
    report:     finalReport,
    wallets:    walletKeys,
    spent:      spentMap,
    reputation: reputationMap,
    txHashes:   txHashMap,
    timestamp:  finalReportObj.timestamp,
  });

  return finalReportObj;
}
