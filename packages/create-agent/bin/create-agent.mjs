#!/usr/bin/env node

/**
 * create-agent — Scaffold an AI agent project with @calebux/agent-kit.
 *
 * Usage:
 *   npx create-agent my-agent
 *   npx create-agent my-agent --onchain
 *   npx create-agent my-agent --celo
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const templatesDir = join(__dirname, "..", "templates");

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

if (positional.length === 0 || flags.has("--help")) {
  console.log(`
  create-agent — Scaffold an AI agent project

  Usage:
    npx create-agent <project-name> [options]

  Options:
    --onchain    Include Stellar on-chain orchestration
    --celo       Include Celo on-chain orchestration
    --memory     Memory type: markdown (default), file, memory
    --help       Show this help

  Examples:
    npx create-agent my-agent                    # Off-chain with markdown memory
    npx create-agent my-agent --onchain          # With Stellar contracts
    npx create-agent my-agent --celo             # With Celo contracts
`);
  process.exit(0);
}

const projectName = positional[0];
const useOnchain = flags.has("--onchain");
const useCelo = flags.has("--celo");
const projectDir = resolve(projectName);

// ── Scaffold ─────────────────────────────────────────────────────────────────

console.log(`\n  Creating agent project: ${projectName}\n`);

if (existsSync(projectDir)) {
  console.error(`  Error: Directory "${projectName}" already exists.`);
  process.exit(1);
}

mkdirSync(projectDir, { recursive: true });
mkdirSync(join(projectDir, "src"), { recursive: true });

// ── package.json ─────────────────────────────────────────────────────────────

const pkg = {
  name: projectName,
  version: "0.1.0",
  private: true,
  type: "module",
  scripts: {
    start: "npx tsx src/index.ts",
    dev: "npx tsx --watch src/index.ts",
  },
  dependencies: {
    "@calebux/agent-kit": "^0.6.0",
  },
};

writeFileSync(join(projectDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// ── tsconfig.json ────────────────────────────────────────────────────────────

const tsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    esModuleInterop: true,
    strict: true,
    outDir: "dist",
    declaration: true,
    skipLibCheck: true,
  },
  include: ["src"],
};

writeFileSync(join(projectDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");

// ── .env ─────────────────────────────────────────────────────────────────────

let envContent = `# Agent configuration\n# OPENAI_API_KEY=sk-...\n# ANTHROPIC_API_KEY=sk-ant-...\n`;

if (useOnchain) {
  envContent += `
# Stellar (testnet)
STELLAR_NETWORK=testnet
SHIELD_CONTRACT_ID=
REGISTRY_CONTRACT_ID=
ORCHESTRATOR_SECRET_KEY=
`;
}

if (useCelo) {
  envContent += `
# Celo
CALAGENT_CELO_NETWORK=alfajores
CELO_RPC_URL=https://alfajores-forno.celo-testnet.org
CELO_REGISTRY_ADDRESS=
CELO_POLICY_ADDRESS=
CELO_DEPLOYER_PRIVATE_KEY=
`;
}

writeFileSync(join(projectDir, ".env"), envContent);
writeFileSync(join(projectDir, ".gitignore"), "node_modules\ndist\n.env\n.agent-memory\nvault\n");

// ── src/index.ts ─────────────────────────────────────────────────────────────

let mainFile = "";

if (useCelo) {
  mainFile = readTemplate("celo-agent.ts");
} else if (useOnchain) {
  mainFile = readTemplate("stellar-agent.ts");
} else {
  mainFile = readTemplate("offchain-agent.ts");
}

writeFileSync(join(projectDir, "src", "index.ts"), mainFile);

// ── AGENTS.md ────────────────────────────────────────────────────────────────

writeFileSync(
  join(projectDir, "AGENTS.md"),
  `# ${projectName}

AI agent built with [@calebux/agent-kit](https://www.npmjs.com/package/@calebux/agent-kit).

## Quick start

\`\`\`bash
npm install
npm start
\`\`\`

## Architecture

${useCelo ? "This agent uses Celo on-chain orchestration with CeloIdentityRegistry and CeloPolicyManager." : useOnchain ? "This agent uses Stellar on-chain orchestration with ShieldContract and IdentityRegistry." : "This agent runs fully off-chain with markdown vault memory and agentic loops."}

See \`src/index.ts\` for the main agent logic.
`
);

// ── Done ─────────────────────────────────────────────────────────────────────

console.log(`  Created files:`);
console.log(`    ${projectName}/package.json`);
console.log(`    ${projectName}/tsconfig.json`);
console.log(`    ${projectName}/.env`);
console.log(`    ${projectName}/.gitignore`);
console.log(`    ${projectName}/src/index.ts`);
console.log(`    ${projectName}/AGENTS.md`);
console.log();
console.log(`  Next steps:`);
console.log(`    cd ${projectName}`);
console.log(`    npm install`);
console.log(`    npm start`);
console.log();

// ── Template reader ──────────────────────────────────────────────────────────

function readTemplate(name) {
  const path = join(templatesDir, name);
  if (existsSync(path)) return readFileSync(path, "utf-8");

  // Inline fallbacks if templates aren't found
  if (name === "offchain-agent.ts") return OFFCHAIN_TEMPLATE;
  if (name === "stellar-agent.ts") return STELLAR_TEMPLATE;
  if (name === "celo-agent.ts") return CELO_TEMPLATE;
  return OFFCHAIN_TEMPLATE;
}

// ── Inline templates ─────────────────────────────────────────────────────────

const OFFCHAIN_TEMPLATE = `/**
 * Off-chain AI agent with memory and agentic loop.
 * No blockchain, no wallets — just tools and memory.
 */

