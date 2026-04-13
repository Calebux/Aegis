/**
 * Scribe Agent
 *
 * Synthesises sub-agent results into a coherent final report using
 * the Anthropic Claude API. This is the only agent that calls Claude
 * directly; spend is still tracked against its Shield Contract allowance.
 */

import Anthropic from "@anthropic-ai/sdk";
import { keypairFromSecret } from "@aegis/shared";

interface AgentContribution {
  agentId: string;
  result: string;
  spentStroops: bigint;
}

export class ScribeAgent {
  private readonly anthropic: Anthropic;
  private readonly keypair: ReturnType<typeof keypairFromSecret> | null;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      messages: [
        {
          role: "user",
          content: `You are Scribe, the report-writing agent in the Aegis multi-agent system.
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

## Report`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    console.log("[scribe] Report synthesised successfully");
    return text;
  }
}
