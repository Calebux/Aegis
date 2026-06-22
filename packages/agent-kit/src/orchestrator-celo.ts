/**
 * createCeloOrchestrator — Celo-native multi-agent orchestrator.
 *
 * Drop-in alternative to createOrchestrator for Celo/EVM agents.
 * Uses viem wallets, CeloIdentityRegistry for reputation, CeloPolicyManager
 * for spend-cap enforcement, and cUSD x402 payments instead of Stellar XLM.
 */
import { EventEmitter } from "events";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Account, Address } from "viem";
import { CeloIdentityRegistry } from "./contracts/celo-registry.js";
import { CeloPolicyManager } from "./contracts/celo-policy.js";
import { payAndFetchCelo, submitCusdPayment } from "./payments-celo.js";
import { createAgentManifests } from "./discovery.js";
import type {
  AgentDefinition,
  AgentContext,
  AgentResult,
  OrchestratorReport,
  Orchestrator,
} from "./types.js";
import type { MemoryProvider } from "./memory.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CeloOrchestratorOptions {
  /** CalagentCeloRegistry contract address */
  registryAddress?: string;
  /** CalagentCeloPolicy contract address */
  policyAddress?: string;
  /** Admin private key for on-chain registration (hex, with or without 0x) */
  adminPrivateKey?: string;
  /** Celo RPC URL (defaults to env CELO_RPC_URL) */
  rpcUrl?: string;
  /** "mainnet" or "alfajores" (defaults to env CALAGENT_CELO_NETWORK) */
  network?: string;
  /** Optional memory provider */
  memory?: MemoryProvider;
  /** Default per-agent spend cap in cUSD wei (default: 1 cUSD = 1e18) */
  defaultSpendCapWei?: bigint;
  /** Task decomposer */
  decompose?: (task: string, agentIds: string[]) => Promise<Record<string, string>>;
  /** Result synthesizer */
  synthesize?: (task: string, results: AgentResult[]) => Promise<string>;
  /** Called after wallets are provisioned */
  onWalletsProvisioned?: (wallets: Record<string, string>) => void;
}

// ── Implementation ───────────────────────────────────────────────────────────

export function createCeloOrchestrator(
  agents: AgentDefinition[],
  options: CeloOrchestratorOptions = {}
): Orchestrator {
  const {
    registryAddress = process.env.CELO_REGISTRY_ADDRESS ?? "",
    policyAddress = process.env.CELO_POLICY_ADDRESS ?? "",
    adminPrivateKey = process.env.CELO_DEPLOYER_PRIVATE_KEY ?? "",
    rpcUrl,
    network,
    memory,
    defaultSpendCapWei = BigInt("1000000000000000000"), // 1 cUSD
    decompose,
    synthesize,
    onWalletsProvisioned,
  } = options;

  const reputationCache = new Map<string, number>(
    agents.map((a) => [a.id, 5000])
  );

  async function run(
    task: string,
    emitter?: EventEmitter
  ): Promise<OrchestratorReport> {
    const emit = (type: string, payload: unknown) =>
      emitter?.emit(type, payload);

    emit("log", { message: "Celo orchestrator initializing...", level: "info" });

    // ── 1. Decompose task ──────────────────────────────────────────────
    let subtasks: Record<string, string> = {};
    if (decompose) {
      subtasks = await decompose(task, agents.map((a) => a.id));
    } else {
      for (const agent of agents) subtasks[agent.id] = task;
    }

    // ── 2. Provision EVM wallets ───────────────────────────────────────
    emit("log", { message: "Provisioning Celo wallets...", level: "info" });
    const wallets = new Map<string, Account>();

    for (const agent of agents) {
      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);
      wallets.set(agent.id, account);
      emit("log", {
        message: `   ${agent.id.padEnd(12)} -> ${account.address}`,
        level: "info",
      });
    }

    const walletKeys: Record<string, string> = {};
    for (const [id, acct] of wallets) walletKeys[id] = acct.address;
    emit("wallets", walletKeys);
    emit("agent_manifests", createAgentManifests(agents, walletKeys));
    onWalletsProvisioned?.(walletKeys);

    // ── 3. Register agents on-chain ────────────────────────────────────
    let registry: CeloIdentityRegistry | null = null;
    let policy: CeloPolicyManager | null = null;

    if (adminPrivateKey && (registryAddress || policyAddress)) {
      emit("log", { message: "Registering agents on Celo contracts...", level: "info" });

      if (registryAddress) {
        registry = new CeloIdentityRegistry(registryAddress, adminPrivateKey, rpcUrl, network);
        for (const agent of agents) {
          await registry.registerAgent(agent.id, `${agent.id} agent`, agent.id).catch((err) =>
            emit("log", {
              message: `Registry reg failed for ${agent.id}: ${String(err)}`,
              level: "error",
            })
          );
        }
      }

      if (policyAddress) {
        policy = new CeloPolicyManager(policyAddress, adminPrivateKey, rpcUrl, network);
        for (const agent of agents) {
          const cap = agent.spendCapXlm
            ? BigInt(Math.round(agent.spendCapXlm * 1e18))
            : defaultSpendCapWei;
          await policy.setPolicy(agent.id, cap).catch((err) =>
            emit("log", {
              message: `Policy set failed for ${agent.id}: ${String(err)}`,
              level: "error",
            })
          );
        }
      }

      emit("log", { message: "   All agents authorized", level: "success" });
    } else {
      emit("log", {
        message: "   No admin key — skipping on-chain registration",
        level: "info",
      });
    }

    // ── 4. Run agents in parallel ──────────────────────────────────────
    const agentResults: AgentResult[] = await Promise.all(
      agents.map(async (agent): Promise<AgentResult> => {
        const account = wallets.get(agent.id)!;
        const agentTask = subtasks[agent.id] ?? task;
        const txHashes: string[] = [];

        // Build a Stellar-compatible context shim so AgentDefinition.run works
        // The wallet field is typed as Keypair but Celo agents should use ctx.pay
        const ctx: AgentContext = {
          wallet: null as never, // Celo agents should not use wallet directly
          txHashes,
          memory,
          pay: async <T = unknown>(url: string): Promise<T> => {
            const { data } = await payAndFetchCelo<T>(url, account, txHashes, rpcUrl);
            return data;
          },
        };

        try {
          emit("agent_status", { agent: agent.id, status: "running" });
          const res = await agent.run(agentTask, ctx);
          reputationCache.set(agent.id, (reputationCache.get(agent.id) ?? 5000) + 250);

          if (registry) {
            registry.recordSuccess(agent.id).catch(() => {});
          }

          const allHashes = [...txHashes, ...(res.txHashes ?? [])];
          emit("agent_status", {
            agent: agent.id,
            status: "complete",
            txHashes: allHashes,
            paymentMode: res.paymentMode ?? "dev",
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

          if (registry) {
            registry.recordFailure(agent.id).catch(() => {});
          }

          emit("agent_status", { agent: agent.id, status: "failed" });
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

    // ── 5. Synthesize ──────────────────────────────────────────────────
    let report = "";
    if (synthesize) {
      report = await synthesize(task, agentResults);
    } else {
      report = agentResults
        .map((r) => `## ${r.agentId}\n\n${r.result}`)
        .join("\n\n---\n\n");
    }

    // ── 6. Build final report ──────────────────────────────────────────
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

    // ── 7. Auto-store in memory ────────────────────────────────────────
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
