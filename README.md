# Aegis

**Agent execution and trust infrastructure for Stellar**

Built for the [Stellar Hacks: Agents](https://dorahacks.io) hackathon on DoraHacks.

## Overview

Aegis is a multi-agent orchestration framework and infrastructure layer where a master orchestrator decomposes high-level tasks into specialized sub-agents — each with its own Stellar testnet wallet, spend cap enforced on-chain by a **Soroban Shield Contract**, and reputation tracked by an **Identity Registry**. Agents pay for external services using the x402 payment protocol over Stellar testnet, and settle agent-to-agent micropayments after every task.

The long-term direction is to make Aegis the agent execution and trust layer for Stellar: wallets, policies, payments, discovery, identity, reputation, and verifiable agent actions. The dashboard is the reference app; `@calebux/agent-kit` is the reusable developer surface.

Aegis is also being extended as portable agent infrastructure. Stellar remains
the first deep integration; Celo is the first EVM/stablecoin adapter for grants,
stablecoin payments, and agent infrastructure on Celo.

**What makes Aegis different from every other agent hack:**

1. **Full-stack x402 on Stellar** — Aegis is simultaneously an x402 *provider* (running its own paywall server) and an x402 *consumer* (paying for queries from within the agent pipeline). Most entries pick one side.
2. **On-chain spend governance** — the Shield Contract blocks any agent from overspending before the transaction ever hits the network. Guardrails are not a config file; they are a deployed Soroban contract.
3. **Agent-to-agent payments** — Scribe pays Scout 0.001 XLM after every synthesis, logged on-chain with a memo (`aegis:scribe->scout`). Agents have financial relationships with each other, not just with external APIs.
4. **Live reputation** — the Identity Registry increments each agent's reputation score on-chain after every successful task, making trustworthiness a first-class, verifiable property.
5. **Discoverable agent manifests** — agents can declare capabilities, endpoints, payment protocols, accepted assets, and policy constraints through a portable SDK manifest model.
6. **Verifiable run receipts** — every dashboard run can emit a receipt with task/output hashes, agent wallets, payment tx hashes, reputation snapshots, policy contract IDs, and an optional Stellar signature.

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
| **x402 Consumer** | `ledger.ts` | Uses Aegis's Stellar payment helper to handle 402 responses, sign a Stellar payment, and retry the request |

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
- **Payments**: x402-style protocol on Stellar testnet with custom Express 402 challenges and Stellar payment receipts
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

### Agent infrastructure primitives

`@calebux/agent-kit` also exposes portable agent manifests and discovery helpers:

```ts
import { createAgentManifest, discoverAgents } from '@calebux/agent-kit'

const manifest = createAgentManifest(researcher, {
  walletAddress: 'G...',
  payments: [{ protocol: 'x402', network: 'stellar:testnet', asset: 'USDC' }],
})

const agents = discoverAgents([manifest], {
  capability: 'research',
  protocol: 'x402',
  asset: 'USDC',
})
```

The dashboard publishes those manifests at `GET /api/agents`. Each manifest
points to a callable endpoint at `POST /api/agents/:id/run` that returns either
a Stellar USDC x402 `402 Payment Required` challenge or a verifiable
`aegis.receipt.v1` run receipt.

External agent x402 environment:

| Variable | Purpose |
|---|---|
| `AEGIS_AGENT_PRICE_USDC` | Default per-agent USDC price, defaults to `0.001` |
| `AEGIS_X402_STELLAR_NETWORK` | x402 settlement network, defaults to `testnet` |
| `AEGIS_X402_RECEIVER` | Stellar account that should receive USDC payments |
| `STELLAR_USDC_CONTRACT_ID` | SEP-41 USDC asset contract for x402 settlement |
| `STELLAR_USDC_ISSUER` | USDC issuer override; defaults to Stellar testnet USDC |
| `AEGIS_X402_ENFORCE` | Set `true` to require payment headers before running |
| `AEGIS_X402_FACILITATOR_URL` | Facilitator URL used for `/verify` and `/settle` |
| `AEGIS_X402_FACILITATOR_API_KEY` | Optional bearer token for the facilitator |
| `AEGIS_X402_DEV_ACCEPT` | Set `false` to reject payment headers without facilitator verification |
| `AEGIS_STORAGE_DIR` | Directory for persisted tasks, receipts, and receipt outputs in production |

See [docs/agentic-infrastructure-roadmap.md](./docs/agentic-infrastructure-roadmap.md) for the infrastructure roadmap and [docs/discoverability-playbook.md](./docs/discoverability-playbook.md) for the indexing/distribution checklist. LLM-oriented project context is available in [llms.txt](./llms.txt).

### Verifiable receipts

The dashboard exposes machine-readable receipts:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Deployment readiness, x402 config, contract pointers |
| `GET /api/openapi.json` | OpenAPI spec for the public agent API |
| `GET /agents` | Visual agent registry page |
| `GET /api/agents` | Machine-readable agent manifests for discovery |
| `POST /api/agents/:id/run` | Call a single x402-compatible external agent |
| `GET /receipts` | Visual receipt index page |
| `GET /api/receipts` | List run receipts |
| `GET /api/receipts/:id` | Fetch a receipt and verification result |
| `GET /api/receipts/:id/verify` | Verify only |
| `GET /api/tasks/:id` | Fetch task/subtask status |
| `GET /api/tasks/:id/receipt` | Fetch a receipt by dashboard task ID |

### MCP setup

Build the MCP server:

```bash
npm run build --workspace=packages/aegis-mcp-stellar
```

Example MCP config:

```json
{
  "mcpServers": {
    "aegis-stellar": {
      "command": "node",
      "args": ["packages/aegis-mcp-stellar/dist/index.js"],
      "env": {
        "AEGIS_BASE_URL": "http://localhost:3000",
        "AEGIS_AGENTS_URL": "http://localhost:3000/api/agents"
      }
    }
  }
}
```

Primary tool flow:

```text
discover_agents -> call_external_agent -> get_run_receipt -> verify_run_receipt
```

Generate a local proof receipt with the dashboard running:

```bash
npm run demo:receipt -- "Analyze Stellar DeFi agents and policy-controlled payments"
```

Run the Foundation-facing API demo with the dashboard running:

```bash
npm run demo:foundation -- "Show me the current Stellar network state"
```

Run the API smoke test with the dashboard running:

```bash
npm run smoke:api
```

Run the example x402-aware agent client:

```bash
npm run example:x402-agent -- celo "Read the Celo network state"
```

If payment enforcement is enabled, the script prints the `PAYMENT-REQUIRED`
challenge. Create a payment with an x402-compatible wallet/client and rerun with:

```bash
PAYMENT_SIGNATURE=... npm run example:x402-agent -- celo
```

Publish manifest hashes to the Identity Registry after `REGISTRY_CONTRACT_ID`,
`ORCHESTRATOR_SECRET_KEY`, and `AEGIS_AGENTS_URL` are configured:

```bash
npm run publish:manifest-hashes
```

### Celo adapter

Celo manifests are published from the same discovery endpoint:

```bash
curl "http://localhost:3000/api/agents?chain=celo"
```

Local Celo pieces:

| Path | Purpose |
|---|---|
| `packages/aegis-chain-celo` | Celo manifest constants/helpers |
| `contracts/celo/src/AegisCeloRegistry.sol` | EVM identity + manifest hash registry |
| `contracts/celo/src/AegisCeloPolicy.sol` | EVM spend/session policy contract |

Celo environment:

| Variable | Purpose |
|---|---|
| `AEGIS_CELO_NETWORK` | `alfajores` by default; set `mainnet` for Celo mainnet |
| `CELO_RPC_URL` | Celo JSON-RPC endpoint |
| `AEGIS_CELO_ASSET` | Stable asset label, defaults to `cUSD` |
| `AEGIS_CELO_ASSET_CONTRACT` | ERC-20 settlement asset contract |
| `AEGIS_CELO_X402_RECEIVER` | Celo address receiving x402 stablecoin payments |
| `AEGIS_CELO_X402_FACILITATOR_URL` | Celo/EVM x402 facilitator URL for `/verify` and `/settle` |
| `CELO_DEPLOYER_PRIVATE_KEY` | Private key used to deploy/publish Celo registry data |
| `CELO_REGISTRY_ADDRESS` | Deployed `AegisCeloRegistry` address |
| `CELO_POLICY_ADDRESS` | Deployed `AegisCeloPolicy` address |

Deploy the Celo contracts with Foundry:

```bash
npm run deploy:celo-contracts
```

Run the Celo contract tests:

```bash
cd contracts/celo
forge test
```

Publish Celo manifest hashes after the dashboard is live and
`CELO_REGISTRY_ADDRESS` is configured:

```bash
npm run publish:celo-manifest-hashes
```

---

## License

MIT
