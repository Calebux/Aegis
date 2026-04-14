/**
 * Dynamic Task Graph Planner (Upgrade 6)
 *
 * Asks Claude (Haiku — fast) to generate a JSON task graph from the user's
 * prompt. The orchestrator builds its execution plan from this graph instead
 * of hardcoded agent sequences. Simple prompts → 2-node graph. Complex
 * prompts → up to 5 nodes with a Validator inserted automatically.
 */

import Anthropic from "@anthropic-ai/sdk";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentType = "scout" | "ledger" | "signal" | "scribe" | "validator" | "executor";
export type TaskMode = "fast" | "standard" | "deep-research";

export interface TaskNode {
  /** e.g. "n1", "n2" */
  id: string;
  agentType: AgentType;
  /** IDs of nodes that must complete first */
  dependsOn: string[];
  mode: TaskMode;
  params: Record<string, unknown>;
}

export interface TaskGraph {
  runId: string;
  prompt: string;
  nodes: TaskNode[];
}

// ── Planner system prompt ─────────────────────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `
You are a task graph planner for a multi-agent AI system called Aegis.
Given a user prompt, generate a JSON task graph describing which agents to use and in what order.

Available agent types:
- scout: Web search and research. Use mode "deep-research" for broad topics, "fast" for single lookups.
- ledger: On-chain Stellar financial data, price feeds, TVL data. Use for financial/blockchain questions.
- signal: Market analysis and synthesis. Depends on scout and/or ledger outputs. Required before scribe.
- scribe: Final report writer. Always the last node. Depends on signal or consensus.
- validator: Fact checker. Add when the task involves financial data that could conflict with web data.
- executor: Treasury execution agent. Add when the task involves trading decisions or portfolio actions. Depends on signal.

Rules:
1. scout and ledger can run in parallel (neither depends on the other).
2. signal must depend on at least one of scout or ledger.
3. scribe must always be the last node and must depend on signal.
4. validator is optional — only add it if financial accuracy is critical.
5. executor is optional — add when the user asks to take action, rebalance, buy, sell, or execute.
6. For simple factual questions, use only ledger + scribe (2 nodes).
7. For research questions, use scout + signal + scribe (3 nodes).
8. For analysis questions with on-chain data, use scout + ledger + signal + scribe (4 nodes).
9. For high-stakes financial decisions, add validator between signal and scribe (5 nodes).
10. For actionable trading tasks, add executor after signal (runs in parallel with scribe).

Respond with ONLY valid JSON matching this schema. No explanation. No markdown code fences.
{
  "nodes": [
    { "id": "n1", "agentType": "scout",  "dependsOn": [],           "mode": "standard", "params": {} },
    { "id": "n2", "agentType": "ledger", "dependsOn": [],           "mode": "standard", "params": {} },
    { "id": "n3", "agentType": "signal", "dependsOn": ["n1", "n2"], "mode": "standard", "params": {} },
    { "id": "n4", "agentType": "scribe", "dependsOn": ["n3"],       "mode": "standard", "params": {} }
  ]
}
`.trim();

// ── Fallback graph ────────────────────────────────────────────────────────────

const DEFAULT_GRAPH: TaskNode[] = [
  { id: "n1", agentType: "scout",  dependsOn: [],           mode: "standard", params: {} },
  { id: "n2", agentType: "ledger", dependsOn: [],           mode: "standard", params: {} },
  { id: "n3", agentType: "signal", dependsOn: ["n1", "n2"], mode: "standard", params: {} },
  { id: "n4", agentType: "scribe", dependsOn: ["n3"],       mode: "standard", params: {} },
];

// ── Generator ─────────────────────────────────────────────────────────────────

/**
 * Generate a task graph for the given prompt.
 * Uses claude-haiku for speed. Falls back to a 4-node default on any error.
 */
export async function generateTaskGraph(prompt: string): Promise<TaskGraph> {
  const runId = crypto.randomUUID();
  const client = new Anthropic();

  let nodes: TaskNode[] = DEFAULT_GRAPH;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate a task graph for this request: "${prompt}"`,
        },
      ],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text.trim() : "";
    // Strip optional ```json ... ``` fences that some models add despite the prompt
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

    const parsed = JSON.parse(text) as { nodes: TaskNode[] };

    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
      throw new Error("nodes is not a non-empty array");
    }

    for (const n of parsed.nodes) {
      if (!n.id || !n.agentType || !Array.isArray(n.dependsOn)) {
        throw new Error(`Invalid node: ${JSON.stringify(n)}`);
      }
    }

    nodes = parsed.nodes.slice(0, 6); // cap at 6 nodes
    console.log(
      `[planner] Generated ${nodes.length}-node graph for prompt: "${prompt.slice(0, 60)}…"`
    );
  } catch (err) {
    console.warn("[planner] Falling back to default 4-node graph:", String(err));
    nodes = DEFAULT_GRAPH;
  }

  return { runId, prompt, nodes };
}

/** Returns the subset of nodes with no dependencies (starting nodes) */
export function getStartingNodes(graph: TaskGraph): TaskNode[] {
  return graph.nodes.filter((n) => n.dependsOn.length === 0);
}

/** Returns true if the graph includes a node of the given agent type */
export function graphHasAgent(graph: TaskGraph, agentType: AgentType): boolean {
  return graph.nodes.some((n) => n.agentType === agentType);
}
