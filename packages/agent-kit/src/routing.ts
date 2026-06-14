/**
 * Capability-Based Agent Routing (Agent DNS)
 *
 * Discovers agents by capability across local manifests and federated peers,
 * ranks them by trust score, and routes tasks to the best match.
 */

import type { AgentManifest, AgentDiscoveryQuery } from "./types.js";
import { discoverAgents } from "./discovery.js";
import type { PeerRegistry, FederatedRouteResult } from "./federation.js";
import { routeToPeer } from "./federation.js";
import type { TrustScoreProvider, TrustScoreResult } from "./trust-score.js";
import { calculateTrustScore } from "./trust-score.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RankedAgent {
  manifest: AgentManifest;
  trustScore: TrustScoreResult;
  /** If from a peer, the peer's base URL */
  peerUrl?: string;
  /** Whether this agent is local or remote */
  local: boolean;
}

export interface RouteResult {
  agent: RankedAgent;
  response?: unknown;
  error?: string;
}

export interface AgentRouterOptions {
  localManifests: AgentManifest[];
  reputation?: Record<string, number>;
  peerRegistry?: PeerRegistry;
  trustProviders?: TrustScoreProvider[];
}

// ── AgentRouter ───────────────────────────────────────────────────────────────

export class AgentRouter {
  private localManifests: AgentManifest[];
  private reputation: Record<string, number>;
  private peerRegistry?: PeerRegistry;
  private trustProviders: TrustScoreProvider[];

  constructor(options: AgentRouterOptions) {
    this.localManifests = options.localManifests;
    this.reputation = options.reputation ?? {};
    this.peerRegistry = options.peerRegistry;
    this.trustProviders = options.trustProviders ?? [];
  }

  /**
   * Find agents matching a query, ranked by trust score.
   */
  async findAgent(
    query: AgentDiscoveryQuery & { minTrustScore?: number }
  ): Promise<RankedAgent[]> {
    const ranked: RankedAgent[] = [];

    // 1. Discover local matches
    const localMatches = discoverAgents(
      this.localManifests,
      query,
      this.reputation
    );
    for (const manifest of localMatches) {
      const trustScore = this.trustProviders.length > 0
        ? await calculateTrustScore(manifest.id, this.trustProviders)
        : { score: 500, breakdown: [], agentId: manifest.id, evaluatedAt: new Date().toISOString() };
      ranked.push({ manifest, trustScore, local: true });
    }

    // 2. Discover federated matches
    if (this.peerRegistry) {
      const peerManifests = await this.peerRegistry.discoverAll(
        [],
        query.capability
      );
      for (const manifest of peerManifests) {
        // Skip if already found locally
        if (ranked.some((r) => r.manifest.id === manifest.id)) continue;

        const peerUrl = (manifest as AgentManifest & { _peerUrl?: string })._peerUrl;
        if (!peerUrl) continue;

        const trustScore = this.trustProviders.length > 0
          ? await calculateTrustScore(manifest.id, this.trustProviders)
          : { score: 250, breakdown: [], agentId: manifest.id, evaluatedAt: new Date().toISOString() };
        ranked.push({ manifest, trustScore, peerUrl, local: false });
      }
    }

    // 3. Filter by minimum trust score
    const minScore = query.minTrustScore ?? 0;
    const filtered = ranked.filter((r) => r.trustScore.score >= minScore);

    // 4. Sort by trust score descending
    filtered.sort((a, b) => b.trustScore.score - a.trustScore.score);

    return filtered;
  }

  /**
   * Route a task to the best agent matching a capability.
   * Calls the agent's endpoint (local) or routes to peer (remote).
   */
  async routeByCapability(
    capability: string,
    task: string,
    options?: {
      minTrustScore?: number;
      forwardHeaders?: Record<string, string>;
      timeoutMs?: number;
    }
  ): Promise<RouteResult> {
    const agents = await this.findAgent({
      capability,
      minTrustScore: options?.minTrustScore,
    });

    if (agents.length === 0) {
      return {
        agent: undefined as unknown as RankedAgent,
        error: `No agent found with capability "${capability}"`,
      };
    }

    const best = agents[0];

    // Local agent — call endpoint directly if available
    if (best.local && best.manifest.endpoint?.url) {
      try {
        const resp = await fetch(best.manifest.endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(options?.forwardHeaders ?? {}),
          },
          body: JSON.stringify({ task }),
          signal: options?.timeoutMs
            ? AbortSignal.timeout(options.timeoutMs)
            : undefined,
        });
        const response = await resp.json();
        return { agent: best, response };
      } catch (err) {
        return { agent: best, error: `Local call failed: ${String(err)}` };
      }
    }

    // Remote agent — route to peer
    if (!best.local && best.peerUrl) {
      const result: FederatedRouteResult = await routeToPeer({
        peerUrl: best.peerUrl,
        agentId: best.manifest.id,
        task,
        forwardHeaders: options?.forwardHeaders,
        timeoutMs: options?.timeoutMs,
      });

      if (result.error) {
        return { agent: best, error: result.error };
      }
      return { agent: best, response: result.response };
    }

    return {
      agent: best,
      error: "Agent found but has no callable endpoint",
    };
  }
}
