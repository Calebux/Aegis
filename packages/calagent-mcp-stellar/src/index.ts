#!/usr/bin/env node

import {
  callExternalAgent,
  fetchAgentManifest,
  fetchAgentManifests,
  fetchTaskStatus,
  fetchRunReceipt,
  getCalagentBaseUrl,
  getAgentsUrl,
  runAgentTask,
  verifyRunReceiptById,
} from "./manifest-client.js";
import type { AgentDiscoveryQuery } from "@calagent/agent-kit";

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

const SERVER_INFO = {
  name: "calagent-mcp-stellar",
  version: "0.1.0",
};

const TOOLS: Json[] = [
  {
    name: "discover_agents",
    description:
      "Discover Cal-AgentKit Stellar agent manifests by capability, payment protocol, asset, network, and minimum reputation.",
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
    name: "get_agent_manifest",
    description: "Fetch one Cal-AgentKit Stellar agent manifest by ID.",
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
    name: "calagent_agents_endpoint",
    description: "Return the Cal-AgentKit dashboard /api/agents endpoint used by this MCP server.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_run_receipt",
    description:
      "Fetch an Cal-AgentKit run receipt by task ID, run ID, or receipt ID.",
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
      "Fetch dashboard task status, subtask status, and receipt pointers by task ID.",
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
    name: "run_agent_task",
    description:
      "Run an Cal-AgentKit multi-agent task through the dashboard API and return the final report and run receipt.",
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
    name: "call_external_agent",
    description:
      "Call a single discovered Cal-AgentKit Stellar agent through its x402-compatible external run endpoint. Returns either the result and run receipt, or a 402 payment requirement.",
    inputSchema: {
      type: "object",
      required: ["agentId", "task"],
      properties: {
        agentId: { type: "string" },
        task: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "verify_run_receipt",
    description:
      "Verify an Cal-AgentKit run receipt hash chain and Stellar signature by task ID, run ID, or receipt ID.",
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
      typeof input.minReputation === "number"
        ? input.minReputation
        : undefined,
  };
}

function textResult(value: unknown): Json {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Json> {
  if (name === "discover_agents") {
    return textResult(await fetchAgentManifests(asDiscoveryQuery(args)));
  }

  if (name === "get_agent_manifest") {
    const agentId = args.agentId;
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new Error("agentId is required");
    }
    const manifest = await fetchAgentManifest(agentId);
    if (!manifest) throw new Error(`Agent not found: ${agentId}`);
    return textResult(manifest);
  }

  if (name === "calagent_agents_endpoint") {
    return textResult({ agentsUrl: getAgentsUrl(), baseUrl: getCalagentBaseUrl() });
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

  if (name === "run_agent_task") {
    const task = args.task;
    if (typeof task !== "string" || task.trim().length === 0) {
      throw new Error("task is required");
    }
    return textResult(await runAgentTask(task.trim()));
  }

  if (name === "call_external_agent") {
    const agentId = args.agentId;
    const task = args.task;
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new Error("agentId is required");
    }
    if (typeof task !== "string" || task.trim().length === 0) {
      throw new Error("task is required");
    }
    return textResult(await callExternalAgent(agentId, task.trim()));
  }

  if (name === "verify_run_receipt") {
    const receiptId = args.receiptId;
    if (typeof receiptId !== "string" || receiptId.length === 0) {
      throw new Error("receiptId is required");
    }
    return textResult(await verifyRunReceiptById(receiptId));
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
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
          capabilities: {
            tools: {},
          },
          serverInfo: SERVER_INFO,
        },
      };
    }

    if (req.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      };
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
          args && typeof args === "object" ? (args as Record<string, unknown>) : {}
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
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
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
