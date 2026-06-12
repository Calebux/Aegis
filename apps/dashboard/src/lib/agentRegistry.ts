import {
  createAgentManifest,
  discoverAgents,
  type AgentDefinition,
  type AgentDiscoveryQuery,
  type AgentManifest,
} from "@calebux/agent-kit";
import { lastReputation, lastWallets } from "@/lib/taskStore";
import {
  AEGIS_AGENT_PRICE_USDC,
  STELLAR_NETWORK_ID,
  STELLAR_USDC_ISSUER,
  paymentReceiver,
} from "@/lib/stellarX402";
import {
  AEGIS_CELO_AGENT_PRICE,
  CELO_CHAIN,
  CELO_NETWORK_ID,
  CELO_STABLE_ASSET,
  CELO_STABLE_ASSET_CONTRACT,
  celoPaymentReceiver,
} from "@/lib/celoX402";

function stellarManifestAgent(
  id: string,
  name: string,
  description: string,
  capabilities: string[],
  price: string
): AgentDefinition {
  return {
    id,
    spendCapXlm: 1,
    manifest: {
      name,
      description,
      chain: "stellar",
      capabilities,
      endpoint: {
        url: `/api/agents/${id}/run`,
        protocol: "http",
      },
      payments: [
        {
          protocol: "x402",
          chain: "stellar",
          network: STELLAR_NETWORK_ID,
          asset: "USDC",
          price: `${price} USDC`,
          payTo: paymentReceiver(),
        },
      ],
      policies: {
        allowedAssets: ["USDC"],
        minCounterpartyReputation: 5000,
      },
      metadata: {
        paymentScheme: "x402.exact",
        chain: "stellar",
        settlementNetwork: STELLAR_NETWORK_ID,
        settlementAsset: "USDC",
        settlementIssuer: STELLAR_USDC_ISSUER,
        receiptVersion: "aegis.receipt.v1",
      },
    },
    run: async () => ({ result: "" }),
  };
}

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
  stellarManifestAgent(
    "scout",
    "Scout",
    "Web research agent for paid search and source discovery.",
    ["research", "web-search", "source-discovery"],
    AEGIS_AGENT_PRICE_USDC
  ),
  stellarManifestAgent(
    "ledger",
    "Ledger",
    "Stellar network and account intelligence agent.",
    ["stellar", "onchain-data", "horizon"],
    AEGIS_AGENT_PRICE_USDC
  ),
  stellarManifestAgent(
    "signal",
    "Signal",
    "Market intelligence and cross-source analysis agent.",
    ["market-intelligence", "analytics", "risk"],
    AEGIS_AGENT_PRICE_USDC
  ),
  stellarManifestAgent(
    "scribe",
    "Scribe",
    "Report synthesis agent that turns consensus outputs into final reports.",
    ["synthesis", "reporting", "summarization"],
    AEGIS_AGENT_PRICE_USDC
  ),
  stellarManifestAgent(
    "executor",
    "Notary",
    "Verifiable action and consensus proof agent.",
    ["attestation", "execution", "proof"],
    AEGIS_AGENT_PRICE_USDC
  ),
  celoManifestAgent(
    "celo-ledger",
    "Celo Ledger",
    "Celo network and stablecoin intelligence agent.",
    ["celo", "onchain-data", "stablecoins", "rpc"],
    AEGIS_CELO_AGENT_PRICE
  ),
  celoManifestAgent(
    "celo-notary",
    "Celo Notary",
    "Verifiable Celo action and manifest attestation agent.",
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
    const isCeloAgent = agent.manifest?.chain === CELO_CHAIN;

    return createAgentManifest(agent, {
      walletAddress: lastWallets.get(agent.id),
      registryContractId: isCeloAgent
        ? process.env.CELO_REGISTRY_ADDRESS
        : process.env.REGISTRY_CONTRACT_ID,
      shieldContractId: isCeloAgent
        ? process.env.CELO_POLICY_ADDRESS
        : process.env.SHIELD_CONTRACT_ID,
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