import {
  createAgentLoop,
  createMemoryProvider,
  webFetchTool,
  fileWriteTool,
  defineTool,
} from "@calebux/agent-kit";

// Memory persists between runs
const memory = createMemoryProvider({
  type: "markdown",
  vaultPath: "./vault",
});

// Define custom tools
const analyzeTool = defineTool({
  name: "analyze",
  description: "Analyze text and extract key points",
  parameters: { text: "string" },
  execute: async ({ text }) => {
    // Replace with your LLM call
    return \`Key points from \${String(text).length} chars of text...\`;
  },
});

// Agentic loop
const loop = createAgentLoop({
  goal: "Research and summarize a topic",
  tools: [webFetchTool, fileWriteTool, analyzeTool],
  memory,
  maxIterations: 10,
  think: async (goal, history, recalled, toolDesc) => {
    // Plug in your LLM here (GPT, Claude, Llama, etc.)
    if (history.length === 0) {
      return {
        tool: "web_fetch",
        input: { url: "https://example.com" },
        reasoning: "Starting research",
      };
    }
    return { done: true, tool: "", input: {}, reasoning: "Done" };
  },
  onStep: (step) => {
    console.log(\`[\${step.iteration}] \${step.toolName}: \${step.reasoning}\`);
  },
});

async function main() {
  console.log("Starting agent...");
  const result = await loop.run();
  console.log(result.summary);
}

main().catch(console.error);
`;

const STELLAR_TEMPLATE = `/**
 * Stellar on-chain agent with identity, reputation, and x402 payments.
 */

import { EventEmitter } from "events";
import { defineAgent, createOrchestrator, createMemoryProvider } from "@calebux/agent-kit";

const memory = createMemoryProvider({ type: "file", filePath: "./.agent-memory/data.json" });

const agent = defineAgent({
  id: "researcher",
  spendCapXlm: 1,
  run: async (task, { pay, memory }) => {
    const recalled = await memory?.recall("researcher", task);
    if (recalled) return { result: recalled };

    // Use pay() for x402-gated APIs
    // const data = await pay('https://api.example.com/search?q=' + task)
    return { result: \`Researched: \${task}\` };
  },
});

const { run } = createOrchestrator([agent], {
  shieldContractId: process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,
  memory,
});

async function main() {
  const emitter = new EventEmitter();
  emitter.on("log", ({ message }) => console.log(message));
  emitter.on("complete", ({ report }) => console.log("\\n" + report));

  await run("Research the XLM/USDC market", emitter);
}

main().catch(console.error);
`;

const CELO_TEMPLATE = `/**
 * Celo on-chain agent with identity, reputation, and cUSD x402 payments.
 */

import { EventEmitter } from "events";
import { defineAgent, createCeloOrchestrator, createMemoryProvider } from "@calebux/agent-kit";

const memory = createMemoryProvider({ type: "file", filePath: "./.agent-memory/data.json" });

const agent = defineAgent({
  id: "analyst",
  spendCapXlm: 2,
  run: async (task, { pay, memory }) => {
    const recalled = await memory?.recall("analyst", task);
    if (recalled) return { result: recalled };

    // Use pay() for x402-gated APIs (pays in cUSD)
    // const data = await pay('https://api.example.com/analyze?q=' + task)
    return { result: \`Analyzed: \${task}\` };
  },
});

const { run } = createCeloOrchestrator([agent], {
  registryAddress: process.env.CELO_REGISTRY_ADDRESS,
  policyAddress: process.env.CELO_POLICY_ADDRESS,
  adminPrivateKey: process.env.CELO_DEPLOYER_PRIVATE_KEY,
  memory,
});

async function main() {
  const emitter = new EventEmitter();
  emitter.on("log", ({ message }) => console.log(message));
  emitter.on("complete", ({ report }) => console.log("\\n" + report));

  await run("Analyze Celo DeFi TVL", emitter);
}

main().catch(console.error);
`;
