/**
 * Aegis Agent Event Bus
 *
 * Pub/sub backbone for inter-agent communication.
 * Replaces direct orchestrator-mediated agent calls.
 * All agents publish to this bus; consuming agents subscribe.
 */

import { EventEmitter } from "events";

// ── Topic registry ────────────────────────────────────────────────────────────

export type AgentTopic =
  | "scout:complete"
  | "ledger:complete"
  | "signal:complete"
  | "validator:complete"
  | "consensus:reached"
  | "consensus:failed"
  | "task:error";

// ── Message envelope ──────────────────────────────────────────────────────────

export interface AgentMessage {
  topic: AgentTopic;
  /** Must match the agent's Soroban identity ID */
  agentId: string;
  /** Unique per pipeline run — use crypto.randomUUID() */
  runId: string;
  /** Typed per topic — see payload shapes below */
  payload: unknown;
  /** 0.0–1.0 agent self-assessed output quality */
  confidence: number;
  timestamp: number;
  /** Added in Upgrade 7 — undefined until signing is wired */
  signature?: string;
}

/*
 * Payload shapes by topic:
 *
 * scout:complete     → { query: string; results: SearchResult[]; sources: string[]; subAgentCount?: number }
 * ledger:complete    → { endpoint: string; data: unknown; paidViaX402: boolean; txHash?: string; networkStats?: unknown; accountData?: unknown }
 * signal:complete    → { analysis: string; confidence: number; conflictDetected: boolean; conflictDetails?: string }
 * validator:complete → { originalAgentId: string; validationPassed: boolean; revisedAnalysis?: string }
 * consensus:reached  → { agreedOutput: string; participatingAgents: string[]; voteTally: Record<string,number>; validationWasRequired?: boolean }
 * consensus:failed   → { reason: string; conflictingAgents: string[]; escalateTo: 'orchestrator' }
 * task:error         → { agentId: string; error: string; fatal: boolean } | { type: 'reputation:updated'; agentId: string; newScore: number; delta: number }
 */

export type BusEventHandler = (msg: AgentMessage) => void;

// ── Bus implementation ────────────────────────────────────────────────────────

class AegisBus {
  private emitter = new EventEmitter();
  /** Track handlers per runId so we can clean up without leaking listeners */
  private runHandlers = new Map<
    string,
    Array<{ topic: string; handler: BusEventHandler }>
  >();

  /** Optional SSE callback — wire this in the route handler */
  public onEvent?: (msg: AgentMessage) => void;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(msg: AgentMessage): void {
    this.emitter.emit(msg.topic, msg);
    if (this.onEvent) this.onEvent(msg);
  }

  subscribe(
    topic: AgentTopic,
    handler: BusEventHandler,
    runId?: string
  ): () => void {
    this.emitter.on(topic, handler);
    if (runId) {
      const list = this.runHandlers.get(runId) ?? [];
      list.push({ topic, handler });
      this.runHandlers.set(runId, list);
    }
    return () => this.emitter.off(topic, handler);
  }

  once(topic: AgentTopic, handler: BusEventHandler): void {
    this.emitter.once(topic, handler);
  }

  /** Remove all listeners registered for a given runId */
  clear(runId: string): void {
    const handlers = this.runHandlers.get(runId) ?? [];
    handlers.forEach(({ topic, handler }) =>
      this.emitter.off(topic, handler)
    );
    this.runHandlers.delete(runId);
  }
}

/** Singleton — the entire application shares one bus per process */
export const bus = new AegisBus();
