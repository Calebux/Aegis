import { EventEmitter } from "events";
import { Keypair, SorobanRpc } from "@stellar/stellar-sdk";
import { fundTestnetAccount } from "@calagent/shared";
import type {
  AgentDefinition,
  AgentContext,
  AgentResult,
  OrchestratorOptions,
  OrchestratorReport,
  Orchestrator,
} from "./types.js";
import { payAndFetch, submitXlmPayment } from "./payments.js";
import { ShieldContract } from "./contracts/shield.js";
import { IdentityRegistry } from "./contracts/registry.js";
import { createAgentManifests } from "./discovery.js";

/**
 * Create a governed multi-agent orchestrator.
 *
 * Each agent automatically receives:
 *   - A freshly funded Stellar testnet wallet
 *   - Registration on the Soroban Shield Contract (spend cap enforcement)
 *   - Registration on the Soroban Identity Registry (reputation tracking)
 *   - An injected `pay()` helper for x402 payments
 *
 * @example
 * ```ts
 * const { run } = createOrchestrator([researchAgent, analystAgent], {
 *   shieldContractId: process.env.SHIELD_CONTRACT_ID,
 *   registryContractId: process.env.REGISTRY_CONTRACT_ID,
 *   synthesize: async (task, results) => {
 *     // combine results into a final report
 *     return results.map(r => r.result).join('\n\n')
 *   }
 * })
 *
 * const report = await run('Analyze XLM/USDC market trends')
 * ```
 */
