import { NextResponse } from "next/server";
import { buildAgentManifests } from "@/lib/agentRegistry";
import { receipts, storageInfo, tasks } from "@/lib/taskStore";
import {
  facilitatorUrl,
  paymentReceiver,
  STELLAR_NETWORK_ID,
  STELLAR_USDC_CONTRACT_ID,
} from "@/lib/stellarX402";
import {
  CELO_NETWORK_ID,
  CELO_RPC_URL,
  CELO_STABLE_ASSET,
  CELO_STABLE_ASSET_CONTRACT,
  celoFacilitatorUrl,
  celoX402Enforced,
} from "@/lib/celoX402";

export const dynamic = "force-dynamic";

export async function GET() {
  const agents = buildAgentManifests();

  return NextResponse.json({
    ok: true,
    service: "aegis-dashboard",
    version: process.env.npm_package_version ?? "0.1.0",
    agents: agents.length,
    receipts: new Set(Array.from(receipts.keys())).size,
    tasks: tasks.size,
    storage: storageInfo(),
    x402: {
      network: STELLAR_NETWORK_ID,
      asset: "USDC",
      assetContract: STELLAR_USDC_CONTRACT_ID,
      receiverConfigured: Boolean(paymentReceiver()),
      facilitatorConfigured: Boolean(facilitatorUrl()),
      enforce: process.env.AEGIS_X402_ENFORCE === "true",
    },
    contracts: {
      registryContractId: process.env.REGISTRY_CONTRACT_ID,
      shieldContractId: process.env.SHIELD_CONTRACT_ID,
      celoRegistryAddress: process.env.CELO_REGISTRY_ADDRESS,
      celoPolicyAddress: process.env.CELO_POLICY_ADDRESS,
    },
    celo: {
      network: CELO_NETWORK_ID,
      rpcUrl: CELO_RPC_URL,
      asset: CELO_STABLE_ASSET,
      assetContract: CELO_STABLE_ASSET_CONTRACT,
      receiverConfigured: Boolean(process.env.AEGIS_CELO_X402_RECEIVER),
      facilitatorConfigured: Boolean(celoFacilitatorUrl()),
      enforce: celoX402Enforced(),
    },
    timestamp: new Date().toISOString(),
  });
}
