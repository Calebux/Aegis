/**
 * Master Orchestrator
 *
 * Responsibilities:
 *  1. Decompose a high-level task prompt into sub-tasks via Claude.
 *  2. Spawn sub-agents (Scout, Ledger, Signal, Scribe) and dispatch tasks.
 *  3. Collect results and invoke Scribe to synthesise the final report.
 *  4. Record spend and reputation updates in Soroban contracts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { keypairFromSecret, getXlmBalance } from "@aegis/shared";
import type { Task, SubTask, AgentId } from "@aegis/shared";

import { ScoutAgent } from "./agents/scout.js";
import { LedgerAgent } from "./agents/ledger.js";
import { SignalAgent } from "./agents/signal.js";
import { ScribeAgent } from "./agents/scribe.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrchestratorConfig {
  secretKey: string;
}

interface AgentResult {
  agentId: AgentId;
  result: string;
  spentStroops: bigint;
}

// ---------------------------------------------------------------------------
// Orchestrator class
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly keypair: ReturnType<typeof keypairFromSecret>;
  private readonly anthropic: Anthropic;

  private scout: ScoutAgent;
  private ledger: LedgerAgent;
  private signal: SignalAgent;
  private scribe: ScribeAgent;

  constructor(config: OrchestratorConfig) {
    this.keypair = keypairFromSecret(config.secretKey);
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // TODO: generate dedicated keypairs per agent and fund via Friendbot
    this.scout = new ScoutAgent({
      keypair: this.keypair,
      shieldContractId: process.env.SHIELD_CONTRACT_ID ?? "",
      registryContractId: process.env.REGISTRY_CONTRACT_ID ?? "",
    });
    this.ledger = new LedgerAgent();
    this.signal = new SignalAgent();
    this.scribe = new ScribeAgent();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    const balance = await getXlmBalance(this.keypair.publicKey());
    console.log(
      `[orchestrator] Wallet: ${this.keypair.publicKey()} | Balance: ${balance} XLM`
    );
    // TODO: initialise Soroban contract clients (Shield + IdentityRegistry)
    // TODO: ensure sub-agent wallets exist and are funded
    // TODO: register agents in IdentityRegistry if not already present
  }

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------

  async runTask(prompt: string): Promise<string> {
    const task: Task = {
      id: uuidv4(),
      prompt,
      status: "running",
      subTasks: [],
      createdAt: new Date(),
    };

    console.log(`[orchestrator] Task ${task.id} started`);

    // Step 1: Decompose the task into sub-tasks
    const subTasks = await this.decompose(task);
    task.subTasks = subTasks;

    // Step 2: Execute sub-tasks in parallel where possible
    const results = await this.dispatch(subTasks);

    // Step 3: Synthesise results into a final report via Scribe
    const report = await this.scribe.synthesise(prompt, results);

    task.status = "completed";
    task.finalReport = report;
    task.completedAt = new Date();

    // TODO: update reputation scores in IdentityRegistry

    return report;
  }

  // -------------------------------------------------------------------------
  // Task decomposition via Claude
  // -------------------------------------------------------------------------

  private async decompose(task: Task): Promise<SubTask[]> {
    // TODO: use Claude to intelligently decompose the task.
    // For now, return a fixed decomposition as a structural placeholder.
    console.log("[orchestrator] Decomposing task…");

    const subTasks: SubTask[] = [
      {
        id: uuidv4(),
        assignedAgent: "scout",
        instruction: `Search the web for recent information relevant to: "${task.prompt}"`,
        status: "pending",
      },
      {
        id: uuidv4(),
        assignedAgent: "ledger",
        instruction: `Fetch relevant on-chain Stellar metrics for: "${task.prompt}"`,
        status: "pending",
      },
      {
        id: uuidv4(),
        assignedAgent: "signal",
        instruction: `Identify market signals and analytics relevant to: "${task.prompt}"`,
        status: "pending",
      },
    ];

    return subTasks;
  }

  // -------------------------------------------------------------------------
  // Sub-task dispatch
  // -------------------------------------------------------------------------

  private async dispatch(subTasks: SubTask[]): Promise<AgentResult[]> {
    const results: AgentResult[] = [];

    // Run sub-tasks concurrently
    const settled = await Promise.allSettled(
      subTasks.map((st) => this.runSubTask(st))
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        console.error("[orchestrator] Sub-task failed:", outcome.reason);
      }
    }

    return results;
  }

  private async runSubTask(subTask: SubTask): Promise<AgentResult> {
    subTask.status = "running";
    subTask.startedAt = new Date();

    let result: string;
    let spentStroops = 0n;

    try {
      switch (subTask.assignedAgent) {
        case "scout": {
          const r = await this.scout.run(subTask.instruction);
          result = r.result;
          spentStroops = r.spentStroops;
          break;
        }
        case "ledger": {
          const r = await this.ledger.run(subTask.instruction);
          result = r.result;
          spentStroops = r.spentStroops;
          break;
        }
        case "signal": {
          const r = await this.signal.run(subTask.instruction);
          result = r.result;
          spentStroops = r.spentStroops;
          break;
        }
        default:
          throw new Error(`Unknown agent: ${subTask.assignedAgent}`);
      }

      subTask.status = "completed";
      subTask.result = result;
      subTask.spentStroops = spentStroops;
    } catch (err) {
      subTask.status = "failed";
      subTask.error = String(err);
      throw err;
    } finally {
      subTask.completedAt = new Date();
    }

    return { agentId: subTask.assignedAgent, result, spentStroops };
  }
}
