/**
 * Run Store
 *
 * Module-level singleton that holds the last completed Aegis run's wallet
 * data. Lives for the lifetime of the Next.js server process so /api/status
 * can return real addresses and spend figures without a database.
 */

export type AgentId = "scout" | "ledger" | "signal" | "scribe";

export interface AgentRunData {
  publicKey: string;
  spentStroops: number;
  reputationBps: number;
}

export interface RunState {
  agents: Record<AgentId, AgentRunData>;
  timestamp: string;
}

// Initialised to null; populated after the first successful pipeline run.
let lastRun: RunState | null = null;

export function setLastRun(state: RunState): void {
  lastRun = state;
}

export function getLastRun(): RunState | null {
  return lastRun;
}
