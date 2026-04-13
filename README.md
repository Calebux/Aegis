# Aegis

**Soroban-governed multi-agent system on Stellar**

Built for the [Stellar Hacks: Agents](https://dorahacks.io) hackathon on DoraHacks.

## Overview

Aegis is a multi-agent orchestration framework where a master orchestrator decomposes high-level tasks into specialized sub-agents — each with its own Stellar testnet wallet, spend cap enforced on-chain by a **Soroban Shield Contract**, and reputation tracked by an **Identity Registry**. Agents pay for external services using the x402 payment protocol over Stellar testnet, and settle agent-to-agent micropayments after every task.

**What makes Aegis different from every other agent hack:**

1. **Full-stack x402 on Stellar** — Aegis is simultaneously an x402 *provider* (running its own paywall server) and an x402 *consumer* (paying for queries from within the agent pipeline). Most entries pick one side.
2. **On-chain spend governance** — the Shield Contract blocks any agent from overspending before the transaction ever hits the network. Guardrails are not a config file; they are a deployed Soroban contract.
3. **Agent-to-agent payments** — Scribe pays Scout 0.001 XLM after every synthesis, logged on-chain with a memo (`aegis:scribe->scout`). Agents have financial relationships with each other, not just with external APIs.
4. **Live reputation** — the Identity Registry increments each agent's reputation score on-chain after every successful task, making trustworthiness a first-class, verifiable property.

## Architecture

```
                        ┌─────────────────────┐
                        │  Master Orchestrator │
                        │   (TypeScript)       │
                        └────────┬────────────┘
                                 │ decomposes task
               ┌─────────────────┼──────────────────────┐
               │                 │                       │
        ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
        │    Scout    │  │   Ledger    │  │   Signal    │  │    Scribe   │
        │  (Search)   │  │ (Horizon)   │  │ (Analytics) │  │  (Reports)  │
        └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
               │                 │ x402 pay               │                 │
               │          ┌──────▼──────┐            │                 │
               │          │  Horizon    │            │                 │
               │          │ x402 Server │            │                 │
               │          │  (port 3001)│            │                 │
               │          └──────┬──────┘            │                 │
               │                 │ proxies           │                 │
               │          ┌──────▼──────┐            │                 │
               │          │  Stellar    │            │                 │
               │          │  Horizon    │            │                 │
               │          │  Testnet    │            │                 │
               │          └─────────────┘            │                 │
               └─────────────────┴────────────────┴─────────────────┘
                                          │
                              ┌───────────▼───────────┐
                              │    Soroban Contracts   │
                              │  Shield Contract       │
                              │  Identity Registry     │
                              └───────────────────────┘
```

## x402 Dual Role — What Makes Aegis Unique

Most x402 integrations are one-sided: a client that pays for external APIs.
Aegis operates on **both sides of the protocol simultaneously**:

| Role | Component | What it does |
|------|-----------|--------------|
| **x402 Provider** | `horizon-x402-server.ts` | Wraps Stellar Horizon behind a paywall; returns 402 if no valid payment header is present |
| **x402 Consumer** | `ledger.ts` | Uses `@x402/axios` to automatically handle 402 responses, sign a Stellar payment, and retry the request |

The Ledger agent pays the Horizon x402 server **$0.001 per query** for:
- `GET /network-stats` — latest ledger, base fee, transaction count
- `GET /account/:address` — account balances and recent transactions

Every payment is logged server-side:
```
💰 Payment received: 0.001 XLM from G...SCOUT_ADDRESS
```

The Ledger agent also demonstrates **cross-agent awareness**: it fetches the Scout agent's on-chain account as one of its data points, showing that Aegis agents can reason about each other's Stellar state.

## Sub-Agents

| Agent  | Role | Tool |
|--------|------|------|
| **Scout** | Web search & research | Linkup x402-native search SDK |
| **Ledger** | Stellar on-chain data | Local Horizon x402 server (pays per query) |
| **Signal** | Market signals & analytics | External data APIs via x402 |
| **Scribe** | Report synthesis | Claude API (Anthropic) |

## Soroban Contracts

Deployed on **Stellar testnet** (not futurenet).

| Contract | ID | Purpose |
|----------|----|---------|
| **Shield Contract** | `CDD4J3B3Y44SDUKZQYEU2XPS4KBGAMLUQEWVSR2I25GXFGAQ6KD453N5` | Enforces per-agent spend caps — `authorize_spend` is called before every external request |
| **Identity Registry** | `CD5SGG7E6GIZPCGSOAKLCKRF5RRNZ3462MX4RQDT3NE6BD74GVAOMHET` | Tracks agent reputation — `record_success` / `record_failure` updates scores after each task |

Admin: `GDSUBJ4J6V4DR7B3UZ7IETLM7TPF23BXEZ7U4KTHQPSHXM3HACV2HWIC`

## Monorepo Structure

```
aegis/
├── contracts/              # Soroban smart contracts (Rust)
│   ├── shield-contract/    # Spend cap enforcement per agent
│   └── identity-registry/  # Agent identity & reputation
├── packages/
│   ├── orchestrator/       # Master orchestrator (TypeScript)
│   │   └── src/
│   │       ├── agents/     # Scout, Ledger, Signal, Scribe sub-agents
│   │       └── services/   # horizon-x402-server.ts (x402 provider)
│   ├── agents/             # Standalone agent processes
│   └── shared/             # Shared types, Stellar helpers, x402 utils
└── apps/
    └── dashboard/          # Next.js live dashboard
```

## Tech Stack

- **Smart Contracts**: Soroban (Rust) on Stellar testnet
- **Orchestrator & Agents**: TypeScript (Node.js)
- **Payments**: x402 protocol on Stellar testnet (`@x402/express` + `@x402/axios`)
- **Dashboard**: Next.js 14 (App Router)
- **Search**: Linkup x402-native search SDK
- **AI Synthesis**: Anthropic Claude API

## Getting Started

### Prerequisites

- Node.js >= 20
- Rust + `cargo`
- Stellar CLI (`stellar`)
- A Stellar testnet account funded via [Friendbot](https://friendbot.stellar.org)

### Install

```bash
npm install
```

### Build Contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

### Run Horizon x402 Server (in a separate terminal)

```bash
# Set the wallet that will receive payments
export HORIZON_WALLET_ADDRESS=G...YOUR_ADDRESS

npm run dev:horizon --workspace=packages/orchestrator
# Listening on http://localhost:3001
# GET /network-stats   → $0.001
# GET /account/:address → $0.001
```

### Run Orchestrator (dev)

```bash
npm run dev --workspace=packages/orchestrator
```

### Run Dashboard

```bash
npm run dev --workspace=apps/dashboard
```

## Environment Variables

```bash
cp .env.example .env
# then fill in the three required keys
```

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API — task decomposition + Scribe synthesis. [Get one](https://console.anthropic.com) |
| `LINKUP_API_KEY` | ✅ | Linkup search — Scout's web research tool. [Get one](https://app.linkup.so) |
| `ORCHESTRATOR_SECRET_KEY` | ✅ | Stellar admin secret key — registers agents on-chain |
| `SHIELD_CONTRACT_ID` | pre-filled | Soroban Shield Contract (testnet) |
| `REGISTRY_CONTRACT_ID` | pre-filled | Soroban Identity Registry (testnet) |
| `HORIZON_PAYMENT_RECEIVER` | optional | Stellar address for x402 payments — leave blank for dev mode |

All other variables default correctly for Stellar testnet. Agent wallets (`SCOUT_SECRET_KEY`, etc.) are auto-provisioned at runtime.

---

## @calebux/agent-kit

The orchestration layer has been extracted as a standalone npm package so anyone can build governed multi-agent systems on Stellar:

```bash
npm install @calebux/agent-kit
```

```ts
import { defineAgent, createOrchestrator } from '@calebux/agent-kit'

const researcher = defineAgent({
  id: 'researcher',
  spendCapXlm: 1,                        // enforced by Soroban Shield Contract
  run: async (task, { pay }) => {
    const data = await pay('https://my-x402-api.com/search?q=' + task)
    return { result: JSON.stringify(data) }
  }
})

const { run } = createOrchestrator([researcher], {
  shieldContractId:   process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,
})

const report = await run('What is happening in Stellar DeFi right now?')
// report.wallets     → agentId → Stellar public key
// report.spent       → agentId → stroops spent
// report.reputation  → agentId → on-chain score
// report.txHashes    → agentId → Stellar tx hashes
```

Full docs: [npmjs.com/package/@calebux/agent-kit](https://www.npmjs.com/package/@calebux/agent-kit)

---

## License

MIT