export function createOrchestrator(
  agents: AgentDefinition[],
  options: OrchestratorOptions = {}
): Orchestrator {
  const {
    shieldContractId = process.env.SHIELD_CONTRACT_ID ?? "",
    registryContractId = process.env.REGISTRY_CONTRACT_ID ?? "",
    decompose,
    synthesize,
    onWalletsProvisioned,
    memory,
  } = options;

  // Per-orchestrator reputation cache (persists across runs in the same process)
  const reputationCache = new Map<string, number>(
    agents.map((a) => [a.id, 5000])
  );

  async function run(
    task: string,
    emitter?: EventEmitter
  ): Promise<OrchestratorReport> {
    const emit = (type: string, payload: unknown) =>
      emitter?.emit(type, payload);

    emit("log", { message: "🔮 agent-kit initializing…", level: "info" });
    emit("log", {
      message: `📋 Task: "${task.slice(0, 90)}${task.length > 90 ? "…" : ""}"`,
      level: "info",
    });

    // ── 1. Decompose task ────────────────────────────────────────────────
    let subtasks: Record<string, string> = {};
    if (decompose) {
      emit("log", { message: "🧠 Decomposing task…", level: "info" });
      subtasks = await decompose(task, agents.map((a) => a.id));
      for (const [id, sub] of Object.entries(subtasks)) {
        emit("log", { message: `   ${id.padEnd(12)} → ${sub}`, level: "info" });
      }
    } else {
      for (const agent of agents) subtasks[agent.id] = task;
    }

    // ── 2. Provision wallets ─────────────────────────────────────────────
    emit("log", { message: "🔑 Provisioning agent wallets…", level: "info" });
    const wallets = new Map<string, Keypair>();

    await Promise.all(
      agents.map(async (agent) => {
        const keypair = Keypair.random();
        try {
          await fundTestnetAccount(keypair.publicKey());
        } catch (err) {
          emit("log", {
            message: `⚠️  Friendbot failed for ${agent.id}: ${String(err)}`,
            level: "error",
          });
        }
        wallets.set(agent.id, keypair);
        emit("log", {
          message: `   ${agent.id.padEnd(12)} → ${keypair.publicKey()}`,
          level: "info",
        });
      })
    );

    const walletKeys: Record<string, string> = {};
    for (const [id, kp] of wallets) walletKeys[id] = kp.publicKey();
    emit("wallets", walletKeys);
    emit("agent_manifests", createAgentManifests(agents, walletKeys));
    for (const agent of agents) {
      emit("agent_status", { agent: agent.id, status: "idle" });
    }

    // Notify caller of provisioned wallets (for cross-agent awareness)
    onWalletsProvisioned?.(walletKeys);

    // ── 3. Register agents on-chain ──────────────────────────────────────
    const rpcUrl =
      process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
    let shield: ShieldContract | null = null;
    let registry: IdentityRegistry | null = null;

    if (shieldContractId || registryContractId) {
      const adminSecret = process.env.ORCHESTRATOR_SECRET_KEY;
      if (adminSecret) {
        emit("log", {
          message: "🛡️  Registering agents on Soroban contracts…",
          level: "info",
        });
        const adminKeypair = Keypair.fromSecret(adminSecret);
        const rpc = new SorobanRpc.Server(rpcUrl);

        shield = shieldContractId
          ? new ShieldContract(shieldContractId, rpc, adminKeypair)
          : null;
        registry = registryContractId
          ? new IdentityRegistry(registryContractId, rpc, adminKeypair)
          : null;

        for (const agent of agents) {
          const keypair = wallets.get(agent.id)!;
          const capStroops = BigInt(
            Math.round((agent.spendCapXlm ?? 1) * 10_000_000)
          );

          if (shield) {
            await shield
              .registerAgent(agent.id, keypair, capStroops)
              .catch((err) =>
                emit("log", {
                  message: `⚠️  Shield reg failed for ${agent.id}: ${String(err)}`,
                  level: "error",
                })
              );
          }
          if (registry) {
            await registry
              .registerAgent(agent.id, `${agent.id} agent`, agent.id)
              .catch((err) =>
                emit("log", {
                  message: `⚠️  Registry reg failed for ${agent.id}: ${String(err)}`,
                  level: "error",
                })
              );
          }
        }
        emit("log", { message: "   All agents authorized ✓", level: "success" });
      } else {
        emit("log", {
          message:
            "   ℹ️  ORCHESTRATOR_SECRET_KEY not set — skipping on-chain registration",
          level: "info",
        });
      }
    }

    // ── 4. Run agents in parallel ────────────────────────────────────────
    for (const agent of agents) {
      emit("agent_status", { agent: agent.id, status: "running" });
      emit("log", { message: `▶ ${agent.id} starting…`, level: "info" });
    }

    const agentResults: AgentResult[] = await Promise.all(
      agents.map(async (agent): Promise<AgentResult> => {
        const keypair = wallets.get(agent.id)!;
        const agentTask = subtasks[agent.id] ?? task;
        const txHashes: string[] = [];

        const ctx: AgentContext = {
          wallet: keypair,
          txHashes,
          memory,
          pay: async <T = unknown>(url: string): Promise<T> => {
            const probe = await fetch(url);
            if (probe.ok) return probe.json() as Promise<T>;
            if (probe.status !== 402) {
              throw new Error(`Unexpected status ${probe.status} from ${url}`);
            }
            const { payTo, amount, nonce } = await probe.json() as {
              payTo: string; amount: string; nonce: string;
            };
            // Authorize spend on Shield Contract before submitting payment
            if (shield) {
              const amountStroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));
              await shield.authorizeSpend(agent.id, amountStroops).catch((err) => {
                throw new Error(`Shield blocked spend for ${agent.id}: ${String(err)}`);
              });
            }
            const txHash = await submitXlmPayment(keypair, payTo, amount);
            txHashes.push(txHash);
            const resp = await fetch(url, {
              headers: { "x-payment-tx-hash": txHash, "x-payment-nonce": nonce },
            });
            if (!resp.ok) throw new Error(`Data fetch failed after payment: ${resp.status}`);
            return resp.json() as Promise<T>;
          },
        };

        try {
          const res = await agent.run(agentTask, ctx);
          reputationCache.set(
            agent.id,
            (reputationCache.get(agent.id) ?? 5000) + 250
          );

          // Record success on Identity Registry (non-blocking)
          if (registry) {
            registry.recordSuccess(agent.id, keypair).catch(() => {});
          }

          const allHashes = [...txHashes, ...(res.txHashes ?? [])];
          emit("agent_status", {
            agent: agent.id,
            status: "complete",
            spent: Number(res.spentStroops ?? 0n),
            txHashes: allHashes,
            paymentMode: res.paymentMode ?? "dev",
          });
          emit("log", {
            message: `✅ ${agent.id} complete — ${(
              Number(res.spentStroops ?? 0n) / 1e7
            ).toFixed(4)} XLM spent`,
            level: "success",
          });

          return {
            agentId: agent.id,
            task: agentTask,
            result: res.result,
            spentStroops: res.spentStroops ?? 0n,
            txHashes: allHashes,
            paymentMode: res.paymentMode ?? "dev",
          };
        } catch (err) {
          reputationCache.set(
            agent.id,
            Math.max(0, (reputationCache.get(agent.id) ?? 5000) - 100)
          );

          // Record failure on Identity Registry (non-blocking)
          if (registry) {
            registry.recordFailure(agent.id, keypair).catch(() => {});
          }

          emit("agent_status", { agent: agent.id, status: "failed" });
          emit("log", {
            message: `❌ ${agent.id} failed: ${String(err)}`,
            level: "error",
          });

          return {
            agentId: agent.id,
            task: agentTask,
            result: `[${agent.id} error] ${String(err)}`,
            spentStroops: 0n,
            txHashes: [],
            paymentMode: "dev",
          };
        }
      })
    );

    // ── 5. Synthesize ────────────────────────────────────────────────────
    let report = "";
    if (synthesize) {
      emit("log", { message: "✍️  Synthesizing results…", level: "info" });
      report = await synthesize(task, agentResults);
    } else {
      report = agentResults
        .map((r) => `## ${r.agentId}\n\n${r.result}`)
        .join("\n\n---\n\n");
    }

    // ── 6. Build final report ────────────────────────────────────────────
    const spentMap: Record<string, number> = {};
    const txHashMap: Record<string, string[]> = {};
    const resultsMap: Record<string, string> = {};

    for (const r of agentResults) {
      spentMap[r.agentId] = Number(r.spentStroops);
      txHashMap[r.agentId] = r.txHashes;
      resultsMap[r.agentId] = r.result;
    }

    const reputationMap: Record<string, number> = {};
    for (const agent of agents) {
      reputationMap[agent.id] = reputationCache.get(agent.id) ?? 5000;
    }

    const totalXlm = (
      Object.values(spentMap).reduce((a, b) => a + b, 0) / 1e7
    ).toFixed(4);
    emit("log", {
      message: `\n💎 Pipeline complete — total spend: ${totalXlm} XLM`,
      level: "success",
    });

    const finalReport: OrchestratorReport = {
      task,
      subtasks,
      results: resultsMap,
      report,
      wallets: walletKeys,
      spent: spentMap,
      reputation: reputationMap,
      txHashes: txHashMap,
      timestamp: new Date().toISOString(),
    };

    // ── 7. Auto-store run results in memory ─────────────────────────────
    if (memory) {
      const runKey = `run/${finalReport.timestamp}`;
      const summary = agentResults
        .map((r) => `${r.agentId}: ${r.result.slice(0, 200)}`)
        .join("\n");
      memory.store(runKey, summary, { task, timestamp: finalReport.timestamp }).catch(() => {});
    }

    emit("complete", {
      report,
      wallets: walletKeys,
      spent: spentMap,
      reputation: reputationMap,
      txHashes: txHashMap,
      timestamp: finalReport.timestamp,
    });

    return finalReport;
  }

  return { run };
}
