/**
 * GET /api/tasks   — list recent tasks
 * POST /api/tasks  — submit a new task to the orchestrator
 *
 * TODO: connect to the orchestrator process / database.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // TODO: return real task history from orchestrator state store
  return NextResponse.json({ tasks: [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const prompt: string | undefined = body?.prompt;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  // TODO: forward to orchestrator and return the created task
  return NextResponse.json(
    { message: "Task submission not yet wired to orchestrator", prompt },
    { status: 501 }
  );
}
