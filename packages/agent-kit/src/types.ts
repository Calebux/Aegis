import type { EventEmitter } from "events";
import type { Keypair } from "@stellar/stellar-sdk";

// ── Agent definition ──────────────────────────────────────────────────────────

export interface AgentContext {
  /** This agent's funded Stellar keypair */
  wallet: Keypair;
  /**
   * Pay-and-fetch helper. Probes the URL; if a 402 is returned it submits
   * a real Stellar XLM payment and retries automatically.
   */
  pay: <T = unknown>(url: string) => Promise<T>;
  /** Accumulates real Stellar tx hashes produced during this run */
  txHashes: string[];
}

export interface AgentRunResult {
  /** Human-readable output passed to the synthesizer */
  result: string;
  /** Actual spend, in stroops (1 XLM = 10 000 000 stroops) */
  spentStroops?: bigint;
  /** Any additional tx hashes not captured via ctx.pay */
  txHashes?: string[];
  /** Payment mode used during this run */
  paymentMode?: string;
}

export interface AgentDefinition {
  /** Unique identifier — used as the on-chain agent ID */
  id: string;
  /** Maximum XLM this agent is allowed to spend (default: 1 XLM) */
  spendCapXlm?: number;
  run: (task: string, ctx: AgentContext) => Promise<AgentRunResult>;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  /** Soroban Shield Contract ID — enforces per-agent spend caps on-chain */
  shieldContractId?: string;
  /** Soroban Identity Registry Contract ID — tracks agent reputation on-chain */
  registryContractId?: string;
  /**
   * Optional task decomposer. Receives the raw task and a list of agent IDs;
   * returns a map of agentId → subtask string.
   * If omitted, every agent receives the raw task unchanged.
   */
  decompose?: (
    task: string,
    agentIds: string[]
  ) => Promise<Record<string, string>>;
  /**
   * Optional synthesizer. Receives the original task and all agent results;
   * returns the final report string.
   * If omitted, results are concatenated with Markdown headers.
   */
  synthesize?: (task: string, results: AgentResult[]) => Promise<string>;
  /**
   * Called after all agent wallets are provisioned, before agents run.
   * Receives a map of agentId → Stellar public key.
   * Useful for cross-agent awareness (e.g. passing Scout's address to Ledger).
   */
  onWalletsProvisioned?: (wallets: Record<string, string>) => void;
}

export interface AgentResult {
  agentId: string;
  task: string;
  result: string;
  spentStroops: bigint;
  txHashes: string[];
  paymentMode: string;
}

export interface OrchestratorReport {
  task: string;
  subtasks: Record<string, string>;
  results: Record<string, string>;
  report: string;
  /** agentId → Stellar public key */
  wallets: Record<string, string>;
  /** agentId → stroops spent */
  spent: Record<string, number>;
  /** agentId → current reputation score */
  reputation: Record<string, number>;
  /** agentId → list of Stellar tx hashes */
  txHashes: Record<string, string[]>;
  timestamp: string;
}

export interface Orchestrator {
  run: (
    task: string,
    emitter?: EventEmitter
  ) => Promise<OrchestratorReport>;
}
