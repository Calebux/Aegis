/**
 * Consensus Manager (Upgrade 4)
 *
 * Listens for signal:complete, checks confidence and conflict flags,
 * and either passes the output straight to Scribe (high confidence path)
 * or spawns a ValidatorAgent to resolve discrepancies first.
 *
 * Publishes consensus:reached when agreement is reached.
 */

import { bus, type AgentMessage } from "../lib/bus.js";
import { ValidatorAgent } from "./validator.js";

// ── Payload types ─────────────────────────────────────────────────────────────

interface SignalPayload {
  analysis: string;
  confidence: number;
  conflictDetected: boolean;
  conflictDetails?: string;
  ledgerData?: unknown;
}

interface ValidatorPayload {
  originalAgentId: string;
  validationPassed: boolean;
  revisedAnalysis?: string;
}

// ── Store last ledger payload for Validator ───────────────────────────────────

/** Per-run ledger payload cache so ConsensusManager can give raw data to Validator */
const ledgerCache = new Map<string, unknown>();

export function cacheLedgerPayload(runId: string, payload: unknown): void {
  ledgerCache.set(runId, payload);
}

// ── ConsensusManager ──────────────────────────────────────────────────────────

export class ConsensusManager {
  readonly id = "consensus-manager";

  wire(runId: string): void {
    bus.subscribe(
      "ledger:complete",
      (msg) => {
        if (msg.runId !== runId) return;
        // Cache ledger payload so Validator can compare against Signal's analysis
        cacheLedgerPayload(runId, msg.payload);
      },
      runId
    );

    bus.subscribe(
      "signal:complete",
      async (msg) => {
        if (msg.runId !== runId) return;

        const output = msg.payload as SignalPayload;
        const needsValidation =
          output.confidence < 0.7 || output.conflictDetected;

        console.log(
          `[consensus] Signal confidence: ${output.confidence.toFixed(2)} | ` +
            `conflict: ${output.conflictDetected} | ` +
            `validation needed: ${needsValidation}`
        );

        if (!needsValidation) {
          // High confidence, no conflict — pass straight to Scribe
          bus.publish({
            topic: "consensus:reached",
            agentId: this.id,
            runId,
            payload: {
              agreedOutput: output.analysis,
              participatingAgents: [msg.agentId],
              voteTally: { [msg.agentId]: output.confidence },
              validationWasRequired: false,
            },
            confidence: output.confidence,
            timestamp: Date.now(),
          });
          return;
        }

        // Low confidence or conflict detected — spawn Validator
        console.log(
          "[consensus] Spawning ValidatorAgent to resolve discrepancy…"
        );
        const validator = new ValidatorAgent();

        // Listen for validator's verdict before forwarding to Scribe
        bus.subscribe(
          "validator:complete",
          (vMsg: AgentMessage) => {
            if (vMsg.runId !== runId) return;
            if (vMsg.agentId !== validator.id) return;

            const vOut = vMsg.payload as ValidatorPayload;

            bus.publish({
              topic: "consensus:reached",
              agentId: this.id,
              runId,
              payload: {
                agreedOutput: vOut.revisedAnalysis ?? output.analysis,
                participatingAgents: [msg.agentId, validator.id],
                voteTally: {
                  [msg.agentId]: output.confidence,
                  [validator.id]: vMsg.confidence,
                },
                validationWasRequired: true,
                conflictResolved: !vOut.validationPassed,
              },
              confidence: Math.max(output.confidence, vMsg.confidence),
              timestamp: Date.now(),
            });
          },
          runId
        );

        // Run the validator (non-blocking — it will publish validator:complete)
        await validator.run({
          runId,
          signalOutput: output.analysis,
          conflictDetails: output.conflictDetails,
          ledgerData: ledgerCache.get(runId),
        });
      },
      runId
    );
  }
}
