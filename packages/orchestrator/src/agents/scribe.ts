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
    console.log("[scribe] Synthesising report…");

    // TODO: check spend cap via Shield Contract before calling Claude
    // TODO: build a structured prompt that incorporates all agent outputs
    // TODO: call Claude API and return the synthesised report

    const context = contributions
      .map((c) => `### ${c.agentId.toUpperCase()}\n${c.result}`)
      .join("\n\n");

    const _prompt = `
You are Scribe, the report-writing agent in the Aegis multi-agent system.
Given the following research contributions from specialised sub-agents,
write a concise, well-structured report that addresses the original task.

## Original Task
${originalPrompt}

## Sub-Agent Research
${context}

## Report
`;

    // Stub: return placeholder until logic is wired up
    return `[scribe stub] Report for: "${originalPrompt}"\n\nContributions received from: ${contributions.map((c) => c.agentId).join(", ")}`;
  }
}
