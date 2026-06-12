import { NextResponse } from "next/server";
import { verifyRunReceipt } from "@calebux/agent-kit";
import { receipts, tasks } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const receipt = receipts.get(id);

  if (!receipt) {
    return NextResponse.json({ error: "receipt not found" }, { status: 404 });
  }

  return NextResponse.json({
    receipt,
    verification: verifyRunReceipt(receipt, {
      output: tasks.get(id)?.finalReport,
    }),
  });
}
