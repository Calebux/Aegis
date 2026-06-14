import { NextRequest, NextResponse } from "next/server";
import type { AgentDiscoveryQuery } from "@calebux/agent-kit";
import { queryAgentManifests, buildFederatedManifests } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";

function parseQuery(req: NextRequest): AgentDiscoveryQuery {
  const params = req.nextUrl.searchParams;
  const minReputationRaw = params.get("minReputation");
  const minReputation =
    minReputationRaw === null ? undefined : Number(minReputationRaw);

  return {
    chain: params.get("chain") ?? "celo",
    capability: params.get("capability") ?? undefined,
    protocol: (params.get("protocol") as AgentDiscoveryQuery["protocol"]) ?? undefined,
    asset: params.get("asset") ?? undefined,
    network: params.get("network") ?? undefined,
    minReputation: Number.isFinite(minReputation) ? minReputation : undefined,
  };
}

export async function GET(req: NextRequest) {
  const federatedParam = req.nextUrl.searchParams.get("federated");

  // Auto-federation: when CALAGENT_PEERS is set, include federated by default
  // unless explicitly disabled with ?federated=false
  const peersConfigured = Boolean(process.env.CALAGENT_PEERS);
  const includeFederated =
    federatedParam === "true" ||
    (peersConfigured && federatedParam !== "false");

  let agents;
  if (includeFederated) {
    agents = await buildFederatedManifests();
  } else {
    agents = queryAgentManifests(parseQuery(req));
  }

  return NextResponse.json({
    count: agents.length,
    agents,
  });
}
