/**
 * createAgentLoop — Autonomous think→act→observe cycle.
 *
 * No blockchain, no wallets required. Give an agent a goal, tools,
 * and optional memory — it loops until the goal is met or the budget
 * (iteration limit) is exhausted.
 *
 * @example
 * ```ts
 * import { createAgentLoop, webFetchTool, createMemoryProvider } from '@calagent/agent-kit'
 *
 * const loop = createAgentLoop({
 *   goal: 'Find the top 3 Celo DeFi protocols by TVL',
 *   tools: [webFetchTool],
 *   memory: createMemoryProvider({ type: 'markdown', vaultPath: './research' }),
 *   maxIterations: 10,
 *   think: async (goal, history, memory) => {
 *     // Use your LLM here to decide the next action
 *     return { tool: 'web_fetch', input: { url: '...' }, reasoning: '...' }
 *   },
 *   isDone: (history) => history.some(s => s.observation.includes('DONE')),
 * })
 *
 * const result = await loop.run()
 * console.log(result.summary)
 * ```
 */

import type { MemoryProvider } from "./memory.js";
import type { Tool, Toolkit, ToolResult } from "./tools.js";
import { createToolkit } from "./tools.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LoopStep {
  iteration: number;
  reasoning: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  observation: string;
  success: boolean;
  durationMs: number;
  timestamp: string;
}

export interface LoopResult {
  goal: string;
  steps: LoopStep[];
  summary: string;
  totalIterations: number;
  totalDurationMs: number;
  completed: boolean;
  /** Final observation from the last step */
  finalOutput: string;
}

export interface ThinkResult {
  /** Which tool to call next */
  tool: string;
  /** Input for the tool */
  input: Record<string, unknown>;
  /** Chain-of-thought reasoning */
  reasoning: string;
  /** If true, this is the final answer — skip tool call, use reasoning as output */
  done?: boolean;
}

export interface AgentLoopOptions {
  /** The goal the agent is trying to achieve */
  goal: string;
  /** Tools available to the agent */
  tools: Tool[];
  /** Maximum iterations before stopping (default: 10) */
  maxIterations?: number;
  /** Optional memory provider for cross-run context */
  memory?: MemoryProvider;
  /**
   * Think function — the "brain" of the loop.
   * Takes the goal, history so far, recalled memory, and toolkit description.
   * Returns which tool to call next and why.
   * This is where you plug in your LLM (GPT, Claude, local model, etc).
   */
  think: (
    goal: string,
    history: LoopStep[],
    recalledMemory: string,
    toolDescriptions: string
  ) => Promise<ThinkResult>;
  /**
   * Optional completion checker. Return true when the goal is met.
   * If omitted, the loop runs until maxIterations or think returns { done: true }.
   */
  isDone?: (history: LoopStep[]) => boolean;
  /** Called after each step (for streaming/logging) */
  onStep?: (step: LoopStep) => void;
}

// ── createAgentLoop ──────────────────────────────────────────────────────────

export function createAgentLoop(options: AgentLoopOptions) {
  const {
    goal,
    tools,
    maxIterations = 10,
    memory,
    think,
    isDone,
    onStep,
  } = options;

  const toolkit = createToolkit(tools);

  async function run(): Promise<LoopResult> {
    const steps: LoopStep[] = [];
    const startTime = Date.now();

    // Recall past context if memory is available
    let recalledMemory = "";
    if (memory) {
      recalledMemory = await memory.recall("agent-loop", goal).catch(() => "");
    }

    const toolDescriptions = toolkit.describe();

    for (let i = 1; i <= maxIterations; i++) {
      // ── Think ──────────────────────────────────────────────────────
      const thought = await think(goal, steps, recalledMemory, toolDescriptions);

      // If the agent says it's done, record and break
      if (thought.done) {
        const step: LoopStep = {
          iteration: i,
          reasoning: thought.reasoning,
          toolName: "(done)",
          toolInput: {},
          observation: thought.reasoning,
          success: true,
          durationMs: 0,
          timestamp: new Date().toISOString(),
        };
        steps.push(step);
        onStep?.(step);
        break;
      }

      // ── Act ────────────────────────────────────────────────────────
      const stepStart = Date.now();
      const result = await toolkit.call(thought.tool, thought.input);

      const observation = result.success
        ? String(result.output ?? "(no output)")
        : `Error: ${result.error}`;

      const step: LoopStep = {
        iteration: i,
        reasoning: thought.reasoning,
        toolName: thought.tool,
        toolInput: thought.input,
        observation: observation.slice(0, 5000), // Cap to prevent memory blowup
        success: result.success,
        durationMs: Date.now() - stepStart,
        timestamp: new Date().toISOString(),
      };

      steps.push(step);
      onStep?.(step);

      // ── Observe / Check completion ─────────────────────────────────
      if (isDone?.(steps)) break;
    }

    const completed =
      steps.length > 0 &&
      (steps[steps.length - 1].toolName === "(done)" ||
        (isDone ? isDone(steps) : false));

    const finalOutput = steps.length > 0 ? steps[steps.length - 1].observation : "";

    // Auto-store results in memory
    if (memory) {
      const summary = steps
        .map((s) => `[${s.iteration}] ${s.toolName}: ${s.observation.slice(0, 100)}`)
        .join("\n");
      memory
        .store(`loop/${Date.now()}`, summary, {
          goal,
          completed: String(completed),
          iterations: String(steps.length),
        })
        .catch(() => {});
    }

    const loopResult: LoopResult = {
      goal,
      steps,
      summary: buildSummary(goal, steps, completed),
      totalIterations: steps.length,
      totalDurationMs: Date.now() - startTime,
      completed,
      finalOutput,
    };

    return loopResult;
  }

  return { run };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(
  goal: string,
  steps: LoopStep[],
  completed: boolean
): string {
  const status = completed ? "Completed" : "Stopped (max iterations)";
  const toolsUsed = [...new Set(steps.map((s) => s.toolName))].join(", ");
  const successRate = steps.length > 0
    ? `${steps.filter((s) => s.success).length}/${steps.length} steps succeeded`
    : "no steps";

  return [
    `## Agent Loop — ${status}`,
    `**Goal:** ${goal}`,
    `**Iterations:** ${steps.length}`,
    `**Tools used:** ${toolsUsed}`,
    `**Success rate:** ${successRate}`,
    "",
    "### Steps",
    ...steps.map(
      (s) =>
        `${s.iteration}. **${s.toolName}** — ${s.reasoning.slice(0, 100)}${s.reasoning.length > 100 ? "..." : ""}`
    ),
  ].join("\n");
}
