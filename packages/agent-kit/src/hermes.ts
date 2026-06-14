/**
 * Hermes agent wrapper — integrates Nous Research's autonomous agent
 * with skill-learning into Cal-AgentKit pipelines.
 */

import type { AgentDefinition, AgentRunResult, AgentContext } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HermesAgentConfig {
  /** Agent ID within the pipeline (default: "hermes") */
  id?: string;
  /** Hermes MCP server URL */
  hermesUrl: string;
  /** Capabilities this Hermes instance is good at */
  capabilities?: string[];
  /** Spend cap in XLM for this agent */
  spendCapXlm?: number;
}

interface HermesResponse {
  result?: string;
  output?: string;
  error?: string;
}

// ── createHermesAgent ────────────────────────────────────────────────────────

/**
 * Wraps a Hermes agent instance as a defineAgent-compatible participant.
 *
 * @example
 * ```ts
 * import { createHermesAgent, createOrchestrator } from '@calebux/agent-kit'
 *
 * const hermes = createHermesAgent({
 *   hermesUrl: 'http://localhost:8080',
 *   capabilities: ['research', 'code-generation'],
 * })
 *
 * const { run } = createOrchestrator([hermes, ...otherAgents])
 * ```
 */
export function createHermesAgent(config: HermesAgentConfig): AgentDefinition {
  const { id = "hermes", hermesUrl, capabilities = [], spendCapXlm = 1 } = config;

  return {
    id,
    spendCapXlm,
    manifest: {
      name: "Hermes Agent",
      description: "Nous Research autonomous agent with skill-learning loop",
      capabilities: ["hermes", "autonomous", "skill-learning", ...capabilities],
    },
    run: async (task: string, _ctx: AgentContext): Promise<AgentRunResult> => {
      const url = hermesUrl.replace(/\/$/, "");

      const resp = await fetch(`${url}/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: task }],
        }),
      });

      if (!resp.ok) {
        throw new Error(`Hermes returned ${resp.status}: ${resp.statusText}`);
      }

      const data = (await resp.json()) as HermesResponse;
      const result = data.result ?? data.output ?? "";

      if (data.error) {
        throw new Error(`Hermes error: ${data.error}`);
      }

      return { result, paymentMode: "none" };
    },
  };
}

// ── MCP Config Helper ────────────────────────────────────────────────────────

/**
 * Returns the JSON config block Hermes needs in its mcp_servers config
 * to connect to a Cal-AgentKit dashboard as an MCP tool provider.
 *
 * @example
 * ```ts
 * const config = getHermesMcpConfig('https://my-deployment.com')
 * // Add to Hermes's mcp_servers.json
 * ```
 */
export function getHermesMcpConfig(dashboardUrl = "http://localhost:3000"): object {
  const baseUrl = dashboardUrl.replace(/\/$/, "");
  return {
    calagent: {
      url: `${baseUrl}/api/mcp`,
      transport: "sse",
      description: "Cal-AgentKit agent infrastructure — discovery, execution, receipts",
      tools: [
        "discover_agents",
        "get_agent_manifest",
        "run_agent_task",
        "get_run_receipt",
        "verify_run_receipt",
      ],
    },
  };
}
