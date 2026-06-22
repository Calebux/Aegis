/**
 * Celo Scribe Agent
 *
 * Mirrors scribe.ts but uses celoAgentToAgentPayment (cUSD) instead of
 * Stellar XLM for the Scribe→Scout settlement. Listens for consensus:reached
 * from ConsensusManager, synthesises with Claude, then re-publishes as Scribe.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Account, Address } from "viem";
import { celoAgentToAgentPayment } from "@calagent/agent-kit";
import type { LLMProvider } from "@calagent/agent-kit";
import { bus } from "../lib/bus.js";

// ── CeloScribeAgent ───────────────────────────────────────────────────────────

export class CeloScribeAgent {
  private account: Account | null = null;
  private scoutAddress: Address | null = null;
  private readonly anthropic: Anthropic;
  private readonly llm?: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.llm = llm;
  }

  private async synthesise(
    agreedOutput: string
  ): Promise<string> {
    console.log("[celo-scribe] Synthesising report via Claude…");

    const userContent = `You are Scribe, the report-writing agent in the Cal-AgentKit multi-agent system running on Celo.
Given the following multi-agent consensus output, write a concise, well-structured report.
Include key findings, data points, and actionable insights relevant to the Celo/stablecoin ecosystem.

At the end, include a brief "## Settlement" section noting that all agent payments settled in cUSD on Celo.

## Consensus Output
${agreedOutput}

## Report`;

    try {
      let text: string;

      if (this.llm) {
        const result = await this.llm.chat(
          [{ role: "user", content: userContent }],
          { model: "claude-sonnet-4-6", maxTokens: 1800 }
        );
        text = result.text;
      } else {
        const response = await this.anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1800,
          messages: [{ role: "user", content: userContent }],
        });
        text = response.content[0].type === "text" ? response.content[0].text : agreedOutput;
      }

      console.log("[celo-scribe] ✅ Report synthesised");
      return text;
    } catch (err) {
      console.error("[celo-scribe] Synthesis failed:", err);
      return agreedOutput;
    }
  }

  wire(
    runId: string,
    account?: Account,
    scoutAddress?: Address,
    onComplete?: (report: string) => void
  ): void {
    if (account) this.account = account;
    if (scoutAddress) this.scoutAddress = scoutAddress;

    bus.subscribe(
      "consensus:reached",
      async (msg) => {
        if (msg.runId !== runId) return;
        // Don't respond to own messages
        if (msg.agentId === "scribe") return;

        const { agreedOutput } = msg.payload as { agreedOutput: string };
        console.log("[celo-scribe] Consensus received — synthesising final report…");

        const report = await this.synthesise(agreedOutput);

        // Agent-to-agent cUSD payment: Scribe pays Scout (fire-and-forget)
        if (this.account && this.scoutAddress) {
          await celoAgentToAgentPayment(
            this.account,
            this.scoutAddress,
            "0.001",
            process.env.CELO_RPC_URL
          ).catch(() => {});
        }

        onComplete?.(report);

        bus.publish({
          topic: "consensus:reached",
          agentId: "scribe",
          runId,
          payload: {
            agreedOutput: report,
            participatingAgents: ["scribe"],
            voteTally: { scribe: 1.0 },
          },
          confidence: 1.0,
          timestamp: Date.now(),
        });
      },
      runId
    );
  }
}
