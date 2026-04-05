/**
 * Aegis Master Orchestrator — entry point
 *
 * Usage:
 *   npm run dev --workspace=packages/orchestrator
 *
 * Reads ORCHESTRATOR_SECRET_KEY from the environment, then accepts a task
 * prompt (for now hard-coded as a demo), decomposes it, dispatches to
 * sub-agents, and prints the final report.
 */

import "dotenv/config";
import { Orchestrator } from "./orchestrator.js";

async function main(): Promise<void> {
  const secretKey = process.env.ORCHESTRATOR_SECRET_KEY;
  if (!secretKey) {
    throw new Error("ORCHESTRATOR_SECRET_KEY is not set. Check your .env file.");
  }

  const orchestrator = new Orchestrator({ secretKey });
  await orchestrator.initialize();

  // Demo task — replace with dynamic input (CLI arg, API call, etc.)
  const demoPrompt =
    "Research the current state of Stellar DeFi adoption, summarise key on-chain metrics, and produce a concise investor briefing.";

  console.log("[orchestrator] Starting task:", demoPrompt);
  const report = await orchestrator.runTask(demoPrompt);
  console.log("\n=== Final Report ===\n", report);
}

main().catch((err) => {
  console.error("[orchestrator] Fatal error:", err);
  process.exit(1);
});
