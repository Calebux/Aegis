/**
 * Validator Agent (Upgrade 4)
 *
 * Spawned dynamically by ConsensusManager when Signal reports low confidence
 * or a conflict between its analysis and Ledger's raw data. Uses Claude to
 * check whether the analysis is consistent with the raw financial data.
 *
 * Publishes validator:complete to the bus when done.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "@calagent/agent-kit";
import { bus } from "../lib/bus.js";

// ── System prompt ─────────────────────────────────────────────────────────────

const VALIDATOR_SYSTEM_PROMPT = `
You are a financial data validator. You receive two inputs:
1. An analysis produced by a market analysis agent
2. Raw financial data from an on-chain data source

Your job is to check whether the analysis is consistent with the raw data.
If you find a material inconsistency (e.g. the analysis says TVL is growing
but the raw data shows it declining), respond with [CONFLICT] at the start of
your response, followed by your corrected analysis.
If the analysis is consistent with the raw data, respond with [VALID] at the
start of your response, followed by the original analysis unchanged.
Be strict. A small rounding difference is not a conflict.
A directional disagreement (growing vs declining) is always a conflict.
If raw data is not provided or is insufficient, respond with [VALID] and the
original analysis — do not fabricate a conflict.
`.trim();

// ── ValidatorAgent ────────────────────────────────────────────────────────────

export class ValidatorAgent {
  readonly id: string;
  private client: Anthropic;
  private readonly llm?: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.id = `validator-${crypto.randomUUID().slice(0, 8)}`;
    this.client = new Anthropic();
    this.llm = llm;
  }

  async run(params: {
    runId: string;
    signalOutput: string;
    conflictDetails?: string;
    ledgerData?: unknown;
  }): Promise<void> {
    const { runId, signalOutput, conflictDetails, ledgerData } = params;

    console.log(`[${this.id}] Validating Signal output…`);

    const userMessage = [
      "## Signal Agent Analysis:",
      signalOutput,
      "",
      ...(conflictDetails
        ? ["## Conflict Flags Raised by Signal:", conflictDetails, ""]
        : []),
      "## Raw Ledger Data:",
      JSON.stringify(ledgerData ?? "not provided", null, 2),
    ].join("\n");

    try {
      let text: string;

      if (this.llm) {
        const result = await this.llm.chat(
          [{ role: "user", content: userMessage }],
          { model: "claude-opus-4-6", maxTokens: 2048, system: VALIDATOR_SYSTEM_PROMPT }
        );
        text = result.text;
      } else {
        const response = await this.client.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 2048,
          system: VALIDATOR_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        });
        text = response.content[0].type === "text" ? response.content[0].text : "";
      }
      const validationPassed = text.startsWith("[VALID]");
      const revisedAnalysis = validationPassed
        ? undefined
        : text.replace(/^\[CONFLICT\]\s*/, "").trim();

      console.log(
        `[${this.id}] Validation ${validationPassed ? "PASSED" : "CONFLICT DETECTED"}`
      );

      bus.publish({
        topic: "validator:complete",
        agentId: this.id,
        runId,
        payload: {
          originalAgentId: "signal",
          validationPassed,
          revisedAnalysis,
        },
        confidence: validationPassed ? 0.95 : 0.75,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error(`[${this.id}] Validation failed:`, err);
      bus.publish({
        topic: "task:error",
        agentId: this.id,
        runId,
        payload: { agentId: this.id, error: String(err), fatal: false },
        confidence: 0,
        timestamp: Date.now(),
      });
    }
  }
}
