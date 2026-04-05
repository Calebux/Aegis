/**
 * GET /api/status
 *
 * Returns live wallet balances, spend, and reputation for all agents.
 *
 * When a pipeline run has completed, queries Stellar Horizon for real XLM
 * balances using the wallet addresses persisted in the run store.
 * Returns an empty array before the first run.
 */

import { NextResponse } from "next/server";
import { getHorizonServer } from "@aegis/shared";
import { getLastRun, type AgentId } from "@/lib/runStore";

export const dynamic = "force-dynamic";

const AGENTS: AgentId[] = ["scout", "ledger", "signal", "scribe"];

export async function GET() {
  const run = getLastRun();

  if (!run) {
    // No run has completed yet — return empty so the dashboard shows idle state
    return NextResponse.json([]);
  }

  const horizon = getHorizonServer();

  const balances = await Promise.all(
    AGENTS.map(async (agentId) => {
      const agent = run.agents[agentId];

      let xlmBalance = "0.0000000";
      try {
        const account = await horizon.loadAccount(agent.publicKey);
        const native = account.balances.find((b) => b.asset_type === "native");
        xlmBalance = native?.balance ?? "0.0000000";
      } catch {
        // Account may not yet exist on Horizon (funding lag) — return 0
      }

      return {
        agentId,
        publicKey: agent.publicKey,
        xlmBalance,
        spentStroops: agent.spentStroops.toString(),
        capStroops:   "10000000", // 1 XLM default cap
        reputationBps: agent.reputationBps,
      };
    })
  );

  return NextResponse.json(balances);
}
