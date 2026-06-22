/**
 * OpenAI Function Calling Integration — use agent-kit tools with GPT.
 *
 * Demonstrates how to export agent-kit tools in OpenAI's function-calling
 * format and use them in a GPT-powered agentic loop.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx examples/openai-function-calling.ts
 */

import {
  createAgentLoop,
  createToolkit,
  webFetchTool,
  fileWriteTool,
  grepTool,
  defineTool,
  toOpenAIFunctions,
} from "@calagent/agent-kit";

// ── Tools ────────────────────────────────────────────────────────────────────

const tools = [webFetchTool, fileWriteTool, grepTool];
const toolkit = createToolkit(tools);

// Export tools in OpenAI function-calling format
const openAIFunctions = toOpenAIFunctions(tools);
console.log("OpenAI function definitions:");
console.log(JSON.stringify(openAIFunctions, null, 2));

// ── Agent loop with OpenAI as the "brain" ────────────────────────────────────

const loop = createAgentLoop({
  goal: "Search for TypeScript files containing 'agent' and save a summary",
  tools,
  maxIterations: 5,

  think: async (goal, history, recalled, toolDescriptions) => {
    // ── Option A: Use OpenAI SDK directly ──
    //
    // const openai = new OpenAI()
    // const response = await openai.chat.completions.create({
    //   model: 'gpt-4',
    //   messages: [
    //     {
    //       role: 'system',
    //       content: `You are an autonomous agent. Choose the best tool to achieve the goal.
    //                  Respond with JSON: { "tool": "tool_name", "input": { ... }, "reasoning": "why" }
    //                  Set "done": true when the goal is achieved.`
    //     },
    //     {
    //       role: 'user',
    //       content: `Goal: ${goal}\n\nAvailable tools:\n${toolDescriptions}\n\nHistory: ${JSON.stringify(history.map(h => ({
    //         step: h.iteration,
    //         tool: h.toolName,
    //         result: h.observation.slice(0, 200)
    //       })))}`
    //     }
    //   ],
    //   functions: openAIFunctions,  // <-- agent-kit tools in OpenAI format!
    //   function_call: 'auto',
    // })

    // ── Option B: Simple demo without API key ──
    if (history.length === 0) {
      return {
        tool: "grep",
        input: { pattern: "agent", path: ".", glob: "*.ts" },
        reasoning: "Searching for TypeScript files containing 'agent'",
      };
    }

    if (history.length === 1 && history[0].success) {
      return {
        tool: "file_write",
        input: {
          path: "./agent-search-results.txt",
          content: `Agent Search Results\n${new Date().toISOString()}\n\n${history[0].observation}`,
        },
        reasoning: "Saving search results to file",
      };
    }

    return { done: true, tool: "", input: {}, reasoning: "Search complete and saved" };
  },

  onStep: (step) => {
    console.log(`\n[${step.iteration}] ${step.toolName} — ${step.reasoning}`);
  },
});

async function main() {
  const result = await loop.run();
  console.log(`\nCompleted: ${result.completed}`);
  console.log(`Steps: ${result.totalIterations}`);
  console.log(result.summary);
}

main().catch(console.error);
