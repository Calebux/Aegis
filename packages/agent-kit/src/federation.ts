/**
 * Cross-Instance Agent Federation
 *
 * Enables Cal-AgentKit instances to discover and route tasks to agents
 * running on peer instances. Peers are configured via CALAGENT_PEERS
 * env var (comma-separated URLs).
 *
 * Trust model: Before routing, the caller verifies the peer's manifest
 * hash against on-chain registry data and checks reputation thresholds.
 */

import type { AgentChain, AgentManifest } from "./types.js";
import { computeAgentManifestHash } from "./discovery.js";

// ── Peer Registry ─────────────────────────────────────────────────────────────

export interface PeerInstance {
  /** Base URL of the peer, e.g. "https://peer.example.com" */
  baseUrl: string;
  /** Primary chain of the peer */
  chain?: AgentChain;
  /** Timestamp of last successful contact */
  lastSeen: number;
  /** Cached manifests from GET /api/agents */
  manifests?: AgentManifest[];
  /** On-chain reputation score for this peer */
  trustScore: number;
}

/** Maximum number of proxy hops to prevent circular routing */
const MAX_HOP_COUNT = 2;
const HOP_COUNT_HEADER = "X-CalAgentKit-Hop-Count";

/** Minimum reputation before we route to a peer */
const MIN_PEER_REPUTATION = 5000;

/** Timeout for peer discovery requests */
const PEER_TIMEOUT_MS = 10_000;

export class PeerRegistry {
  private peers = new Map<string, PeerInstance>();

  /** Add or update a peer */
  addPeer(peer: PeerInstance): void {
    this.peers.set(peer.baseUrl, peer);
  }

  /** Remove a peer */
  removePeer(baseUrl: string): void {
    this.peers.delete(baseUrl);
  }

  /** Get all registered peers */
  getPeers(): PeerInstance[] {
    return Array.from(this.peers.values());
  }

  /** Get a specific peer by URL */
  getPeer(baseUrl: string): PeerInstance | undefined {
    return this.peers.get(baseUrl);
  }

  /**
   * Load peers from CALAGENT_PEERS env var.
   * Format: comma-separated URLs, e.g. "https://a.com,https://b.com"
   */
  loadFromEnv(): void {
    const peersEnv = process.env.CALAGENT_PEERS;
    if (!peersEnv) return;

    const urls = peersEnv
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    for (const url of urls) {
      if (!this.peers.has(url)) {
        this.addPeer({
          baseUrl: url,
          lastSeen: 0,
          trustScore: MIN_PEER_REPUTATION,
        });
      }
    }
  }

