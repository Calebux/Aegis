/**
 * POST /api/run
 *
 * Accepts { task: string }, runs the Aegis multi-agent pipeline in-process,
 * and streams progress back to the client via Server-Sent Events.
 *
 * Event shapes (unchanged from previous stub so the frontend needs no edits):
 *   { type: "log",          payload: { message: string, level: "info"|"success"|"error" } }
 *   { type: "agent_status", payload: { agent: AgentId, status: AgentStatus, spent?: number } }
 *   { type: "wallets",      payload: Record<AgentId, string> }
 *   { type: "complete",     payload: AegisReport }
 *   { type: "error",        payload: { message: string } }
 */

import { NextRequest } from "next/server";
import { EventEmitter } from "events";
import { runTask } from "@aegis/orchestrator";
import {
  tasks,
  emitters,
  lastWallets,
  lastSpent,
  lastReputation,
  lastTxHashes,
  persistTasks,
} from "@/lib/taskStore";
import type { Task } from "@aegis/shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { task?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
    });
  }

  const prompt = (body?.task ?? "").trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: "task is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const taskId = crypto.randomUUID();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);

  const task: Task = {
    id: taskId,
    prompt,
    status: "running",
    subTasks: [
      {
        id: crypto.randomUUID(),
        assignedAgent: "scout",
        instruction: `Search the web for: ${prompt}`,
        status: "pending",
      },
      {
        id: crypto.randomUUID(),
        assignedAgent: "ledger",
        instruction: `Fetch relevant Stellar on-chain metrics for: ${prompt}`,
        status: "pending",
      },
      {
        id: crypto.randomUUID(),
        assignedAgent: "signal",
        instruction: `Identify market signals for: ${prompt}`,
        status: "pending",
      },
      {
        id: crypto.randomUUID(),
        assignedAgent: "scribe",
        instruction: `Synthesize all findings into a report for: ${prompt}`,
        status: "pending",
      },
    ],
    createdAt: new Date(),
  };

  tasks.set(taskId, task);
  emitters.set(taskId, emitter);

  // Update subtask statuses based on agent_status events
  emitter.on(
    "agent_status",
    (payload: { agent: string; status: string; spent?: number }) => {
      const t = tasks.get(taskId);
      if (!t) return;
      const st = t.subTasks.find((s) => s.assignedAgent === payload.agent);
      if (!st) return;
      if (
        payload.status === "running" ||
        payload.status === "complete" ||
        payload.status === "failed"
      ) {
        st.status =
          payload.status === "complete"
            ? "completed"
            : payload.status === "failed"
              ? "failed"
              : "running";
        if (payload.status === "running") st.startedAt = new Date();
        if (payload.status === "complete" || payload.status === "failed")
          st.completedAt = new Date();
      }
    }
  );

  // Fire-and-forget: run the orchestrator pipeline
  void runTask(prompt, emitter)
    .then((report) => {
      const t = tasks.get(taskId);
      if (t) {
        t.status = "completed";
        t.finalReport = report.report;
        t.completedAt = new Date();
        persistTasks();
      }
    })
    .catch((err: unknown) => {
      const t = tasks.get(taskId);
      if (t) { t.status = "failed"; persistTasks(); }
      console.error("[api/run] orchestrator error:", err);
    })
    .finally(() => {
      emitters.delete(taskId);
    });

  // Store wallet/spend data when complete event fires
  emitter.once(
    "complete",
    (payload: {
      wallets: Record<string, string>;
      spent: Record<string, number>;
      reputation: Record<string, number>;
      txHashes?: Record<string, string[]>;
    }) => {
      for (const [agent, key] of Object.entries(payload.wallets)) {
        lastWallets.set(agent, key);
      }
      for (const [agent, stroops] of Object.entries(payload.spent)) {
        lastSpent.set(agent, stroops);
      }
      for (const [agent, bps] of Object.entries(payload.reputation)) {
        lastReputation.set(agent, bps);
      }
      for (const [agent, hashes] of Object.entries(payload.txHashes ?? {})) {
        lastTxHashes.set(agent, hashes as string[]);
      }
    }
  );

  // Build and return the SSE stream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function emit(type: string, payload: unknown): void {
        try {
          const frame = `data: ${JSON.stringify({ type, payload })}\n\n`;
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Controller already closed (client disconnected)
        }
      }

      emitter.on("log", (p) => emit("log", p));
      emitter.on("agent_status", (p) => emit("agent_status", p));
      emitter.on("wallets", (p) => emit("wallets", p));

      emitter.once("complete", (p) => {
        emit("complete", p);
        controller.close();
      });

      emitter.once("error", (p) => {
        emit("error", p);
        controller.close();
      });
    },
    cancel() {
      // Client disconnected — emitter listeners will leak until task finishes,
      // but the task continues running in the background (fire-and-forget)
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
