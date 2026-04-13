/**
 * Aegis Master Orchestrator — built on @aegis/agent-kit
 *
 * Pipeline:
 *  1. Decompose task via Claude (claude-sonnet-4-6)
 *  2. Run Scout, Ledger, Signal in parallel — each with a funded wallet,
 *     Shield Contract spend cap, and Identity Registry reputation tracking
 *  3. Scribe synthesizes results, pays Scout agent-to-agent
 *
 * Env vars:
 *   ANTHROPIC_API_KEY      — required
 *   SHIELD_CONTRACT_ID     — optional (dev mode if absent)
 *   REGISTRY_CONTRACT_ID   — optional (dev mode if absent)
 *   ORCHESTRATOR_SECRET_KEY — required for on-chain registration
 *   STELLAR_NETWORK        — "testnet" (default)
 */

import * as dotenv from "dotenv";
import * as nodePath from "path";
dotenv.config({ path: nodePath.resolve(__dirname, "../../../.env") });
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import Anthropic from "@anthropic-ai/sdk";
import { defineAgent, createOrchestrator, agentToAgentPayment } from "@aegis/agent-kit";
import type { OrchestratorReport } from "@aegis/agent-kit";

import { ScoutAgent } from "./agents/scout.js";
import { LedgerAgent } from "./agents/ledger.js";
import { SignalAgent } from "./agents/signal.js";
import { ScribeAgent } from "./agents/scribe.js";
import { startHorizonX402Server } from "./services/horizon-x402-server.js";

// ── Re-export the report type for consumers ───────────────────────────────────
export type { OrchestratorReport as AegisReport };

// ── Config ────────────────────────────────────────────────────────────────────

const TASK =
  "Analyze the current state of crypto adoption in Nigeria and the best DeFi options available to African users right now";

// ── Agent definitions — wrap existing classes in defineAgent ─────────────────

const scoutAgent = defineAgent({
  id: "scout",
  spendCapXlm: 1,
  run: async (task, { wallet }) => {
    process.env.SCOUT_SECRET_KEY = wallet.secret();
    const agent = new ScoutAgent();
    const res = await agent.run(task);
    const txHashes =
      res.searchResult?.txHash && res.searchResult.txHash !== "testnet-skipped"
        ? [res.searchResult.txHash]
        : [];
    return { result: res.result, spentStroops: res.spentStroops, txHashes };
  },
});

const ledgerAgent = defineAgent({
  id: "ledger",
  spendCapXlm: 1,
  run: async (task, { wallet }) => {
    process.env.LEDGER_SECRET_KEY = wallet.secret();
    const agent = new LedgerAgent();
    const res = await agent.run(task);
    return {
      result: res.result,
      spentStroops: res.spentStroops,
      txHashes: res.txHashes,
      paymentMode: res.paymentMode,
    };
  },
});

const signalAgent = defineAgent({
  id: "signal",
  spendCapXlm: 1,
  run: async (task, { wallet }) => {
    process.env.SIGNAL_SECRET_KEY = wallet.secret();
    const agent = new SignalAgent();
    const res = await agent.run(task);
    return {
      result: res.result,
      spentStroops: res.spentStroops,
      txHashes: res.txHashes,
      paymentMode: res.paymentMode,
    };
  },
});

// ── Orchestrator ──────────────────────────────────────────────────────────────

// Track Scout wallet for agent-to-agent payment in synthesize
let scoutPublicKey = "";

const orchestrator = createOrchestrator(
  [scoutAgent, ledgerAgent, signalAgent],
  {
    shieldContractId: process.env.SHIELD_CONTRACT_ID,
    registryContractId: process.env.REGISTRY_CONTRACT_ID,

    // Called after wallets are provisioned — capture Scout's address for Scribe
    onWalletsProvisioned: (wallets) => {
      scoutPublicKey = wallets["scout"] ?? "";
      // Cross-agent awareness: Ledger will inspect Scout's on-chain account
      process.env.SCOUT_WALLET_ADDRESS = scoutPublicKey;
    },

    // Decompose via Claude
    decompose: async (task, agentIds) => {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: `You are the task decomposition engine for Aegis, a multi-agent research system.

Decompose the following task into exactly 3 sub-tasks, one per specialist agent:
- scout:  a concrete web search query to gather recent news / articles
- ledger: a specific Stellar on-chain data request (e.g. DEX volumes, active accounts, asset stats)
- signal: a specific market data / DeFi metrics request (e.g. TVL, token prices, adoption stats)

Return ONLY valid JSON with this exact shape and no other text:
{
  "scout": "...",
  "ledger": "...",
  "signal": "..."
}

Task: "${task}"`,
          },
        ],
      });

      const raw =
        response.content[0].type === "text" ? response.content[0].text.trim() : "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error(`Claude did not return valid JSON.\nRaw: ${raw}`);
      return JSON.parse(jsonMatch[0]) as Record<string, string>;
    },

    // Synthesize via Scribe + agent-to-agent payment
    synthesize: async (task, results) => {
      process.env.SCRIBE_SECRET_KEY = undefined; // Scribe gets its own wallet from orchestrator
      // Generate a fresh Scribe wallet for the synthesis + payment
      const { Keypair } = await import("@stellar/stellar-sdk");
      const { fundTestnetAccount } = await import("@aegis/shared");
      const scribeKeypair = Keypair.random();

      try {
        await fundTestnetAccount(scribeKeypair.publicKey());
      } catch {
        // non-fatal
      }

      process.env.SCRIBE_SECRET_KEY = scribeKeypair.secret();
      const scribe = new ScribeAgent();

      const report = await scribe.synthesise(
        task,
        results.map((r) => ({
          agentId: r.agentId,
          result: r.result,
          spentStroops: r.spentStroops,
        }))
      );

      // Agent-to-agent payment: Scribe pays Scout for research
      if (scoutPublicKey) {
        await agentToAgentPayment(
          scribeKeypair,
          scoutPublicKey,
          "0.0010000",
          "aegis:scribe->scout"
        ).catch(() => {});
      }

      return report;
    },
  }
);

// ── runTask — exported library entry point ────────────────────────────────────

let horizonServerStarted = false;

export async function runTask(
  prompt: string,
  emitter?: EventEmitter
): Promise<OrchestratorReport> {
  if (!horizonServerStarted) {
    try {
      await startHorizonX402Server();
      horizonServerStarted = true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        horizonServerStarted = true;
      } else {
        console.warn("[runTask] Could not start Horizon x402 server:", err);
      }
    }
  }

  return orchestrator.run(prompt, emitter);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — check your .env file");
  }

  await startHorizonX402Server();

  console.log("\n🔮 Aegis starting…");
  console.log(`   Task: "${TASK}"`);

  const report = await runTask(TASK);

  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  const sep = "━".repeat(60);
  console.log(`\n${sep}`);
  console.log("✅  AEGIS REPORT");
  console.log(sep);
  console.log(`\n📋  TASK\n${report.task}`);
  console.log(`\n✍️   FINAL REPORT\n${report.report}`);
  console.log(`\n📁  Report written to: ${reportPath}`);
  console.log(`⏱️   Timestamp: ${report.timestamp}\n`);
}

const argv1 = process.argv[1] ?? "";
if (argv1.endsWith("index.ts") || argv1.endsWith("index.js")) {
  void main().catch((err) => {
    console.error("[aegis] Fatal error:", err);
    process.exit(1);
  });
}
