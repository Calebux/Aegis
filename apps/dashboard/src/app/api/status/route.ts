/**
 * GET /api/status
 *
 * Returns live wallet balances, spend, and reputation for all agents.
 * XLM balances are fetched from Stellar Horizon testnet.
 * Reputation scores are fetched from the Soroban Identity Registry on-chain.
 * Falls back to in-memory / default values when contracts aren't configured.
 */

import { NextResponse } from "next/server";
import { lastWallets, lastSpent, lastReputation, lastTxHashes } from "@/lib/taskStore";
import { IdentityRegistry } from "@aegis/agent-kit";
import { SorobanRpc, Keypair } from "@stellar/stellar-sdk";

export const dynamic = "force-dynamic";

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

const CAP_STROOPS = BigInt(process.env.SPEND_CAP_STROOPS ?? String(10_000_000));
const AGENT_IDS = ["scout", "ledger", "signal", "scribe"] as const;
type AgentId = (typeof AGENT_IDS)[number];

interface HorizonAccount {
  balances: { asset_type: string; balance: string }[];
}

async function fetchXlmBalance(publicKey: string): Promise<string> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return "0";
    const data = (await res.json()) as HorizonAccount;
    const native = data.balances.find((b) => b.asset_type === "native");
    return native?.balance ?? "0";
  } catch {
    return "0";
  }
}

/** Fetch on-chain reputation scores for all agents from the Identity Registry. */
async function fetchOnChainReputation(): Promise<Record<string, number | null>> {
  const registryId = process.env.REGISTRY_CONTRACT_ID;
  const adminSecret = process.env.ORCHESTRATOR_SECRET_KEY;

  if (!registryId || !adminSecret) return {};

  try {
    const rpc = new SorobanRpc.Server(RPC_URL);
    const adminKeypair = Keypair.fromSecret(adminSecret);
    const registry = new IdentityRegistry(registryId, rpc, adminKeypair);

    const scores = await Promise.all(
      AGENT_IDS.map(async (id) => [id, await registry.getReputation(id)] as const)
    );
    return Object.fromEntries(scores);
  } catch {
    return {};
  }
}

interface SerializedWalletBalance {
  agentId: AgentId;
  publicKey: string;
  xlmBalance: string;
  spentStroops: string;
  capStroops: string;
  reputationBps: number;
  reputationOnChain: number | null;
  txHashes: string[];
}

export async function GET() {
  if (lastWallets.size === 0) {
    const empty: SerializedWalletBalance[] = AGENT_IDS.map((agentId) => ({
      agentId,
      publicKey: "",
      xlmBalance: "0",
      spentStroops: "0",
      capStroops: CAP_STROOPS.toString(),
      reputationBps: 5000,
      reputationOnChain: null,
      txHashes: [],
    }));
    return NextResponse.json(empty);
  }

  // Fetch Horizon balances + on-chain reputation in parallel
  const [onChainReputation, balances] = await Promise.all([
    fetchOnChainReputation(),
    Promise.all(
      AGENT_IDS.map(async (agentId) => {
        const publicKey = lastWallets.get(agentId) ?? "";
        const xlmBalance = publicKey ? await fetchXlmBalance(publicKey) : "0";
        return { agentId, publicKey, xlmBalance };
      })
    ),
  ]);

  const result: SerializedWalletBalance[] = balances.map(({ agentId, publicKey, xlmBalance }) => ({
    agentId,
    publicKey,
    xlmBalance,
    spentStroops: String(lastSpent.get(agentId) ?? 0),
    capStroops: CAP_STROOPS.toString(),
    reputationBps: lastReputation.get(agentId) ?? 5000,
    reputationOnChain: onChainReputation[agentId] ?? null,
    txHashes: lastTxHashes.get(agentId) ?? [],
  }));

  return NextResponse.json(result);
}
