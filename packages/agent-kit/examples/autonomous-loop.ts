/**
 * Autonomous Agent Loop — think → act → observe cycle.
 *
 * Demonstrates createAgentLoop with tools and memory.
 * The agent autonomously decides which tools to use to achieve its goal.
 * Works with any LLM — just replace the `think` function.
 *
 * No blockchain needed.
 *
 * Usage:
 *   npx tsx examples/autonomous-loop.ts
 */

import {
  createAgentLoop,
  createMemoryProvider,
  createToolkit,
  webFetchTool,
  fileReadTool,
  fileWriteTool,
  shellTool,
  grepTool,
  defineTool,
} from "@calebux/agent-kit";

// ── Memory (persists between runs) ───────────────────────────────────────────

const memory = createMemoryProvider({
  type: "file",
  filePath: "./.agent-memory/loop-memory.json",
});

// ── Custom tool ──────────────────────────────────────────────────────────────

const jsonParseTool = defineTool({
  name: "json_extract",
  description: "Extract a field from a JSON string",
  parameters: { json: "string", field: "string" },
  execute: async ({ json, field }) => {
    const parsed = JSON.parse(String(json));
    const value = String(field)
      .split(".")
      .reduce((obj: Record<string, unknown>, key) => (obj as Record<string, unknown>)[key] as Record<string, unknown>, parsed);
    return JSON.stringify(value, null, 2);
  },
});

// ── Toolkit (for describing tools to LLM) ────────────────────────────────────

const toolkit = createToolkit([
  webFetchTool,
  fileReadTool,
  fileWriteTool,
  shellTool,
  grepTool,
  jsonParseTool,
]);

// Print available tools
console.log("Available tools:");
console.log(toolkit.describe());
console.log();

// ── Agent Loop ───────────────────────────────────────────────────────────────

const loop = createAgentLoop({
  goal: "Find the current price of CELO token and save it to a file",
  tools: toolkit.tools,
  memory,
  maxIterations: 5,

  think: async (goal, history, recalled, toolDescriptions) => {
    /**
     * REPLACE THIS with your LLM call. Example with OpenAI:
     *
     * const response = await openai.chat.completions.create({
     *   model: 'gpt-4',
     *   messages: [
     *     { role: 'system', content: `You are an agent. Available tools:\n${toolDescriptions}\n\nRespond with JSON: { tool, input, reasoning }` },
     *     { role: 'user', content: `Goal: ${goal}\nHistory: ${JSON.stringify(history.map(h => ({ tool: h.toolName, result: h.observation.slice(0, 200) })))}\nRecalled: ${recalled}` }
     *   ],
     *   response_format: { type: 'json_object' },
     * })
     * return JSON.parse(response.choices[0].message.content)
     */

    // Simple rule-based demo:
    if (history.length === 0) {
      return {
        tool: "web_fetch",
        input: { url: "https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd" },
        reasoning: "Fetching current CELO price from CoinGecko API",
      };
    }

    if (history.length === 1 && history[0].success) {
      return {
        tool: "json_extract",
        input: { json: history[0].observation, field: "celo.usd" },
        reasoning: "Extracting USD price from API response",
      };
    }

    if (history.length === 2 && history[1].success) {
      const price = history[1].observation;
      const content = `CELO Price Report\nDate: ${new Date().toISOString()}\nPrice: $${price} USD\nSource: CoinGecko API`;
      return {
        tool: "file_write",
        input: { path: "./celo-price.txt", content },
        reasoning: `Saving CELO price ($${price}) to file`,
      };
    }

    return { done: true, tool: "", input: {}, reasoning: "Price fetched and saved successfully" };
  },

  isDone: (history) => {
    return history.some(
      (s) => s.toolName === "file_write" && s.success
    );
  },

  onStep: (step) => {
    const status = step.success ? "OK" : "FAIL";
    console.log(`[${step.iteration}] ${step.toolName} (${status}) — ${step.reasoning}`);
    if (!step.success) console.log(`   Error: ${step.observation}`);
  },
});

// ── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Starting autonomous agent loop...\n");

  const result = await loop.run();

  console.log(`\n--- Result ---`);
  console.log(`Goal: ${result.goal}`);
  console.log(`Completed: ${result.completed}`);
  console.log(`Steps: ${result.totalIterations}`);
  console.log(`Duration: ${result.totalDurationMs}ms`);
  console.log(`Final output: ${result.finalOutput}`);
}

main().catch(console.error);
