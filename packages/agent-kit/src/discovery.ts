import type {
  AgentDefinition,
  AgentDiscoveryQuery,
  AgentManifest,
  AgentPaymentCapability,
} from "./types.js";
import { sha256Hex } from "./receipts.js";

const DEFAULT_NETWORK = "stellar:testnet";

function defaultPaymentCapabilities(): AgentPaymentCapability[] {
  return [
    {
      protocol: "x402",
      network: DEFAULT_NETWORK,
      asset: "XLM",
    },
  ];
}

/**
 * Create a portable manifest for an agent.
 *
 * Manifests are the off-chain shape that can be published through an API,
 * indexed by a registry service, or mirrored into a Soroban identity registry.
 */
export function createAgentManifest(
  agent: AgentDefinition,
  overrides: Partial<AgentManifest> = {}
): AgentManifest {
  const base = agent.manifest ?? {};

  const manifest: AgentManifest = {
    id: overrides.id ?? agent.id,
    name: overrides.name ?? base.name ?? `${agent.id} agent`,
    description: overrides.description ?? base.description,
    version: overrides.version ?? base.version ?? "0.1.0",
    chain: overrides.chain ?? base.chain,
    capabilities:
      overrides.capabilities ??
      base.capabilities ??
      [agent.id],
    endpoint: overrides.endpoint ?? base.endpoint,
    payments:
      overrides.payments ??
      base.payments ??
      defaultPaymentCapabilities(),
    policies: overrides.policies ?? base.policies,
    walletAddress: overrides.walletAddress ?? base.walletAddress,
    registryContractId:
      overrides.registryContractId ??
      base.registryContractId ??
      process.env.REGISTRY_CONTRACT_ID,
    shieldContractId:
      overrides.shieldContractId ??
      base.shieldContractId ??
      process.env.SHIELD_CONTRACT_ID,
    attestation: overrides.attestation ?? base.attestation,
    manifestHash: overrides.manifestHash ?? base.manifestHash,
    metadata: overrides.metadata ?? base.metadata,
  };

  return {
    ...manifest,
    manifestHash: manifest.manifestHash ?? computeAgentManifestHash(manifest),
  };
}

export function computeAgentManifestHash(manifest: AgentManifest): string {
  const { manifestHash: _manifestHash, metadata, ...rest } = manifest;
  const { manifestHash: _metadataHash, ...metadataWithoutHash } = metadata ?? {};
  return sha256Hex({
    ...rest,
    metadata:
      Object.keys(metadataWithoutHash).length > 0 ? metadataWithoutHash : undefined,
  });
}

/**
 * Create manifests for every agent in an orchestrator.
 */
export function createAgentManifests(
  agents: AgentDefinition[],
  walletAddresses: Record<string, string> = {}
): AgentManifest[] {
  return agents.map((agent) =>
    createAgentManifest(agent, {
      walletAddress: walletAddresses[agent.id] ?? agent.manifest?.walletAddress,
    })
  );
}

/**
 * Filter local manifests by capability, payment protocol, asset, network, and
 * optional reputation. This is intentionally storage-agnostic so the same
 * query shape can back an in-memory list, HTTP endpoint, MCP tool, or Soroban
 * indexer.
 */
export function discoverAgents(
  manifests: AgentManifest[],
  query: AgentDiscoveryQuery = {},
  reputation: Record<string, number> = {}
): AgentManifest[] {
  return manifests.filter((manifest) => {
    if (query.capability && !manifest.capabilities.includes(query.capability)) {
      return false;
    }

    if (query.chain && manifest.chain !== query.chain) {
      return false;
    }

    if (query.minReputation !== undefined) {
      const score = reputation[manifest.id] ?? 0;
      if (score < query.minReputation) return false;
    }

    if (!query.protocol && !query.asset && !query.network) return true;

    return manifest.payments.some((payment) => {
      if (query.protocol && payment.protocol !== query.protocol) return false;
      if (query.chain && payment.chain && payment.chain !== query.chain) return false;
      if (query.asset && payment.asset !== query.asset) return false;
      if (query.network && payment.network !== query.network) return false;
      return true;
    });
  });
}
