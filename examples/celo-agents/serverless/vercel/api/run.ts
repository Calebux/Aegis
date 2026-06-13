/**
 * Vercel serverless function — runs a Celo agent on demand.
 *
 * POST /api/run?agent=gas-tracker
 * Body: { "task": "optional override" }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { gasTrackerAutomation } from "../../src/agents/gas-tracker.js";
import { usdmYieldMonitorAutomation } from "../../src/agents/cusd-yield-monitor.js";
import { whaleWatcherAutomation } from "../../src/agents/whale-watcher.js";
import { governanceVoterAutomation } from "../../src/agents/governance-voter.js";
import { balanceSentinelAutomation } from "../../src/agents/balance-sentinel.js";
import type { Automation } from "@calebux/agent-kit";

const agents: Record<string, Automation> = {
  "gas-tracker": gasTrackerAutomation,
  "usdm-yield-monitor": usdmYieldMonitorAutomation,
  "whale-watcher": whaleWatcherAutomation,
  "governance-voter": governanceVoterAutomation,
  "balance-sentinel": balanceSentinelAutomation,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const agentId = (req.query.agent as string) ?? "gas-tracker";
  const automation = agents[agentId];

  if (!automation) {
    res.status(404).json({
      error: `Unknown agent: ${agentId}`,
      available: Object.keys(agents),
    });
    return;
  }

  const result = await automation.runOnce(req.body?.task);
  res.status(result.success ? 200 : 500).json(result);
}
