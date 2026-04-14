/**
 * Consensus Manager (Upgrade 4)
 *
 * Listens for signal:complete, checks confidence and conflict flags,
 * and either passes the output straight to Scribe (high confidence path)
 * or spawns a ValidatorAgent to resolve discrepancies first.
 *
 * Publishes consensus:reached when agreement is reached.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { IdentityRegistry } from "@calebux/agent-kit";
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

  wire(
    runId: string,
    registry?: IdentityRegistry,
    agentKeypairs?: Map<string, Keypair>,
    forceValidation = false   // true when any agent is on reputation probation
  ): void {
    // Accumulate independent views from all three data agents
    let scoutSummary  = "";
    let ledgerSummary = "";

    bus.subscribe(
      "scout:complete",
      (msg) => {
        if (msg.runId !== runId) return;
        const p = msg.payload as Record<string, unknown>;
        scoutSummary = (p["summary"] as string) ?? (p["result"] as string) ?? "";
      },
      runId
    );

    bus.subscribe(
      "ledger:complete",
      (msg) => {
        if (msg.runId !== runId) return;
        const p = msg.payload as Record<string, unknown>;
        ledgerSummary = (p["summary"] as string) ?? "";
        // Cache full payload so Validator can cross-check against Signal's analysis
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
          forceValidation || output.confidence < 0.7 || output.conflictDetected;

        // Log what each independent source contributed
        console.log(`[consensus] 3-source reconciliation:`);
        console.log(`   Web (Scout):    ${scoutSummary  ? scoutSummary.slice(0, 80) + "…"  : "no data"}`);
        console.log(`   On-chain (Ledger): ${ledgerSummary ? ledgerSummary.slice(0, 80) + "…" : "no data"}`);
        console.log(`   Market (Signal): confidence ${output.confidence.toFixed(2)} | conflict: ${output.conflictDetected}`);
        console.log(`   Validation needed: ${needsValidation}`);

        if (!needsValidation) {
          // High confidence, no conflict — pass straight to Scribe
          const sources = ["signal"];
          if (scoutSummary)  sources.push("scout");
          if (ledgerSummary) sources.push("ledger");

          bus.publish({
            topic: "consensus:reached",
            agentId: this.id,
            runId,
            payload: {
              agreedOutput: output.analysis,
              participatingAgents: sources,
              voteTally: {
                signal: output.confidence,
                ...(scoutSummary  ? { scout:  0.9 } : {}),
                ...(ledgerSummary ? { ledger: 0.9 } : {}),
              },
              validationWasRequired: false,
              sourceCount: sources.length,
            },
            confidence: output.confidence,
            timestamp: Date.now(),
          });
          // Fire-and-forget: reward contributing agent's on-chain reputation
          const contributorKp = agentKeypairs?.get(msg.agentId);
          if (registry && contributorKp) {
            registry.recordSuccess(msg.agentId, contributorKp).catch(() => {});
          }
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
            // Fire-and-forget: reward both signal and validator for reaching consensus
            const contributorKp = agentKeypairs?.get(msg.agentId);
            const validatorKp   = agentKeypairs?.get(validator.id);
            if (registry && contributorKp) registry.recordSuccess(msg.agentId, contributorKp).catch(() => {});
            if (registry && validatorKp)   registry.recordSuccess(validator.id, validatorKp).catch(() => {});
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
