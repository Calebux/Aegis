/**
 * Reputation-Based Router (Upgrade 3)
 *
 * Reads each agent's on-chain reputation from the Identity Registry before
 * task assignment. Agents below 40 points are placed on "probation" and get
 * a Validator agent automatically added downstream.
 *
 * Tier thresholds:
 *   80–∞   trusted   → assigned directly, no extra steps
 *   40–79  standard  → assigned, Signal runs confidence check
 *   0–39   probation → Validator auto-spawns before Signal consumes output
 */

import { Keypair, SorobanRpc } from "@stellar/stellar-sdk";
import { IdentityRegistry } from "@calagent/agent-kit";

export type ReputationTier = "trusted" | "standard" | "probation";

export interface RoutingDecision {
  agentId: string;
  reputationScore: number;
  tier: ReputationTier;
  requiresValidation: boolean;
  message: string;
}

/**
 * Look up the agent's on-chain reputation and return a routing decision.
 * Falls back to "standard" (score 50) if contracts are not configured or
 * the agent has not yet been registered.
 */
export async function resolveRouting(
  agentId: string
): Promise<RoutingDecision> {
  let score = 50; // default — "standard" tier

  const registryId =
    process.env.REGISTRY_CONTRACT_ID ??
    process.env.IDENTITY_REGISTRY_CONTRACT_ID;
  const adminSecret = process.env.ORCHESTRATOR_SECRET_KEY;
  const rpcUrl =
    process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

  if (registryId && adminSecret) {
    try {
      const adminKeypair = Keypair.fromSecret(adminSecret);
      const rpc = new SorobanRpc.Server(rpcUrl);
      const registry = new IdentityRegistry(registryId, rpc, adminKeypair);
      const onChainScore = await registry.getReputation(agentId);
      if (onChainScore !== null) score = onChainScore;
    } catch {
      // Non-fatal — use default score
    }
  }

  return buildDecision(agentId, score);
}

function buildDecision(agentId: string, score: number): RoutingDecision {
  if (score >= 80) {
    return {
      agentId,
      reputationScore: score,
      tier: "trusted",
      requiresValidation: false,
      message: `Agent ${agentId} is trusted (score: ${score}). Assigned directly.`,
    };
  }

  if (score >= 40) {
    return {
      agentId,
      reputationScore: score,
      tier: "standard",
      requiresValidation: false,
      message: `Agent ${agentId} is standard (score: ${score}). Signal will check confidence.`,
    };
  }

  return {
    agentId,
    reputationScore: score,
    tier: "probation",
    requiresValidation: true,
    message: `Agent ${agentId} is on probation (score: ${score}). Validator will be added downstream.`,
  };
}
