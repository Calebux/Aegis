/**
 * HTTP client for the Aegis Celo agent manifest API.
 * Calls /api/agents?chain=celo to get Celo-specific agent manifests.
 */

import type { AgentManifest, AgentDiscoveryQuery } from "@calebux/agent-kit";

const BASE_URL = process.env.AEGIS_BASE_URL ?? "http://localhost:3000";
const AGENTS_URL =
  process.env.AEGIS_AGENTS_URL ??
  `${BASE_URL}/api/agents?chain=celo`;

export async function fetchCeloAgents(
  query: AgentDiscoveryQuery = {}
): Promise<AgentManifest[]> {
  let url = AGENTS_URL;
  const params = new URLSearchParams();

  if (query.capability) params.set("capability", query.capability);
  if (query.chain) params.set("chain", query.chain);
  if (query.minReputation !== undefined)
    params.set("minReputation", String(query.minReputation));

  const qs = params.toString();
  if (qs) url = `${url}&${qs}`;

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Aegis Celo API error ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as { agents?: AgentManifest[] } | AgentManifest[];
  return Array.isArray(body) ? body : (body.agents ?? []);
}

export async function fetchCeloAgentById(
  agentId: string
): Promise<AgentManifest | null> {
  try {
    const agents = await fetchCeloAgents();
    return agents.find((a) => a.id === agentId) ?? null;
  } catch {
    return null;
  }
}

export async function runCeloAgentTask(
  agentId: string,
  task: string,
  paymentHeader?: string
): Promise<unknown> {
  const url = `${BASE_URL}/api/agents/${encodeURIComponent(agentId)}/run`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (paymentHeader) {
    headers["PAYMENT-SIGNATURE"] = paymentHeader;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ task }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Agent ${agentId} error ${res.status}: ${body}`);
  }

  return res.json();
}

export async function fetchTaskStatus(taskId: string): Promise<unknown> {
  const url = `${BASE_URL}/api/tasks/${encodeURIComponent(taskId)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Task status error ${res.status}`);
  return res.json();
}

export async function fetchRunReceipt(receiptId: string): Promise<unknown> {
  const url = `${BASE_URL}/api/receipts/${encodeURIComponent(receiptId)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Receipt fetch error ${res.status}`);
  return res.json();
}
