#!/usr/bin/env node
/**
 * aegis-mcp-celo — MCP server for Celo agent infrastructure.
 *
 * Exposes 8 tools for discovering, calling, and verifying Aegis Celo agents.
 * Uses the same JSON-RPC/stdio protocol as aegis-mcp-stellar.
 *
 * Example MCP config:
 * {
 *   "mcpServers": {
 *     "aegis-celo": {
 *       "command": "node",
 *       "args": ["packages/aegis-mcp-celo/dist/index.js"],
 *       "env": {
 *         "AEGIS_BASE_URL": "http://localhost:3000",
 *         "AEGIS_AGENTS_URL": "http://localhost:3000/api/agents?chain=celo"
 *       }
 *     }
 *   }
 * }
 */

import {
  fetchCeloAgents,
  fetchCeloAgentById,
  runCeloAgentTask,
  fetchTaskStatus,
  fetchRunReceipt,
} from "./manifest-client.js";
import type { AgentDiscoveryQuery } from "@calebux/agent-kit";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Json;
  error?: {
    code: number;
    message: string;
    data?: Json;
  };
}

const BASE_URL = process.env.AEGIS_BASE_URL ?? "http://localhost:3000";

const SERVER_INFO = {
  name: "aegis-mcp-celo",
  version: "0.1.0",
};

