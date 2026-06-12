import { NextResponse } from "next/server";
import { receipts, tasks } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const task = tasks.get(id);

  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const receipt = receipts.get(id);
  const body = JSON.parse(
    JSON.stringify(
      {
        task,
        receiptId: receipt?.runId,
        receiptHash: receipt?.receiptHash,
        receiptUrl: receipt ? `/receipts/${receipt.runId}` : undefined,
      },
      replacer
    )
  ) as unknown;

  return NextResponse.json(body);
}
