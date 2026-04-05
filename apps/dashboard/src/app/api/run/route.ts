/**
 * POST /api/run
 *
 * Accepts { task: string }, runs the real Aegis multi-agent pipeline, and
 * streams progress back to the client via Server-Sent Events.
 *
 * Event shapes:
 *   { type: "log",          payload: { message: string, level: "info"|"success"|"error" } }
 *   { type: "agent_status", payload: { agent: AgentId, status: AgentStatus, spent?: number } }
 *   { type: "wallets",      payload: Record<AgentId, string> }
 *   { type: "complete",     payload: AegisReport }
 *   { type: "error",        payload: { message: string } }
 */

import { NextRequest } from "next/server";
import * as http from "http";

export const dynamic = "force-dynamic";
// Allow the pipeline to run longer than the default 60s
export const maxDuration = 300;

// ── Horizon x402 server singleton ─────────────────────────────────────────────
//
// The Ledger and Signal agents call localhost:3001. We start the server once
// per process and keep a reference so it isn't started twice.

let horizonServer: http.Server | null = null;

async function ensureHorizonServer(): Promise<void> {
  if (horizonServer) return;
  try {
    // Dynamic import to avoid pulling in the server at module parse time
    const { startHorizonX402Server } = await import(
      "@aegis/orchestrator/services/horizon-x402-server"
    );
    horizonServer = await startHorizonX402Server();
  } catch (err) {
    // Port already in use or server already running — not fatal
    console.warn("[api/run] Horizon x402 server start skipped:", err);
  }
}

// ── SSE handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { task?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const task = (body?.task ?? "").trim();
  if (!task) {
    return new Response(JSON.stringify({ error: "task is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(type: string, payload: unknown): void {
        const frame = `data: ${JSON.stringify({ type, payload })}\n\n`;
        controller.enqueue(encoder.encode(frame));
      }

      try {
        emit("log", { message: "🔮 Aegis initializing…", level: "info" });

        // Ensure the Horizon x402 server is up before running the pipeline
        await ensureHorizonServer();

        // Dynamically import runAegis to avoid top-level side-effects
        const { runAegis } = await import("@aegis/orchestrator");

        await runAegis(task, emit);

      } catch (err) {
        emit("error", { message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