  /**
   * Refresh a peer's manifest cache by fetching GET /api/agents.
   * Returns true if the refresh succeeded.
   */
  async refreshPeer(baseUrl: string): Promise<boolean> {
    try {
      const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agents`, {
        signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });

      if (!resp.ok) return false;

      const data = (await resp.json()) as { agents?: AgentManifest[] } | AgentManifest[];
      const manifests = Array.isArray(data) ? data : data.agents ?? [];

      const peer = this.peers.get(baseUrl) ?? {
        baseUrl,
        lastSeen: 0,
        trustScore: MIN_PEER_REPUTATION,
      };

      peer.manifests = manifests;
      peer.lastSeen = Date.now();
      this.peers.set(baseUrl, peer);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discover all agents across local manifests and all peers.
   * Optionally filter by capability.
   */
  async discoverAll(
    localManifests: AgentManifest[],
    capability?: string
  ): Promise<Array<AgentManifest & { _peerUrl?: string }>> {
    // Refresh stale peers (> 5 min since last seen)
    const staleThreshold = Date.now() - 5 * 60_000;
    const refreshPromises = this.getPeers()
      .filter((p) => p.lastSeen < staleThreshold)
      .map((p) => this.refreshPeer(p.baseUrl));
    await Promise.allSettled(refreshPromises);

    const results: Array<AgentManifest & { _peerUrl?: string }> = [];

    // Add local manifests
    for (const m of localManifests) {
      if (!capability || m.capabilities.includes(capability)) {
        results.push(m);
      }
    }

    // Add peer manifests
    for (const peer of this.getPeers()) {
      if (!peer.manifests || peer.trustScore < MIN_PEER_REPUTATION) continue;
      for (const m of peer.manifests) {
        if (!capability || m.capabilities.includes(capability)) {
          results.push({ ...m, _peerUrl: peer.baseUrl });
        }
      }
    }

    return results;
  }
}

// ── Cross-Instance Router ─────────────────────────────────────────────────────

export interface FederatedRouteResult {
  /** Whether the request was proxied to a peer */
  proxied: boolean;
  /** The peer URL that handled the request, if proxied */
  peerUrl?: string;
  /** Response body from the peer */
  response?: unknown;
  /** Error message if routing failed */
  error?: string;
}

/**
 * Route a task to a peer instance when the agent is not available locally.
 * Forwards x402 payment headers and enforces hop count limits.
 */
export async function routeToPeer(params: {
  peerUrl: string;
  agentId: string;
  task: string;
  /** Current hop count from incoming request */
  currentHopCount?: number;
  /** Headers to forward (e.g. payment headers) */
  forwardHeaders?: Record<string, string>;
  /** Timeout in ms */
  timeoutMs?: number;
}): Promise<FederatedRouteResult> {
  const {
    peerUrl,
    agentId,
    task,
    currentHopCount = 0,
    forwardHeaders = {},
    timeoutMs = 30_000,
  } = params;

  // Prevent circular routing
  if (currentHopCount >= MAX_HOP_COUNT) {
    return {
      proxied: false,
      error: `Maximum hop count (${MAX_HOP_COUNT}) exceeded — possible circular routing`,
    };
  }

  try {
    const url = `${peerUrl.replace(/\/$/, "")}/api/agents/${encodeURIComponent(agentId)}/run`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [HOP_COUNT_HEADER]: String(currentHopCount + 1),
      ...forwardHeaders,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ task }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      return {
        proxied: true,
        peerUrl,
        error: `Peer returned ${resp.status}: ${await resp.text().catch(() => "unknown")}`,
      };
    }

    const response = await resp.json();
    return { proxied: true, peerUrl, response };
  } catch (err) {
    return {
      proxied: false,
      peerUrl,
      error: `Failed to route to peer: ${String(err)}`,
    };
  }
}

// ── Trust Verification ────────────────────────────────────────────────────────

export interface TrustVerification {
  trusted: boolean;
  manifestHashMatch: boolean;
  reputationSufficient: boolean;
  error?: string;
}

/**
 * Verify a peer's manifest against on-chain data before routing.
 *
 * 1. Compute manifest hash locally
 * 2. Compare with on-chain registry hash (if registry available)
 * 3. Check reputation meets threshold
 */
export async function verifyPeerTrust(params: {
  manifest: AgentManifest;
  /** Function to read on-chain manifest hash for an agent */
  getOnChainHash?: (agentId: string) => Promise<string | null>;
  /** Function to read on-chain reputation */
  getOnChainReputation?: (agentId: string) => Promise<number | null>;
  minReputation?: number;
}): Promise<TrustVerification> {
  const {
    manifest,
    getOnChainHash,
    getOnChainReputation,
    minReputation = MIN_PEER_REPUTATION,
  } = params;

  let manifestHashMatch = true;
  let reputationSufficient = true;

  // Check manifest hash against on-chain
  if (getOnChainHash) {
    try {
      const onChainHash = await getOnChainHash(manifest.id);
      if (onChainHash) {
        const localHash = computeAgentManifestHash(manifest);
        manifestHashMatch = localHash === onChainHash;
      }
    } catch (err) {
      return {
        trusted: false,
        manifestHashMatch: false,
        reputationSufficient: false,
        error: `Failed to verify on-chain hash: ${String(err)}`,
      };
    }
  }

  // Check reputation
  if (getOnChainReputation) {
    try {
      const reputation = await getOnChainReputation(manifest.id);
      if (reputation !== null) {
        reputationSufficient = reputation >= minReputation;
      }
    } catch {
      // Non-fatal — trust by default if we can't read reputation
    }
  }

  return {
    trusted: manifestHashMatch && reputationSufficient,
    manifestHashMatch,
    reputationSufficient,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the current hop count from a request's headers */
export function getHopCount(headers: Headers | Record<string, string>): number {
  const value =
    headers instanceof Headers
      ? headers.get(HOP_COUNT_HEADER)
      : headers[HOP_COUNT_HEADER];
  return value ? parseInt(value, 10) || 0 : 0;
}

export { MAX_HOP_COUNT, HOP_COUNT_HEADER, MIN_PEER_REPUTATION };
