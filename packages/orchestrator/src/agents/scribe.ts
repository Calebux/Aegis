/**
 * Scribe Agent
 *
 * Synthesises sub-agent results into a coherent final report using
 * the Anthropic Claude API. This is the only agent that calls Claude
 * directly; spend is still tracked against its Shield Contract allowance.
 */

import Anthropic from "@anthropic-ai/sdk";
import { keypairFromSecret } from "@calagent/shared";
import { Keypair } from "@stellar/stellar-sdk";
import { bus } from "../lib/bus.js";
import type { LLMProvider } from "@calagent/agent-kit";
import { publishSigned } from "../lib/signer.js";

interface AgentContribution {
  agentId: string;
  result: string;
  spentStroops: bigint;
}

export class ScribeAgent {
  private readonly anthropic: Anthropic;
  private readonly keypair: ReturnType<typeof keypairFromSecret> | null;
  private readonly llm?: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.llm = llm;
    const secret = process.env.SCRIBE_SECRET_KEY;
    this.keypair = secret ? keypairFromSecret(secret) : null;
  }

  /**
   * Synthesise contributions from all sub-agents into a final report.
   */
  async synthesise(
    originalPrompt: string,
    contributions: AgentContribution[]
  ): Promise<string> {
    console.log("[scribe] Synthesising report via Claude…");

    const context = contributions
      .map((c) => `### ${c.agentId.toUpperCase()}\n${c.result}`)
      .join("\n\n");

    const totalXlm = contributions
      .reduce((sum, c) => sum + Number(c.spentStroops), 0) / 1e7;

    const spendSummary = contributions
      .map((c) => `- ${c.agentId}: ${(Number(c.spentStroops) / 1e7).toFixed(4)} XLM`)
      .join("\n");

    const userContent = `You are Scribe, the report-writing agent in the Cal-AgentKit multi-agent system.
Given the following research contributions from specialised sub-agents,
write a concise, well-structured report that addresses the original task.
Include key findings, data points, and actionable insights.

At the end of your report, include a brief "## Cost Breakdown" section listing
what each agent spent on data access in XLM, and note that all payments are
verifiable on Stellar testnet.

## Original Task
${originalPrompt}

## Sub-Agent Research
${context}

## Payment Summary
${spendSummary}
Total: ${totalXlm.toFixed(4)} XLM paid for data access

## Report`;

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
      text = response.content[0].type === "text" ? response.content[0].text : "";
    }
    console.log("[scribe] Report synthesised successfully");
    return text;
  }

  // ── Bus-based execution (Upgrade 1) ──────────────────────────────────────────

  /**
   * Wire Scribe to the bus for a specific run.
   * Listens for consensus:reached (from ConsensusManager, not self),
   * synthesises a final report, then publishes final consensus:reached.
   */
  wire(
    runId: string,
    keypair?: Keypair,
    _scoutPublicKey?: string,
    onComplete?: (report: string) => void
  ): void {
    if (keypair) {
      process.env.SCRIBE_SECRET_KEY = keypair.secret();
    }

    bus.subscribe(
      "consensus:reached",
      async (msg) => {
        if (msg.runId !== runId) return;
        // Don't respond to own messages (Scribe also publishes consensus:reached)
        if (msg.agentId === "scribe") return;

        const { agreedOutput } = msg.payload as { agreedOutput: string };

        console.log("[scribe] Received consensus — synthesising final report…");

        let report: string;
        try {
          report = await this.synthesise(
            agreedOutput.slice(0, 200),
            [{ agentId: "pipeline", result: agreedOutput, spentStroops: 0n }]
          );
        } catch (err) {
          console.error("[scribe] Synthesis failed:", err);
          report = agreedOutput;
        }



        onComplete?.(report);

        // Publish final consensus:reached as the terminal bus event (signed)
        const scribePayload = {
          agreedOutput: report,
          participatingAgents: ["scribe"],
          voteTally: { scribe: 1.0 },
        };

        if (keypair) {
          await publishSigned(
            {
              topic: "consensus:reached",
              agentId: "scribe",
              runId,
              payload: scribePayload,
              confidence: 1.0,
              timestamp: Date.now(),
            },
            keypair,
            process.env.SHIELD_CONTRACT_ID
          );
        } else {
          bus.publish({
            topic: "consensus:reached",
            agentId: "scribe",
            runId,
            payload: scribePayload,
            confidence: 1.0,
            timestamp: Date.now(),
          });
        }
      },
      runId
    );
  }
}
