import {
  discoverAgents,
  type AgentDiscoveryQuery,
  type AgentManifest,
} from "@calebux/agent-kit";

export interface AgentListResponse {
  count: number;
  agents: AgentManifest[];
}

const DEFAULT_AGENTS_URL = "http://localhost:3000/api/agents";

export function getAgentsUrl(): string {
  return process.env.CALAGENT_AGENTS_URL ?? DEFAULT_AGENTS_URL;
}

export function getCalagentBaseUrl(): string {
  const explicit = process.env.CALAGENT_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return getAgentsUrl().replace(/\/api\/agents\/?$/, "");
}

export async function fetchAgentManifests(
  query: AgentDiscoveryQuery = {},
  agentsUrl = getAgentsUrl()
): Promise<AgentListResponse> {
  const url = new URL(agentsUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Cal-AgentKit agents endpoint returned ${res.status}`);
  }

  const body = (await res.json()) as AgentListResponse;
  return {
    count: body.agents.length,
    agents: discoverAgents(body.agents, query),
  };
}

export async function fetchAgentManifest(
  agentId: string,
  agentsUrl = getAgentsUrl()
): Promise<AgentManifest | null> {
  const { agents } = await fetchAgentManifests({}, agentsUrl);
  return agents.find((agent) => agent.id === agentId) ?? null;
}

export async function fetchRunReceipt(
  receiptId: string,
  baseUrl = getCalagentBaseUrl()
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/api/receipts/${encodeURIComponent(receiptId)}`);
  if (!res.ok) throw new Error(`Cal-AgentKit receipt endpoint returned ${res.status}`);
  return res.json();
}

export async function verifyRunReceiptById(
  receiptId: string,
  baseUrl = getCalagentBaseUrl()
): Promise<unknown> {
  const res = await fetch(
    `${baseUrl}/api/receipts/${encodeURIComponent(receiptId)}/verify`
  );
  if (!res.ok) throw new Error(`Cal-AgentKit receipt verify endpoint returned ${res.status}`);
  return res.json();
}

export async function fetchTaskStatus(
  taskId: string,
  baseUrl = getCalagentBaseUrl()
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}`);
  if (!res.ok) throw new Error(`Cal-AgentKit task endpoint returned ${res.status}`);
  return res.json();
}

export async function runAgentTask(
  task: string,
  baseUrl = getCalagentBaseUrl()
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Cal-AgentKit run endpoint returned ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ type: string; payload: unknown }> = [];
  let complete: unknown;
  let receipt: unknown;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      if (!frame.startsWith("data: ")) continue;
      const parsed = JSON.parse(frame.slice(6)) as { type: string; payload: unknown };
      if (parsed.type === "log" || parsed.type === "agent_status") {
        events.push(parsed);
      }
      if (parsed.type === "complete") complete = parsed.payload;
      if (parsed.type === "receipt") receipt = parsed.payload;
      if (parsed.type === "error") {
        const p = parsed.payload as { message?: string };
        throw new Error(p.message ?? "Cal-AgentKit run failed");
      }
    }
  }

  return {
    complete,
    receipt,
    events: events.slice(-20),
  };
}

export async function callExternalAgent(
  agentId: string,
  task: string,
  baseUrl = getCalagentBaseUrl()
): Promise<unknown> {
  const res = await fetch(
    `${baseUrl}/api/agents/${encodeURIComponent(agentId)}/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    }
  );

  const body = await res.json().catch(() => null);
  if (res.status === 402) {
    return {
      paymentRequired: true,
      status: res.status,
      paymentHeader: res.headers.get("x-payment-required"),
      body,
    };
  }

  if (!res.ok) {
    throw new Error(`Cal-AgentKit external agent endpoint returned ${res.status}`);
  }

  return body;
}
