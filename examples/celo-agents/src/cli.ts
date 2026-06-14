#!/usr/bin/env node
/**
 * CLI runner for Celo DeFi agents.
 *
 * Usage:
 *   npx tsx src/cli.ts <agent-name> [--cron]
 *
 * Examples:
 *   npx tsx src/cli.ts gas-tracker          # run once
 *   npx tsx src/cli.ts whale-watcher --cron # run on schedule
 *   npx tsx src/cli.ts --list               # list agents
 */
import { gasTrackerAutomation } from "./agents/gas-tracker.js";
import { usdmYieldMonitorAutomation } from "./agents/cusd-yield-monitor.js";
import { whaleWatcherAutomation } from "./agents/whale-watcher.js";
import { governanceVoterAutomation } from "./agents/governance-voter.js";
import { balanceSentinelAutomation } from "./agents/balance-sentinel.js";
import type { Automation } from "@calebux/agent-kit";

const agents: Record<string, Automation> = {
  "gas-tracker": gasTrackerAutomation,
  "usdm-yield-monitor": usdmYieldMonitorAutomation,
  "whale-watcher": whaleWatcherAutomation,
  "governance-voter": governanceVoterAutomation,
  "balance-sentinel": balanceSentinelAutomation,
};

function usage(): void {
  console.log(`
Celo DeFi Agent CLI

Usage:
  npx tsx src/cli.ts <agent-name> [--cron]
  npx tsx src/cli.ts --list

Agents:
  gas-tracker        Monitor gas prices, flag spikes
  usdm-yield-monitor Track USDm (Mento Dollar) supply changes
  whale-watcher      Detect large CELO transfers
  governance-voter   Watch governance proposals
  balance-sentinel   Multi-wallet balance alerts

Options:
  --cron   Start the agent on its configured schedule
  --list   List available agents
  `);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--list") || args.length === 0) {
    if (args.includes("--list")) {
      console.log("Available agents:");
      for (const id of Object.keys(agents)) {
        console.log(`  - ${id}`);
      }
    } else {
      usage();
    }
    return;
  }

  const agentName = args[0];
  const cronMode = args.includes("--cron");

  const automation = agents[agentName];
  if (!automation) {
    console.error(`Unknown agent: ${agentName}`);
    console.error(`Available: ${Object.keys(agents).join(", ")}`);
    process.exit(1);
  }

  if (cronMode) {
    console.log(`Starting ${agentName} on cron schedule...`);
    console.log("Press Ctrl+C to stop.\n");
    automation.start();

    // Also run once immediately
    const result = await automation.runOnce();
    console.log(`\nInitial run: ${result.success ? "OK" : "FAILED"}`);
    console.log(`Result: ${result.result}\n`);

    // Keep process alive
    process.on("SIGINT", () => {
      console.log("\nStopping...");
      automation.stop();
      process.exit(0);
    });
  } else {
    console.log(`Running ${agentName} once...\n`);
    const result = await automation.runOnce();
    console.log(`Status: ${result.success ? "OK" : "FAILED"}`);
    console.log(`Duration: ${result.durationMs}ms`);
    console.log(`Result:\n${JSON.stringify(JSON.parse(result.result), null, 2)}`);
    process.exit(result.success ? 0 : 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
