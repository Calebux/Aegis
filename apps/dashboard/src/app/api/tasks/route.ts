/**
 * GET /api/tasks   — list all tasks from the in-memory store
 * POST /api/tasks  — (not used; task submission goes via POST /api/run)
 */

import { NextResponse } from "next/server";
import { tasks } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

/** Replacer to handle BigInt and Date serialisation */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function GET() {
  const list = Array.from(tasks.values())
    // Most recent first
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  // Use JSON.stringify with replacer to handle BigInt / Date, then re-parse
  const serialised = JSON.parse(JSON.stringify({ tasks: list }, replacer)) as {
    tasks: unknown[];
  };

  return NextResponse.json(serialised);
}
