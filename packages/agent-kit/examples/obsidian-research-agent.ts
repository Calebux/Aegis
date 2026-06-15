/**
 * Obsidian Research Agent — off-chain agent with markdown vault memory.
 *
 * This agent researches a topic, stores findings as Obsidian-compatible
 * markdown notes with frontmatter and [[wikilinks]], and recalls past
 * research on subsequent runs.
 *
 * No blockchain, no wallets — just memory and tools.
 *
 * Usage:
 *   npx tsx examples/obsidian-research-agent.ts "What are the top Celo DeFi protocols?"
 */

import {
  createAgentLoop,
  createMemoryProvider,
  webFetchTool,
  fileWriteTool,
  defineTool,
  MarkdownMemoryProvider,
} from "@calebux/agent-kit";

// ── 1. Set up Obsidian-style vault memory ────────────────────────────────────

const memory = createMemoryProvider({
  type: "markdown",
  vaultPath: "./research-vault",
});

// You can also use the class directly for extra methods:
const vault = new MarkdownMemoryProvider("./research-vault");

// ── 2. Define custom tools ───────────────────────────────────────────────────

const summarizeTool = defineTool({
  name: "summarize",
  description: "Summarize text into 3 bullet points",
  parameters: { text: "string" },
  execute: async ({ text }) => {
    // Replace with your LLM call (GPT, Claude, Llama, etc.)
    const sentences = String(text).split(". ").slice(0, 3);
    return sentences.map((s) => `- ${s.trim()}`).join("\n");
  },
});

const storeNoteTool = defineTool({
  name: "store_note",
  description: "Store a research finding as a markdown note in the vault",
  parameters: { title: "string", content: "string", tags: "string" },
  execute: async ({ title, content, tags }) => {
    await vault.store(
      `research/${String(title).replace(/\s+/g, "-").toLowerCase()}`,
      String(content),
      { tags: String(tags), source: "research-agent" }
    );
    return `Stored note: ${title}`;
  },
});

// ── 3. Build the agentic loop ────────────────────────────────────────────────

const goal = process.argv[2] || "What are the top Celo DeFi protocols?";

const loop = createAgentLoop({
  goal,
  tools: [webFetchTool, fileWriteTool, summarizeTool, storeNoteTool],
  memory,
  maxIterations: 8,
  think: async (goal, history, recalled, toolDescriptions) => {
    // ── This is where you plug in YOUR LLM ──
    // For this example, we use a simple rule-based "brain":

    if (history.length === 0 && recalled) {
      // We have past memory — use it
      return {
        done: true,
        tool: "",
        input: {},
        reasoning: `Found relevant past research:\n${recalled}\n\nUsing cached knowledge.`,
      };
    }

    if (history.length === 0) {
      return {
        tool: "web_fetch",
        input: { url: "https://defillama.com/chain/Celo" },
        reasoning: "Starting research by fetching DeFi data",
      };
    }

    if (history.length === 1 && history[0].success) {
      return {
        tool: "summarize",
        input: { text: history[0].observation },
        reasoning: "Summarizing the fetched data",
      };
    }

    if (history.length === 2) {
      return {
        tool: "store_note",
        input: {
          title: "Celo DeFi Overview",
          content: history[1].observation,
          tags: "celo,defi,research",
        },
        reasoning: "Storing findings in vault for future recall",
      };
    }

    return { done: true, tool: "", input: {}, reasoning: "Research complete" };
  },
  onStep: (step) => {
    console.log(
      `\n[Step ${step.iteration}] ${step.toolName}`
    );
    console.log(`  Reasoning: ${step.reasoning}`);
    console.log(
      `  Result: ${step.observation.slice(0, 200)}${step.observation.length > 200 ? "..." : ""}`
    );
  },
});

// ── 4. Run it ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nResearch Agent — Goal: "${goal}"\n`);

  // Check for recalled memory first
  const recalled = await memory.recall("research", goal);
  if (recalled) {
    console.log("Found past research in vault:");
    console.log(recalled.slice(0, 500));
    console.log("\n---\n");
  }

  const result = await loop.run();

  console.log("\n=== RESULT ===");
  console.log(`Completed: ${result.completed}`);
  console.log(`Iterations: ${result.totalIterations}`);
  console.log(`Duration: ${result.totalDurationMs}ms`);
  console.log(`\n${result.summary}`);

  // List what's in the vault now
  const keys = await vault.listKeys();
  if (keys.length > 0) {
    console.log(`\nVault contents (${keys.length} notes):`);
    for (const key of keys) {
      console.log(`  - ${key}`);
    }
  }
}

main().catch(console.error);
