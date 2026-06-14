import { NextRequest } from "next/server";
import { delegateTask } from "@calebux/agent-kit";
import { buildAgentManifests } from "@/lib/agentRegistry";
import { receipts, persistReceipts } from "@/lib/taskStore";

export const dynamic = "force-dynamic";

type DelegateBody = {
  childAgentId?: string;
  task?: string;
};

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: parentAgentId } = await context.params;
  const manifests = buildAgentManifests();
  const parentAgent = manifests.find((a) => a.id === parentAgentId);

  if (!parentAgent) {
    return Response.json({ error: `Parent agent not found: ${parentAgentId}` }, { status: 404 });
  }

  let body: DelegateBody;
  try {
    body = (await req.json()) as DelegateBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const childAgentId = (body.childAgentId ?? "").trim();
  const task = (body.task ?? "").trim();

  if (!childAgentId) {
    return Response.json({ error: "childAgentId is required" }, { status: 400 });
  }
  if (!task) {
    return Response.json({ error: "task is required" }, { status: 400 });
  }

  const childAgent = manifests.find((a) => a.id === childAgentId);
  if (!childAgent) {
    return Response.json({ error: `Child agent not found: ${childAgentId}` }, { status: 404 });
  }

  const parentRunId = crypto.randomUUID();
  const delegation = delegateTask(parentAgentId, childAgentId, task, parentRunId);

  // Call the child agent's run endpoint internally
  const origin = req.nextUrl.origin;
  let childResult: unknown = null;
  let childReceipt: unknown = null;

  try {
    const childRes = await fetch(`${origin}/api/agents/${encodeURIComponent(childAgentId)}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    });
    if (childRes.ok) {
      const childBody = (await childRes.json()) as {
        result?: unknown;
        receipt?: unknown;
      };
      childResult = childBody.result;
      childReceipt = childBody.receipt;
    }
  } catch (err) {
    console.warn(`[delegate] Child agent ${childAgentId} run failed:`, err);
  }

  return Response.json({
    delegation,
    childResult,
    childReceipt,
  });
}