const TOOLS: Json[] = [
  {
    name: "discover_celo_agents",
    description:
      "Discover Aegis Celo agent manifests. Filter by capability, payment protocol (x402/mpp), asset (cUSD/USDC), network (eip155:42220/44787), and minimum reputation.",
    inputSchema: {
      type: "object",
      properties: {
        capability: { type: "string" },
        protocol: { type: "string", enum: ["x402", "mpp"] },
        asset: { type: "string" },
        network: { type: "string" },
        minReputation: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_celo_agent_manifest",
    description: "Fetch one Aegis Celo agent manifest by ID.",
    inputSchema: {
      type: "object",
      required: ["agentId"],
      properties: {
        agentId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "aegis_celo_endpoint",
    description: "Return the Aegis Celo dashboard API base URL and agents endpoint.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "run_celo_agent_task",
    description:
      "Run a multi-agent Celo pipeline task through the Aegis dashboard API. Streams progress and returns the OrchestratorReport when complete.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "call_celo_agent",
    description:
      "Call a single Celo agent via its x402-gated run endpoint. Returns either the result and run receipt, or a 402 cUSD payment challenge.",
    inputSchema: {
      type: "object",
      required: ["agentId", "task"],
      properties: {
        agentId: { type: "string" },
        task: { type: "string" },
        paymentHeader: {
          type: "string",
          description: "Optional PAYMENT-SIGNATURE header for x402 settlement",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_run_receipt",
    description:
      "Fetch an Aegis Celo run receipt by receiptId. Includes Celo tx hashes and AegisCeloRegistry attestation data.",
    inputSchema: {
      type: "object",
      required: ["receiptId"],
      properties: {
        receiptId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_task_status",
    description:
      "Fetch Celo task/subtask status by taskId.",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "verify_celo_receipt",
    description:
      "Verify an Aegis Celo run receipt: hash chain integrity + AegisCeloRegistry manifest hash attestation.",
    inputSchema: {
      type: "object",
      required: ["receiptId"],
      properties: {
        receiptId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
] as const;

function asDiscoveryQuery(input: Record<string, unknown> = {}): AgentDiscoveryQuery {
  return {
    capability: typeof input.capability === "string" ? input.capability : undefined,
    protocol:
      input.protocol === "x402" || input.protocol === "mpp"
        ? input.protocol
        : undefined,
    asset: typeof input.asset === "string" ? input.asset : undefined,
    network: typeof input.network === "string" ? input.network : undefined,
    minReputation:
      typeof input.minReputation === "number" ? input.minReputation : undefined,
  };
}

function textResult(value: unknown): Json {
  return {
    content: [
      {
        type: "text",
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function verifyCeloReceipt(receiptId: string): Promise<unknown> {
  const url = `${BASE_URL}/api/receipts/${encodeURIComponent(receiptId)}/verify`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
    return res.json();
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

async function runCeloTask(task: string): Promise<unknown> {
  const url = `${BASE_URL}/api/run`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, chain: "celo" }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Celo pipeline error: HTTP ${res.status}`);
  }

  // Collect SSE stream
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finalResult: unknown = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";

    for (const chunk of chunks) {
      if (!chunk.startsWith("data: ")) continue;
      try {
        const { type, payload } = JSON.parse(chunk.slice(6)) as {
          type: string;
          payload: unknown;
        };
        if (type === "complete") finalResult = payload;
      } catch {
        // skip malformed frame
      }
    }
  }

  return finalResult;
}

async function callTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<Json> {
  if (name === "discover_celo_agents") {
    return textResult(await fetchCeloAgents(asDiscoveryQuery(args)));
  }

  if (name === "get_celo_agent_manifest") {
    const agentId = args.agentId;
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new Error("agentId is required");
    }
    const manifest = await fetchCeloAgentById(agentId);
    if (!manifest) throw new Error(`Celo agent not found: ${agentId}`);
    return textResult(manifest);
  }

  if (name === "aegis_celo_endpoint") {
    return textResult({
      baseUrl: BASE_URL,
      agentsUrl: `${BASE_URL}/api/agents?chain=celo`,
      facilitatorUrl: process.env.AEGIS_CELO_X402_FACILITATOR_URL ?? null,
    });
  }

  if (name === "run_celo_agent_task") {
    const task = args.task;
    if (typeof task !== "string" || task.trim().length === 0) {
      throw new Error("task is required");
    }
    return textResult(await runCeloTask(task.trim()));
  }

  if (name === "call_celo_agent") {
    const agentId = args.agentId;
    const task = args.task;
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new Error("agentId is required");
    }
    if (typeof task !== "string" || task.trim().length === 0) {
      throw new Error("task is required");
    }
    const paymentHeader =
      typeof args.paymentHeader === "string" ? args.paymentHeader : undefined;
    return textResult(
      await runCeloAgentTask(agentId, task.trim(), paymentHeader)
    );
  }

  if (name === "get_run_receipt") {
    const receiptId = args.receiptId;
    if (typeof receiptId !== "string" || receiptId.length === 0) {
      throw new Error("receiptId is required");
    }
    return textResult(await fetchRunReceipt(receiptId));
  }

  if (name === "get_task_status") {
    const taskId = args.taskId;
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("taskId is required");
    }
    return textResult(await fetchTaskStatus(taskId));
  }

  if (name === "verify_celo_receipt") {
    const receiptId = args.receiptId;
    if (typeof receiptId !== "string" || receiptId.length === 0) {
      throw new Error("receiptId is required");
    }
    return textResult(await verifyCeloReceipt(receiptId));
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(
  req: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  try {
    if (req.method === "notifications/initialized") {
      return null;
    }

    if (req.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    }

    if (req.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }

    if (req.method === "tools/call") {
      const params = req.params ?? {};
      const name = params.name;
      const args = params.arguments;

      if (typeof name !== "string") {
        throw new Error("tools/call requires params.name");
      }

      return {
        jsonrpc: "2.0",
        id,
        result: await callTool(
          name,
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {}
        ),
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${req.method}`,
      },
    };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function writeMessage(message: JsonRpcResponse): void {
  const body = JSON.stringify(message);
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
  );
}

let buffer = Buffer.alloc(0);

function readMessages(chunk: Buffer): JsonRpcRequest[] {
  buffer = Buffer.concat([buffer, chunk]);
  const messages: JsonRpcRequest[] = [];

  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return messages;

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) {
      throw new Error("Invalid MCP frame: missing Content-Length");
    }

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return messages;

    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.subarray(bodyEnd);
    messages.push(JSON.parse(body) as JsonRpcRequest);
  }
}

process.stdin.on("data", (chunk: Buffer) => {
  let messages: JsonRpcRequest[];
  try {
    messages = readMessages(chunk);
  } catch (err) {
    writeMessage({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: err instanceof Error ? err.message : String(err),
      },
    });
    return;
  }

  for (const message of messages) {
    void handleRequest(message).then((response) => {
      if (response) writeMessage(response);
    });
  }
});

process.stdin.resume();
