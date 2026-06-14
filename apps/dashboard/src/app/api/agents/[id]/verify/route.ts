import { NextRequest } from "next/server";
import { buildAgentManifests } from "@/lib/agentRegistry";
import { isSelfVerified, SELF_AGENT_REGISTRY } from "@calebux/agent-kit";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/:id/verify
 *
 * Returns verification status for a given agent:
 * - Self Protocol verification (sybil-resistant identity)
 * - ERC-8004 registration status + NFT ID
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const agent = buildAgentManifests().find((a) => a.id === id);

  if (!agent) {
    return Response.json({ error: `Agent not found: ${id}` }, { status: 404 });
  }

  const walletAddress = agent.walletAddress ?? "";
  const adapterAddress = process.env.ERC8004_ADAPTER_ADDRESS ?? null;
  const rpcUrl = process.env.CELO_RPC_URL;

  // Self Protocol check
  let selfVerified = false;
  if (walletAddress) {
    try {
      selfVerified = await isSelfVerified(walletAddress, rpcUrl);
    } catch {
      // non-fatal
    }
  }

  // ERC-8004 registration check via adapter
  let erc8004Registered = false;
  let erc8004Id: string | null = null;
  if (adapterAddress && rpcUrl) {
    try {
      const { Erc8004Adapter } = await import("@calebux/agent-kit");
      // Read-only — use a dummy private key (we only call view functions)
      const dummyKey = "0x0000000000000000000000000000000000000000000000000000000000000001";
      const adapter = new Erc8004Adapter(
        adapterAddress,
        dummyKey,
        rpcUrl,
        process.env.CALAGENT_CELO_NETWORK,
      );
      erc8004Registered = await adapter.isRegistered(id);
      if (erc8004Registered) {
        const nftId = await adapter.getErc8004AgentId(id);
        erc8004Id = nftId.toString();
      }
    } catch {
      // non-fatal — adapter may not be deployed
    }
  }

  return Response.json({
    agentId: id,
    wallet: walletAddress || null,
    self: {
      verified: selfVerified,
      registry: SELF_AGENT_REGISTRY,
    },
    erc8004: {
      registered: erc8004Registered,
      nftId: erc8004Id,
      adapter: adapterAddress,
      identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    },
  });
}
