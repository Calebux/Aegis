import { NextResponse } from "next/server";
import { verifyRunReceipt } from "@calagent/agent-kit";
import { receiptOutputs, receipts, tasks } from "@/lib/taskStore";

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

  const output =
    (receipt.taskId ? tasks.get(receipt.taskId)?.finalReport : undefined) ??
    receiptOutputs.get(id) ??
    receiptOutputs.get(receipt.runId);

  return NextResponse.json({
    ...verifyRunReceipt(receipt, { output }),
    outputChecked: output !== undefined,
  });
}
