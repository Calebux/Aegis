/**
 * Trust Score System
 *
 * Composable trust scoring for Cal-AgentKit agents. Aggregates multiple
 * on-chain and off-chain signals into a single 0–1000 score.
 */

import type { CeloIdentityRegistry } from "./contracts/celo-registry.js";
import type { AgentStakingManager } from "./contracts/agent-staking.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrustScoreProvider {
  /** Human-readable provider name */
  name: string;
  /** Weight in the composite score (0–1, all weights should sum to 1) */
  weight: number;
  /** Return a score between 0 and 1000 for the given agent. */
  getScore(agentId: string): Promise<number>;
}

export interface TrustScoreBreakdown {
  provider: string;
  weight: number;
  rawScore: number;
  weightedScore: number;
}

export interface TrustScoreResult {
  /** Composite score 0–1000 */
  score: number;
  /** Per-provider breakdown */
  breakdown: TrustScoreBreakdown[];
  /** Agent evaluated */
  agentId: string;
  /** Timestamp of evaluation */
  evaluatedAt: string;
}

// ── Built-in Providers ────────────────────────────────────────────────────────

/**
 * Derives trust from on-chain reputation stored in CalagentCeloRegistry.
 * Maps reputation linearly: 0 rep → 0, 100+ rep → 1000.
 */
export class ReputationProvider implements TrustScoreProvider {
  name = "reputation";
  weight: number;
  private registry: CeloIdentityRegistry;

  constructor(registry: CeloIdentityRegistry, weight = 0.3) {
    this.registry = registry;
    this.weight = weight;
  }

  async getScore(agentId: string): Promise<number> {
    try {
      const rep = await this.registry.getReputation(agentId);
      if (rep === null) return 0;
      return Math.min(1000, rep * 10);
    } catch {
      return 0;
    }
  }
}

/**
 * Derives trust from staked amount. Higher stake → higher trust.
 * Maps: 0 staked → 0, 1000+ tokens (18 decimals) → 1000.
 */
export class StakeProvider implements TrustScoreProvider {
  name = "stake";
  weight: number;
  private staking: AgentStakingManager;
  private maxStakeWei: bigint;

  constructor(
    staking: AgentStakingManager,
    weight = 0.2,
    maxStakeTokens = 1000n
  ) {
    this.staking = staking;
    this.weight = weight;
    this.maxStakeWei = maxStakeTokens * 10n ** 18n;
  }

  async getScore(agentId: string): Promise<number> {
    try {
      const stake = await this.staking.getStake(agentId);
      if (stake === 0n) return 0;
      if (stake >= this.maxStakeWei) return 1000;
      return Number((stake * 1000n) / this.maxStakeWei);
    } catch {
      return 0;
    }
  }
}

/**
 * Derives trust from task completion ratio.
 * Accepts a callback that returns { completed, failed } for an agent.
 * 100% completion → 1000, 0% → 0.
 */
export class TaskCompletionProvider implements TrustScoreProvider {
  name = "task-completion";
  weight: number;
  private getStats: (agentId: string) => Promise<{ completed: number; failed: number }>;

  constructor(
    getStats: (agentId: string) => Promise<{ completed: number; failed: number }>,
    weight = 0.3
  ) {
    this.getStats = getStats;
    this.weight = weight;
  }

  async getScore(agentId: string): Promise<number> {
    try {
      const { completed, failed } = await this.getStats(agentId);
      const total = completed + failed;
      if (total === 0) return 0;
      return Math.round((completed / total) * 1000);
    } catch {
      return 0;
    }
  }
}

/**
 * Derives trust from escrow completion stats via a user-provided callback.
 * Accepts (agentId) => { completed, total } and converts to 0–1000.
 */
export class EscrowCompletionProvider implements TrustScoreProvider {
  name = "escrow-completion";
  weight: number;
  private getStats: (agentId: string) => Promise<{ completed: number; total: number }>;

  constructor(
    getStats: (agentId: string) => Promise<{ completed: number; total: number }>,
    weight = 0.2
  ) {
    this.getStats = getStats;
    this.weight = weight;
  }

  async getScore(agentId: string): Promise<number> {
    try {
      const { completed, total } = await this.getStats(agentId);
      if (total === 0) return 0;
      return Math.round((completed / total) * 1000);
    } catch {
      return 0;
    }
  }
}

// ── Core Function ─────────────────────────────────────────────────────────────

/**
 * Calculate a composite trust score from multiple providers.
 * Each provider returns 0–1000; the final score is a weighted average.
 */
export async function calculateTrustScore(
  agentId: string,
  providers: TrustScoreProvider[]
): Promise<TrustScoreResult> {
  const breakdown: TrustScoreBreakdown[] = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;

  const results = await Promise.allSettled(
    providers.map(async (p) => ({
      provider: p.name,
      weight: p.weight,
      rawScore: await p.getScore(agentId),
    }))
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { provider, weight, rawScore } = result.value;
      const clamped = Math.max(0, Math.min(1000, rawScore));
      const weightedScore = clamped * weight;
      breakdown.push({ provider, weight, rawScore: clamped, weightedScore });
      totalWeightedScore += weightedScore;
      totalWeight += weight;
    }
  }

  const score = totalWeight > 0
    ? Math.round(totalWeightedScore / totalWeight)
    : 0;

  return {
    score,
    breakdown,
    agentId,
    evaluatedAt: new Date().toISOString(),
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface DefaultTrustProviderConfig {
  registry: CeloIdentityRegistry;
  staking?: AgentStakingManager;
  taskStats?: (agentId: string) => Promise<{ completed: number; failed: number }>;
  escrowStats?: (agentId: string) => Promise<{ completed: number; total: number }>;
}

/**
 * Create the default set of trust providers with standard weights.
 */
export function createDefaultTrustProviders(
  config: DefaultTrustProviderConfig
): TrustScoreProvider[] {
  const providers: TrustScoreProvider[] = [
    new ReputationProvider(config.registry, 0.3),
  ];

  if (config.taskStats) {
    providers.push(new TaskCompletionProvider(config.taskStats, 0.3));
  }

  if (config.staking) {
    providers.push(new StakeProvider(config.staking, 0.2));
  }

  if (config.escrowStats) {
    providers.push(new EscrowCompletionProvider(config.escrowStats, 0.2));
  }

  return providers;
}
