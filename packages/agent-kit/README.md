# @calebux/agent-kit

**Governed multi-agent orchestration on Stellar.**

Build AI agents that pay for data, enforce on-chain spend limits, and earn verifiable reputation — without writing any infrastructure code.

```bash
npm install @calebux/agent-kit
```

---

## What it does

| Feature | Details |
|---|---|
| **Wallet provisioning** | Every agent gets a fresh Stellar keypair, auto-funded via Friendbot on testnet |
| **On-chain spend caps** | Soroban Shield Contract blocks payments that exceed the agent's limit — enforced on-chain, not just in code |
| **x402 payments** | `pay()` probes any URL; if a `402 Payment Required` comes back, it pays in XLM and retries automatically |
| **Verifiable reputation** | Each success/failure is recorded on the Identity Registry (Soroban); scores are readable by anyone |
| **Agent-to-agent payments** | Agents can pay each other in XLM with on-chain memos — real settlement, not mock |
| **Streaming events** | Pass an `EventEmitter` to stream logs, agent status, and results to any UI in real time |

---

## Quick start

```ts
import { defineAgent, createOrchestrator } from '@calebux/agent-kit'

const researcher = defineAgent({
  id: 'researcher',
  spendCapXlm: 1,                     // enforced on-chain by Soroban Shield Contract
  run: async (task, { pay }) => {
    // pay() handles x402 automatically — probe → pay XLM → retry
    const data = await pay<{ summary: string }>('https://my-x402-api.com/search?q=' + task)
    return { result: data.summary }
  }
})

const { run } = createOrchestrator([researcher], {
  shieldContractId:   process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,
})

const report = await run('What is the current XLM price?')
console.log(report)
// {
//   task, report,
//   wallets:    { researcher: 'G...' },   // Stellar public keys
//   spent:      { researcher: 100000 },   // stroops
//   reputation: { researcher: 5250 },     // on-chain score
//   txHashes:   { researcher: ['...'] },  // Stellar tx hashes
// }
```

---

## Multiple agents with decomposition + synthesis

```ts
import Anthropic from '@anthropic-ai/sdk'
import { defineAgent, createOrchestrator } from '@calebux/agent-kit'

const anthropic = new Anthropic()

const webAgent = defineAgent({
  id: 'web',
  spendCapXlm: 2,
  run: async (task, { pay }) => {
    const results = await pay<string[]>('https://search.example.com?q=' + task)
    return { result: results.join('\n') }
  }
})

const onChainAgent = defineAgent({
  id: 'onchain',
  spendCapXlm: 0.5,
  run: async (task, { wallet, pay }) => {
    // wallet is a Stellar Keypair — use it to sign your own transactions
    const stats = await pay('https://my-soroban-api.com/stats')
    return { result: JSON.stringify(stats) }
  }
})

const { run } = createOrchestrator([webAgent, onChainAgent], {
  shieldContractId:   process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,

  // Split the task into per-agent subtasks
  decompose: async (task, agentIds) => {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{ role: 'user', content:
        `Split this task for agents [${agentIds.join(', ')}].
Return JSON: { ${agentIds.map(id => `"${id}": "subtask"`).join(', ')} }
Task: "${task}"` }]
    })
    const text = resp.content[0].type === 'text' ? resp.content[0].text : '{}'
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
  },

  // Synthesize all agent outputs into a final report
  synthesize: async (task, results) => {
    const context = results.map(r => `### ${r.agentId}\n${r.result}`).join('\n\n')
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content:
        `Write a concise report for: "${task}"\n\nFindings:\n${context}` }]
    })
    return resp.content[0].type === 'text' ? resp.content[0].text : context
  }
})

const report = await run('Analyze current DeFi activity on Stellar')
```

---

## Streaming to a UI

Pass any `EventEmitter` to stream real-time progress:

```ts
import { EventEmitter } from 'events'

const emitter = new EventEmitter()

emitter.on('log',          ({ message, level }) => console.log(`[${level}] ${message}`))
emitter.on('agent_status', ({ agent, status, spent, txHashes }) => updateUI(agent, status))
emitter.on('wallets',      (map) => console.log('wallets:', map))
emitter.on('complete',     ({ report, wallets, spent, reputation, txHashes }) => done())
emitter.on('error',        ({ message }) => console.error(message))

await run('my task', emitter)
```

Event reference:

| Event | Payload |
|---|---|
| `log` | `{ message: string, level: "info" \| "success" \| "error" }` |
| `agent_status` | `{ agent, status, spent?, txHashes?, paymentMode? }` |
| `wallets` | `Record<agentId, stellarPublicKey>` |
| `complete` | `{ report, wallets, spent, reputation, txHashes, timestamp }` |
| `error` | `{ message: string }` |

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

// x402 payment helper (probe → pay → retry)
const { data, paymentMode } = await payAndFetch('https://api.example.com/data', keypair, txHashes)

// Direct XLM transfer
const txHash = await submitXlmPayment(fromKeypair, 'G...DEST', '0.5')

// Agent-to-agent payment with on-chain memo
const hash = await agentToAgentPayment(fromKeypair, toAddress, '0.001', 'myapp:agent-a->agent-b')

const rpc = new SorobanRpc.Server('https://soroban-testnet.stellar.org')

// Shield Contract — per-agent spend caps
const shield = new ShieldContract(process.env.SHIELD_CONTRACT_ID!, rpc, adminKeypair)
await shield.registerAgent('my-agent', agentKeypair, 10_000_000n)  // 1 XLM cap
await shield.authorizeSpend('my-agent', 100_000n)                   // blocks if over cap

// Identity Registry — verifiable reputation
const registry = new IdentityRegistry(process.env.REGISTRY_CONTRACT_ID!, rpc, adminKeypair)
await registry.registerAgent('my-agent', 'My Agent', 'research')
await registry.recordSuccess('my-agent', agentKeypair)
const score = await registry.getReputation('my-agent')              // number | null
```

---

## Deploy your own contracts

The Soroban contracts (Shield + Identity Registry) live in the [Aegis repo](https://github.com/Calebux/Aegis).

```bash
git clone https://github.com/Calebux/Aegis
cd Aegis
bash contracts/deploy.sh
```

Public testnet deployments (Stellar testnet):

| Contract | ID |
|---|---|
| Shield Contract | `CDD4J3B3Y44SDUKZQYEU2XPS4KBGAMLUQEWVSR2I25GXFGAQ6KD453N5` |
| Identity Registry | `CD5SGG7E6GIZPCGSOAKLCKRF5RRNZ3462MX4RQDT3NE6BD74GVAOMHET` |

---

## Environment variables

| Variable | Description |
|---|---|
| `STELLAR_NETWORK` | `testnet` (default) or `futurenet` |
| `STELLAR_HORIZON_URL` | Horizon endpoint (default: testnet) |
| `STELLAR_RPC_URL` | Soroban RPC endpoint (default: testnet) |
| `SHIELD_CONTRACT_ID` | Shield Contract address |
| `REGISTRY_CONTRACT_ID` | Identity Registry address |
| `ORCHESTRATOR_SECRET_KEY` | Admin keypair for on-chain registration |

All contract options are optional — omit them to run in dev mode with no on-chain enforcement.

---

## Reference implementation

[Aegis](https://github.com/Calebux/Aegis) is the full reference implementation: four specialized agents (Scout, Ledger, Signal, Scribe), a live x402 payment server, agent-to-agent payments, and a Next.js dashboard — all built on `@calebux/agent-kit`.

---

## License

MIT
