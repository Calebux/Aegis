/**
 * Aegis Master Orchestrator — CLI entry-point
 *
 * Loads env, starts the Horizon x402 server, then runs the full pipeline.
 * Import `runAegis` from `./pipeline` instead of this file to avoid the
 * auto-run side-effect.
 */

import * as dotenv from "dotenv";
import * as nodePath from "path";
// Load .env from repo root: src/ -> orchestrator/ -> packages/ -> Aegis/
dotenv.config({ path: nodePath.resolve(__dirname, "../../../.env") });
dotenv.config(); // fallback: also try cwd/.env

import { runAegis } from "./pipeline.js";
import { startHorizonX402Server } from "./services/horizon-x402-server.js";

export { runAegis } from "./pipeline.js";
export type { AegisReport, OnEvent } from "./pipeline.js";

const TASK =
  "Analyze the current state of crypto adoption in Nigeria and the best DeFi options available to African users right now";

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check your .env file");
  }

  // Start Horizon x402 server on port 3001
  await startHorizonX402Server();

  console.log("\n🔮 Aegis starting…");
  console.log(`   Task: "${TASK}"`);

  const report = await runAegis(TASK, undefined, /* writeOutput */ true);

  // ── Print formatted terminal output ────────────────────────────────────────
  const sep = "━".repeat(60);

  console.log(`\n${sep}`);
  console.log("✅  AEGIS REPORT");
  console.log(sep);
  console.log(`\n📋  TASK\n${report.task}`);
  console.log(`\n📌  SUB-TASKS`);
  console.log(`   scout  → ${report.subtasks.scout}`);
  console.log(`   ledger → ${report.subtasks.ledger}`);
  console.log(`   signal → ${report.subtasks.signal}`);
  console.log(`\n🔍  SCOUT RESULT\n${report.results.scout}`);
  console.log(`\n📊  LEDGER RESULT\n${report.results.ledger}`);
  console.log(`\n📈  SIGNAL RESULT\n${report.results.signal}`);
  console.log(`\n✍️   FINAL REPORT\n${report.report}`);

  // ── Spend summary ──────────────────────────────────────────────────────────
  console.log(`\n${sep}`);
  console.log("💸  SPEND SUMMARY");
  console.log(sep);

  let totalStroops = 0;
  for (const w of report.wallets) {
    const xlm = (w.spent / 10_000_000).toFixed(7);
    console.log(
      `   ${w.agent.padEnd(8)} ${w.address}  ${w.spent} stroops (${xlm} XLM)`
    );
    totalStroops += w.spent;
  }

  const totalXlm = (totalStroops / 10_000_000).toFixed(7);
  console.log(`\n   Total XLM spent: ${totalXlm} XLM (${totalStroops} stroops)`);
  console.log(`\n⏱️   Timestamp: ${report.timestamp}\n`);
}

// Only run when executed directly (not when imported as a module)
if (require.main === module) {
  main().catch((err) => {
    console.error("[aegis] Fatal error:", err);
    process.exit(1);
  });
}
