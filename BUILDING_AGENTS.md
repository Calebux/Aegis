# Building Agents with @calebux/agent-kit

`@calebux/agent-kit` is the governed multi-agent framework extracted from Aegis.
It handles the infrastructure so you can focus on agent logic:

- Each agent gets a **fresh Stellar testnet wallet**, auto-funded via Friendbot
- Agents are registered on the **Soroban Shield Contract** (on-chain spend cap enforcement)
- Success/failure is recorded on the **Identity Registry** (verifiable reputation)
- The injected `pay()` helper handles **x402 payments** automatically

---

## Install

```bash
npm install @calebux/agent-kit
```

Or inside this monorepo, add `"@calebux/agent-kit": "*"` to your `package.json`.

---

## Minimal example

```ts
import { defineAgent, createOrchestrator } from '@calebux/agent-kit'

// 1. Define your agents
const researcher = defineAgent({
  id: 'researcher',
  spendCapXlm: 1,                         // max 1 XLM spend, enforced on-chain
  run: async (task, { pay, txHashes }) => {
    // pay() probes the URL; if a 402 comes back it pays via Stellar and retries
    const data = await pay<{ summary: string }>('https://my-x402-api.com/search?q=' + task)
    return {
      result: data.summary,
      spentStroops: 100_000n,             // 0.01 XLM
    }
  }
})

// 2. Create the orchestrator
const { run } = createOrchestrator([researcher], {
  shieldContractId:   process.env.SHIELD_CONTRACT_ID,    // optional
  registryContractId: process.env.REGISTRY_CONTRACT_ID,  // optional
})

// 3. Run
const report = await run('What is the current XLM price?')
console.log(report.report)
// {
//   task, subtasks, results, report,
//   wallets,     // agentId → Stellar public key
//   spent,       // agentId → stroops spent
//   reputation,  // agentId → on-chain score
//   txHashes,    // agentId → Stellar tx hashes
//   timestamp
// }
```

---

## Multiple agents with custom decomposition + synthesis

```ts
import Anthropic from '@anthropic-ai/sdk'
import { defineAgent, createOrchestrator } from '@calebux/agent-kit'

const anthropic = new Anthropic()

const webResearcher = defineAgent({
  id: 'web',
  spendCapXlm: 2,
  run: async (task, { pay }) => {
    const results = await pay<string[]>('https://search.example.com?q=' + task)
    return { result: results.join('\n') }
  }
})

const onChainAnalyst = defineAgent({
  id: 'onchain',
  spendCapXlm: 0.5,
  run: async (task, { wallet, pay }) => {
    // wallet is a Stellar Keypair — use it to sign transactions
    const stats = await pay('http://localhost:3001/network-stats')
    return { result: JSON.stringify(stats) }
  }
})

const { run } = createOrchestrator([webResearcher, onChainAnalyst], {
  shieldContractId:   process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,

  // Optional: split the task into per-agent subtasks
  decompose: async (task, agentIds) => {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Split this task into subtasks for agents ${agentIds.join(', ')}.
Return JSON: { ${agentIds.map(id => `"${id}": "subtask"`).join(', ')} }
Task: "${task}"`,
      }]
    })
    const text = resp.content[0].type === 'text' ? resp.content[0].text : '{}'
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
  },

  // Optional: synthesize agent outputs into a final report
  synthesize: async (task, results) => {
    const context = results.map(r => `### ${r.agentId}\n${r.result}`).join('\n\n')
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Write a concise report for: "${task}"\n\nAgent findings:\n${context}`,
      }]
    })
    return resp.content[0].type === 'text' ? resp.content[0].text : context
  }
})

const report = await run('Analyze current DeFi activity on Stellar')
```

---

## Streaming progress via EventEmitter

```ts
import { EventEmitter } from 'events'

const emitter = new EventEmitter()

emitter.on('log',          ({ message, level }) => console.log(`[${level}] ${message}`))
emitter.on('agent_status', ({ agent, status, spent, txHashes }) => { /* update UI */ })
emitter.on('wallets',      (map) => { /* agentId → publicKey */ })
emitter.on('complete',     ({ report, wallets, spent, reputation, txHashes }) => { /* done */ })
emitter.on('error',        ({ message }) => console.error(message))

await run('my task', emitter)
```

---

## Low-level utilities

```ts
import {
  payAndFetch,
  submitXlmPayment,
  agentToAgentPayment,
  ShieldContract,
  IdentityRegistry,
} from '@calebux/agent-kit'
import { SorobanRpc, Keypair } from '@stellar/stellar-sdk'

// x402 payment
const { data, paymentMode } = await payAndFetch('https://api.example.com/data', keypair, txHashes)

// Direct XLM payment
const txHash = await submitXlmPayment(fromKeypair, 'G...DEST', '0.5')

// Agent-to-agent payment with memo
const hash = await agentToAgentPayment(fromKeypair, toAddress, '0.001', 'myapp:agent-a->agent-b')

// Soroban contracts
const rpc = new SorobanRpc.Server('https://soroban-testnet.stellar.org')
const shield = new ShieldContract(process.env.SHIELD_CONTRACT_ID!, rpc, adminKeypair)
await shield.registerAgent('my-agent', agentKeypair, 10_000_000n)  // 1 XLM cap

const registry = new IdentityRegistry(process.env.REGISTRY_CONTRACT_ID!, rpc, adminKeypair)
await registry.registerAgent('my-agent', 'My Agent', 'custom')
await registry.recordSuccess('my-agent', agentKeypair)
```

---

## Environment variables

| Variable | Description |
|---|---|
| `STELLAR_NETWORK` | `testnet` (default) |
| `STELLAR_HORIZON_URL` | Horizon endpoint |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `SHIELD_CONTRACT_ID` | Deployed Shield Contract (see `contracts/deploy.sh`) |
| `REGISTRY_CONTRACT_ID` | Deployed Identity Registry |
| `ORCHESTRATOR_SECRET_KEY` | Admin key for on-chain registration |

Deploy the contracts to your own Stellar testnet account:

```bash
bash contracts/deploy.sh
```

---

## Aegis is the reference implementation

The Aegis orchestrator (`packages/orchestrator`) is built entirely on top of
`@calebux/agent-kit`. If you want to see a full real-world example with four
specialized agents (Scout, Ledger, Signal, Scribe), x402 dual-role
(provider + consumer), and a live Next.js dashboard, read the source there.
