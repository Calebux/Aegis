import { NextRequest } from "next/server";
import { buildAgentManifests } from "@/lib/agentRegistry";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/:id/uri
 *
 * Serves ERC-8004-compatible agent metadata JSON.
 * This URL is passed to `identityRegistry.register(agentURI)`.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = buildAgentManifests().find((a) => a.id === id);

  if (!agent) {
    return Response.json({ error: `Agent not found: ${id}` }, { status: 404 });
  }

  const origin = req.nextUrl.origin;

  const agentURI = {
    "@context": "https://erc8004.org/context/v1",
    type: "AgentIdentity",
    id: agent.id,
    name: agent.name,
    description: agent.description,
    chain: agent.chain,
    capabilities: agent.capabilities,
    endpoint: {
      url: `${origin}/api/agents/${encodeURIComponent(id)}/run`,
      protocol: "http",
    },
    wallet: agent.walletAddress ?? null,
    manifestHash: agent.manifestHash ?? null,
    payments: agent.payments,
    policies: agent.policies,
    contracts: {
      registry: process.env.CELO_REGISTRY_ADDRESS ?? null,
      policy: process.env.CELO_POLICY_ADDRESS ?? null,
      erc8004Adapter: process.env.ERC8004_ADAPTER_ADDRESS ?? null,
    },
    metadata: {
      receiptVersion: "calagent.receipt.v1",
      uriEndpoint: `${origin}/api/agents/${encodeURIComponent(id)}/uri`,
      verifyEndpoint: `${origin}/api/agents/${encodeURIComponent(id)}/verify`,
    },
  };

  return Response.json(agentURI, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
