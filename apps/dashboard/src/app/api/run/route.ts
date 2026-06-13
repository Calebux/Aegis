/**
 * POST /api/run
 *
 * Accepts { task: string }, runs the Cal-AgentKit multi-agent pipeline in-process,
 * and streams progress back to the client via Server-Sent Events.
 *
 * Event shapes (unchanged from previous stub so the frontend needs no edits):
 *   { type: "log",          payload: { message: string, level: "info"|"success"|"error" } }
 *   { type: "agent_status", payload: { agent: AgentId, status: AgentStatus, spent?: number } }
 *   { type: "wallets",      payload: Record<AgentId, string> }
 *   { type: "complete",     payload: CalagentReport }
 *   { type: "error",        payload: { message: string } }
 */

import { NextRequest } from "next/server";
import { EventEmitter } from "events";
import { runCeloTask } from "@calagent/orchestrator";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createRunReceipt,
  signRunReceipt,
  type OrchestratorReport,
  type RunReceipt,
} from "@calebux/agent-kit";
import {
  tasks,
  emitters,
  lastWallets,
  lastSpent,
  lastReputation,
  lastTxHashes,
  receipts,
  persistReceipts,
  persistTasks,
} from "@/lib/taskStore";
import type { Task } from "@calagent/shared";
import {
  validateTaskInput,
  checkRateLimit,
  getClientIp,
} from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro: allow up to 5-min pipeline runs

export async function POST(req: NextRequest) {
  let body: { task?: string; chain?: string };
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

  const validation = validateTaskInput(prompt);
  if (!validation.valid) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ip = getClientIp(req);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
      },
    });
  }

  const taskId = crypto.randomUUID();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);

  const task: Task = {
    id: taskId,
    prompt,
    status: "running",
    chain: "celo",
    subTasks: [
      {
        id: crypto.randomUUID(),
        assignedAgent: "celo-scout",
        instruction: `Search the web for: ${prompt}`,
        status: "pending",
      },
      {
        id: crypto.randomUUID(),
        assignedAgent: "celo-ledger",
        instruction: `Fetch relevant Celo on-chain metrics for: ${prompt}`,
        status: "pending",
      },
      {
        id: crypto.randomUUID(),
        assignedAgent: "celo-signal",
        instruction: `Identify Celo market signals for: ${prompt}`,
        status: "pending",
      },
      {
        id: crypto.randomUUID(),
        assignedAgent: "celo-scribe",
        instruction: `Synthesize all Celo findings into a report for: ${prompt}`,
        status: "pending",
      },
    ],
    createdAt: new Date(),
  };

  tasks.set(taskId, task);
  emitters.set(taskId, emitter);
  persistTasks(); // Persist running task so it survives restarts (marked failed on reload)

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

  // Fire-and-forget: run the Celo orchestrator pipeline
  void runCeloTask(prompt, emitter)
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
      report: string;
      wallets: Record<string, string>;
      spent: Record<string, number>;
      reputation: Record<string, number>;
      txHashes?: Record<string, string[]>;
      timestamp?: string;
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

      const reportForReceipt: OrchestratorReport = {
        task: prompt,
        subtasks: {},
        results: {},
        report: payload.report,
        wallets: payload.wallets,
        spent: payload.spent,
        reputation: payload.reputation,
        txHashes: payload.txHashes ?? {},
        timestamp: payload.timestamp ?? new Date().toISOString(),
      };

      let receipt: RunReceipt = createRunReceipt({
        report: reportForReceipt,
        runId: taskId,
        taskId,
        createdAt: task.createdAt.toISOString(),
        completedAt: payload.timestamp ?? new Date().toISOString(),
        shieldContractId: process.env.CELO_POLICY_ADDRESS,
        registryContractId: process.env.CELO_REGISTRY_ADDRESS,
        network: `eip155:${process.env.CALAGENT_CELO_NETWORK === "mainnet" ? "42220" : "44787"}`,

      });

      const signerSecret = process.env.ORCHESTRATOR_SECRET_KEY;
      if (signerSecret) {
        try {
          receipt = signRunReceipt(receipt, Keypair.fromSecret(signerSecret));
        } catch (err) {
          console.warn("[api/run] Could not sign receipt:", err);
        }
      }

      receipts.set(taskId, receipt);
      persistReceipts();
      emitter.emit("receipt", receipt);
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

      // Store listener refs so we can clean them up on cancel
      const onLog = (p: unknown) => emit("log", p);
      const onAgentStatus = (p: unknown) => emit("agent_status", p);
      const onWallets = (p: unknown) => emit("wallets", p);
      const onTaskGraph = (p: unknown) => emit("task:graph", p);
      const onReceipt = (p: unknown) => emit("receipt", p);

      emitter.on("log", onLog);
      emitter.on("agent_status", onAgentStatus);
      emitter.on("wallets", onWallets);
      emitter.on("task:graph", onTaskGraph);
      emitter.on("receipt", onReceipt);

      const cleanup = () => {
        emitter.removeListener("log", onLog);
        emitter.removeListener("agent_status", onAgentStatus);
        emitter.removeListener("wallets", onWallets);
        emitter.removeListener("task:graph", onTaskGraph);
        emitter.removeListener("receipt", onReceipt);
      };

      emitter.once("complete", (p) => {
        emit("complete", p);
        cleanup();
        controller.close();
      });

      emitter.once("error", (p) => {
        emit("error", p);
        cleanup();
        controller.close();
      });

      // Expose cleanup for cancel()
      (controller as unknown as { _sseCleanup: () => void })._sseCleanup = cleanup;
    },
    cancel() {
      // Client disconnected — clean up SSE listeners to prevent leaks
      // The pipeline continues running in the background (fire-and-forget)
      emitter.removeAllListeners("log");
      emitter.removeAllListeners("agent_status");
      emitter.removeAllListeners("wallets");
      emitter.removeAllListeners("task:graph");
      emitter.removeAllListeners("receipt");
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
