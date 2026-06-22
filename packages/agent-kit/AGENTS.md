# @calagent/agent-kit — AI Agent Infrastructure SDK

> Use this guide when helping developers build AI agents with memory, loops, tools, orchestration, or on-chain capabilities.

## What this package does

`@calagent/agent-kit` is a TypeScript SDK for building AI agents that:
- **Remember** — persistent memory via Obsidian/markdown vaults, JSON files, or gBrain knowledge graphs
- **Reason autonomously** — think→act→observe agentic loops with configurable LLMs and tool-use
- **Use tools** — built-in tools (web fetch, file I/O, shell, grep) plus a `defineTool()` API for custom tools
- **Orchestrate pipelines** — multi-agent coordination with task decomposition and synthesis
- **Pay each other** — x402 micropayments on Celo (cUSD) and Stellar (XLM)
- **Own identity** — on-chain reputation, verifiable receipts, spend-cap enforcement

## Install

```bash
npm install @calagent/agent-kit
```

## Quick patterns

### Off-chain agent with memory (no blockchain needed)

```ts
import { createAgentLoop, createMemoryProvider, webFetchTool, defineTool } from '@calagent/agent-kit'

const memory = createMemoryProvider({ type: 'markdown', vaultPath: './vault' })

const loop = createAgentLoop({
  goal: 'Research topic X',
  tools: [webFetchTool],
  memory,
  maxIterations: 10,
  think: async (goal, history, recalled, toolDesc) => {
    // Your LLM decides next action — works with GPT, Claude, Llama, etc.
    return { tool: 'web_fetch', input: { url: '...' }, reasoning: '...' }
  },
})

const result = await loop.run()
```

### Custom tool

```ts
const myTool = defineTool({
  name: 'analyze',
  description: 'Analyze data and return insights',
  parameters: { data: 'string' },
  execute: async ({ data }) => 'Analysis result...',
})
```

### OpenAI function-calling format

```ts
import { toOpenAIFunctions, webFetchTool, fileWriteTool } from '@calagent/agent-kit'

const functions = toOpenAIFunctions([webFetchTool, fileWriteTool])
// Pass to openai.chat.completions.create({ functions })
```

### On-chain orchestrator (Stellar)

```ts
import { defineAgent, createOrchestrator } from '@calagent/agent-kit'

const agent = defineAgent({
  id: 'researcher',
  spendCapXlm: 1,
  run: async (task, { pay }) => {
    const data = await pay('https://x402-api.com/search?q=' + task)
    return { result: JSON.stringify(data) }
  },
})

const { run } = createOrchestrator([agent], {
  shieldContractId: process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,
})
```

### On-chain orchestrator (Celo)

```ts
import { defineAgent, createCeloOrchestrator } from '@calagent/agent-kit'

const { run } = createCeloOrchestrator([agent], {
  registryAddress: process.env.CELO_REGISTRY_ADDRESS,
  policyAddress: process.env.CELO_POLICY_ADDRESS,
  adminPrivateKey: process.env.CELO_DEPLOYER_PRIVATE_KEY,
})
```

### Memory providers

```ts
// Obsidian markdown vault
createMemoryProvider({ type: 'markdown', vaultPath: './vault' })

// JSON file
createMemoryProvider({ type: 'file', filePath: './memory.json' })

// In-memory (testing)
createMemoryProvider({ type: 'memory' })

// gBrain knowledge graph (MCP)
createMemoryProvider({ type: 'gbrain', gbrain: { url: 'http://localhost:3100' } })
```

## Key exports

| Export | Purpose |
|--------|---------|
| `createAgentLoop` | Autonomous think→act→observe cycle |
| `defineTool`, `createToolkit` | Tool definition and management |
| `webFetchTool`, `fileReadTool`, `fileWriteTool`, `shellTool`, `grepTool` | Built-in tools |
| `toOpenAIFunctions` | Export tools in OpenAI function-calling format |
| `createMemoryProvider`, `MarkdownMemoryProvider`, `FileMemoryProvider` | Memory backends |
| `defineAgent`, `createOrchestrator` | Stellar multi-agent pipeline |
| `createCeloOrchestrator` | Celo multi-agent pipeline |
| `createAutomation` | Cron-scheduled agent tasks |
| `payAndFetch`, `payAndFetchCelo` | x402 payment helpers |
| `ShieldContract`, `IdentityRegistry` | Stellar contract wrappers |
| `CeloIdentityRegistry`, `CeloPolicyManager` | Celo contract wrappers |
| `createRunReceipt`, `verifyRunReceipt` | Verifiable run receipts |
| `AgentRouter` | Capability-based agent routing |
| `ApprovalGateway` | Human-in-the-loop approval |
| `calculateTrustScore` | Multi-factor trust scoring |

## Architecture

The SDK is layered — use only what you need:

1. **Tools + Loops** — off-chain, no blockchain (`createAgentLoop`, `defineTool`)
2. **Memory** — persistent agent memory (`MarkdownMemoryProvider`, `FileMemoryProvider`)
3. **Orchestration** — multi-agent coordination (`createOrchestrator`, `createCeloOrchestrator`)
4. **Payments** — x402 micropayments (`payAndFetch`, `payAndFetchCelo`)
5. **On-chain** — identity, reputation, governance (contract wrappers)

Each layer is independent. You can use memory + loops without touching blockchain.
