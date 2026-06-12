import {
  createAgentManifest,
  discoverAgents,
  type AgentDefinition,
  type AgentDiscoveryQuery,
  type AgentManifest,
} from "@calebux/agent-kit";
import { lastReputation, lastWallets } from "@/lib/taskStore";
import {
  AEGIS_CELO_AGENT_PRICE,
  CELO_CHAIN,
  CELO_NETWORK_ID,
  CELO_STABLE_ASSET,
  CELO_STABLE_ASSET_CONTRACT,
  celoPaymentReceiver,
} from "@/lib/celoX402";

function celoManifestAgent(
  id: string,
  name: string,
  description: string,
  capabilities: string[],
  price: string
): AgentDefinition {
  return {
    id,
    manifest: {
      name,
      description,
      chain: CELO_CHAIN,
      capabilities,
      endpoint: {
        url: `/api/agents/${id}/run`,
        protocol: "http",
      },
      payments: [
        {
          protocol: "x402",
          chain: CELO_CHAIN,
          network: CELO_NETWORK_ID,
          asset: CELO_STABLE_ASSET,
          price: `${price} ${CELO_STABLE_ASSET}`,
          payTo: celoPaymentReceiver(),
        },
      ],
      policies: {
        allowedAssets: [CELO_STABLE_ASSET],
        minCounterpartyReputation: 5000,
      },
      metadata: {
        paymentScheme: "x402.exact",
        chain: CELO_CHAIN,
        settlementNetwork: CELO_NETWORK_ID,
        settlementAsset: CELO_STABLE_ASSET,
        settlementAssetContract: CELO_STABLE_ASSET_CONTRACT,
        receiptVersion: "aegis.receipt.v1",
      },
    },
    run: async () => ({ result: "" }),
  };
}

const AGENT_DEFINITIONS: AgentDefinition[] = [
  celoManifestAgent(
    "celo-scout",
    "Celo Scout",
    "Web research agent for paid search and source discovery on Celo.",
    ["research", "web-search", "source-discovery", "celo"],
    AEGIS_CELO_AGENT_PRICE
  ),
  celoManifestAgent(
    "celo-ledger",
    "Celo Ledger",
    "Celo network and stablecoin intelligence agent.",
    ["celo", "onchain-data", "stablecoins", "rpc"],
    AEGIS_CELO_AGENT_PRICE
  ),
  celoManifestAgent(
    "celo-signal",
    "Celo Signal",
    "Market intelligence and cross-source analysis agent for Celo.",
    ["celo", "market-intelligence", "analytics", "risk"],
    AEGIS_CELO_AGENT_PRICE
  ),
  celoManifestAgent(
    "celo-scribe",
    "Celo Scribe",
    "Report synthesis agent that turns consensus outputs into final Celo reports.",
    ["celo", "synthesis", "reporting", "summarization"],
    AEGIS_CELO_AGENT_PRICE
  ),
  celoManifestAgent(
    "celo-executor",
    "Celo Notary",
    "Verifiable Celo action and consensus proof agent.",
    ["celo", "attestation", "execution", "proof"],
    AEGIS_CELO_AGENT_PRICE
  ),
  celoManifestAgent(
    "celo-defi",
    "Celo DeFi",
    "Mento SortedOracles: live cUSD/cEUR/cREAL exchange rates and reserve ratio.",
    ["celo", "defi", "stablecoins", "mento", "oracles"],
    AEGIS_CELO_AGENT_PRICE
  ),
  celoManifestAgent(
    "celo-price",
    "Celo Price",
    "CELO token price via CoinGecko wrapped in an Aegis verifiable receipt.",
    ["celo", "price", "market-data"],
    AEGIS_CELO_AGENT_PRICE
  ),
];

export function buildAgentManifests(): AgentManifest[] {
  return AGENT_DEFINITIONS.map((agent) => {
    return createAgentManifest(agent, {
      walletAddress: lastWallets.get(agent.id),
      registryContractId: process.env.CELO_REGISTRY_ADDRESS,
      shieldContractId: process.env.CELO_POLICY_ADDRESS,
    });
  });
}

export function queryAgentManifests(query: AgentDiscoveryQuery = {}): AgentManifest[] {
  return discoverAgents(
    buildAgentManifests(),
    query,
    Object.fromEntries(lastReputation.entries())
  );
}
