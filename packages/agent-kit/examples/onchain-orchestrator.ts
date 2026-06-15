/**
 * On-Chain Agent Orchestrator — governed multi-agent pipeline.
 *
 * Demonstrates createOrchestrator (Stellar) and createCeloOrchestrator (Celo)
 * with on-chain identity, reputation, spend caps, x402 payments, and
 * verifiable run receipts.
 *
 * Usage:
 *   # Stellar
 *   SHIELD_CONTRACT_ID=C... REGISTRY_CONTRACT_ID=C... npx tsx examples/onchain-orchestrator.ts
 *
 *   # Celo
 *   CELO_REGISTRY_ADDRESS=0x... CELO_POLICY_ADDRESS=0x... CELO_DEPLOYER_PRIVATE_KEY=0x... npx tsx examples/onchain-orchestrator.ts --celo
 */

import { EventEmitter } from "events";
import {
  defineAgent,
  createOrchestrator,
  createCeloOrchestrator,
  createMemoryProvider,
  createRunReceipt,
} from "@calebux/agent-kit";

// ── Define agents ────────────────────────────────────────────────────────────

const researcher = defineAgent({
  id: "researcher",
  spendCapXlm: 1,
  manifest: {
    name: "Researcher",
    capabilities: ["web-search", "data-collection"],
    payments: [
      { protocol: "x402", network: "stellar:testnet", asset: "XLM", price: "$0.001" },
    ],
  },
  run: async (task, ctx) => {
    // Recall past research
    const recalled = await ctx.memory?.recall("researcher", task);
    if (recalled) {
      return { result: `[from memory] ${recalled}` };
    }

    // In production, use ctx.pay() to call x402-gated APIs
    // const data = await ctx.pay('https://api.example.com/search?q=' + task)
    return {
      result: `Researched: ${task}. Found 3 relevant data points.`,
      spentStroops: 10_000n,
    };
  },
});

const analyst = defineAgent({
  id: "analyst",
  spendCapXlm: 0.5,
  manifest: {
    name: "Analyst",
    capabilities: ["data-analysis", "trend-detection"],
    payments: [
      { protocol: "x402", network: "stellar:testnet", asset: "XLM", price: "$0.001" },
    ],
  },
  run: async (task, ctx) => {
    return {
      result: `Analysis of "${task}": Positive trend detected with 85% confidence.`,
      spentStroops: 5_000n,
    };
  },
});

const writer = defineAgent({
  id: "writer",
  spendCapXlm: 0.5,
  manifest: {
    name: "Writer",
    capabilities: ["report-synthesis", "summarization"],
  },
  run: async (task, ctx) => {
    // Store the synthesis in memory for future runs
    const output = `Report: Based on analysis of "${task}", the market shows strong fundamentals.`;
    await ctx.memory?.store(`report/${Date.now()}`, output, {
      agent: "writer",
      task,
    });
    return { result: output };
  },
});

// ── Set up memory ────────────────────────────────────────────────────────────

const memory = createMemoryProvider({
  type: "file",
  filePath: "./.agent-memory/orchestrator.json",
});

// ── Choose chain ─────────────────────────────────────────────────────────────

const useCelo = process.argv.includes("--celo");

async function main() {
  const emitter = new EventEmitter();

  // Stream events to console
  emitter.on("log", ({ message, level }) => {
    const prefix = level === "error" ? "[ERROR]" : level === "success" ? "[OK]" : "[INFO]";
    console.log(`${prefix} ${message}`);
  });
  emitter.on("wallets", (wallets) => {
    console.log("\nProvisioned wallets:", wallets);
  });
  emitter.on("agent_status", ({ agent, status, spent }) => {
    console.log(`  ${agent}: ${status}${spent ? ` (${spent} stroops)` : ""}`);
  });
  emitter.on("complete", ({ report }) => {
    console.log("\n=== FINAL REPORT ===\n");
    console.log(report);
  });

  // ── Create orchestrator ──────────────────────────────────────────────

  let orchestrator;

  if (useCelo) {
    console.log("Using Celo orchestrator\n");
    orchestrator = createCeloOrchestrator([researcher, analyst, writer], {
      registryAddress: process.env.CELO_REGISTRY_ADDRESS,
      policyAddress: process.env.CELO_POLICY_ADDRESS,
      adminPrivateKey: process.env.CELO_DEPLOYER_PRIVATE_KEY,
      memory,
      synthesize: async (task, results) => {
        return results.map((r) => `**${r.agentId}**: ${r.result}`).join("\n\n");
      },
    });
  } else {
    console.log("Using Stellar orchestrator\n");
    orchestrator = createOrchestrator([researcher, analyst, writer], {
      shieldContractId: process.env.SHIELD_CONTRACT_ID,
      registryContractId: process.env.REGISTRY_CONTRACT_ID,
      memory,
      synthesize: async (task, results) => {
        return results.map((r) => `**${r.agentId}**: ${r.result}`).join("\n\n");
      },
    });
  }

  // ── Run the pipeline ─────────────────────────────────────────────────

  const report = await orchestrator.run(
    "Analyze the current state of DeFi on Celo",
    emitter
  );

  console.log("\n=== REPORT METADATA ===");
  console.log(`Task: ${report.task}`);
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Agents: ${Object.keys(report.wallets).join(", ")}`);
  console.log(
    `Total spend: ${Object.values(report.spent).reduce((a, b) => a + b, 0)} stroops`
  );
  console.log(`Reputation:`, report.reputation);

  // ── Generate a verifiable receipt ────────────────────────────────────

  const receipt = createRunReceipt({
    report,
    runId: `demo-${Date.now()}`,
    shieldContractId: process.env.SHIELD_CONTRACT_ID,
    registryContractId: process.env.REGISTRY_CONTRACT_ID,
  });

  console.log("\n=== VERIFIABLE RECEIPT ===");
  console.log(`Version: ${receipt.version}`);
  console.log(`Run ID: ${receipt.runId}`);
  console.log(`Task Hash: ${receipt.taskHash}`);
  console.log(`Output Hash: ${receipt.outputHash}`);
  console.log(`Receipt Hash: ${receipt.receiptHash}`);
}

main().catch(console.error);
