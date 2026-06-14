/**
 * GET /api/status
 *
 * Returns wallet balances, spend, and reputation for all Celo agents.
 * Falls back to in-memory / default values when contracts aren't configured.
 */

import { NextResponse } from "next/server";
import { lastWallets, lastSpent, lastReputation, lastTxHashes } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

const AGENT_IDS = ["celo-scout", "celo-ledger", "celo-signal", "celo-scribe", "celo-executor"] as const;
type AgentId = (typeof AGENT_IDS)[number];

interface SerializedWalletBalance {
  agentId: AgentId;
  publicKey: string;
  balance: string;
  spentWei: string;
  capWei: string;
  reputationBps: number;
  reputationOnChain: number | null;
  txHashes: string[];
}

const DEFAULT_CAP_WEI = "10000000000000000000"; // 10 cUSD

export async function GET() {
  const result: SerializedWalletBalance[] = AGENT_IDS.map((agentId) => ({
    agentId,
    publicKey: lastWallets.get(agentId) ?? "",
    balance: "0",
    spentWei: String(lastSpent.get(agentId) ?? 0),
    capWei: DEFAULT_CAP_WEI,
    reputationBps: lastReputation.get(agentId) ?? 5000,
    reputationOnChain: null,
    txHashes: lastTxHashes.get(agentId) ?? [],
  }));

  return NextResponse.json(result);
}
