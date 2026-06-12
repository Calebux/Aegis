# Aegis

**Multi-chain agent execution and trust infrastructure**

Aegis is a multi-agent orchestration framework where a master orchestrator decomposes tasks into specialized sub-agents — each with its own wallet, on-chain spend caps, verifiable reputation, and x402 payment gating. Agents pay for external services, settle micropayments with each other, and produce cryptographically signed run receipts.

Currently live on **Celo mainnet** and **Stellar testnet**.

```bash
npm install @calebux/agent-kit
```

---

## Celo — Live on Mainnet

Aegis deploys a full agent infrastructure on Celo: identity registry, policy enforcement, stablecoin payments, Mento oracle integration, and verifiable attestations — all on mainnet.

### Deployed Contracts

| Contract | Address | Purpose |
|---|---|---|
| **AegisCeloRegistry** | [`0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C`](https://celoscan.io/address/0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C) | Agent identity, manifest hashes, on-chain reputation |
| **AegisCeloPolicy** | [`0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c`](https://celoscan.io/address/0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c) | Per-agent spend caps and session management |

### Celo Agents

| Agent | Capabilities | What it does |
|---|---|---|
| **celo-ledger** | `celo`, `onchain-data`, `stablecoins`, `rpc` | Live Celo RPC reads — block height, gas price, chain ID |
| **celo-notary** | `celo`, `attestation`, `execution`, `proof` | On-chain attestation writes to AegisCeloRegistry |
| **celo-defi** | `celo`, `defi`, `stablecoins`, `mento`, `oracles` | Mento SortedOracles: live cUSD/cEUR/cREAL exchange rates |
| **celo-price** | `celo`, `price`, `market-data` | CELO token price via CoinGecko in a verifiable receipt |

### Celo Pipeline

The Celo pipeline mirrors the Stellar pipeline architecture:

```
Prompt → Celo Scout (web research) + Celo Ledger (on-chain data)
       → Celo Signal (market analytics, 3-source averaging)
       → Consensus Manager (reconciliation, validator if confidence < 0.7)
       → Celo Scribe (final report synthesis via Claude)
       → Celo Notary (SHA-256 → AegisCeloRegistry attestation on mainnet)
```

Run the Celo pipeline:

```bash
# POST with chain: "celo"
curl -X POST http://localhost:3000/api/run \
  -H "Content-Type: application/json" \
  -d '{"task":"What is the current state of the Celo ecosystem?","chain":"celo"}'
```

### Celo x402 Payments

Agents are gated behind x402 with **cUSD** as the settlement asset:

```bash
# Discover Celo agents
curl "http://localhost:3000/api/agents?chain=celo"

# Call a single agent (returns receipt + optional 402 challenge)
curl -X POST http://localhost:3000/api/agents/celo-defi/run \
  -H "Content-Type: application/json" \
  -d '{"task":"Get Mento stablecoin exchange rates"}'
```

### Celo SDK

```ts
import {
  CeloIdentityRegistry,
  CeloPolicyManager,
  payAndFetchCelo,
  submitCusdPayment,
  celoAgentToAgentPayment,
} from '@calebux/agent-kit'

const registry = new CeloIdentityRegistry(
  '0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C',
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

await registry.registerAgent('my-agent', 'My Agent', 'research')
await registry.recordSuccess('my-agent')
const rep = await registry.getReputation('my-agent')
```

### Celo Environment

| Variable | Purpose |
|---|---|
| `AEGIS_CELO_NETWORK` | `mainnet` or `alfajores` |
| `CELO_RPC_URL` | Celo JSON-RPC endpoint |
| `CELO_REGISTRY_ADDRESS` | AegisCeloRegistry address |
| `CELO_POLICY_ADDRESS` | AegisCeloPolicy address |
| `CELO_DEPLOYER_PRIVATE_KEY` | Admin key for registry/policy writes |
| `AEGIS_CELO_X402_RECEIVER` | Celo address receiving x402 cUSD payments |
| `AEGIS_CELO_X402_FACILITATOR_URL` | Celo/EVM x402 facilitator |

### Celo Contracts (Foundry)

```bash
# Deploy
cd contracts/celo && bash deploy.sh

# Test
cd contracts/celo && forge test

# Publish manifest hashes (dashboard must be running)
npm run publish:celo-manifest-hashes
```

---

## Stellar — Testnet

Aegis's original chain integration. Full Soroban contract suite with x402 payment protocol.

### Deployed Contracts (Stellar Testnet)

| Contract | ID | Purpose |
|---|---|---|
| **Shield Contract** | `CDGVUNE47FXSG6KJATMZB3MFTE7UJFBMUKNFK7FWZRAHPG5BUGBFV2RS` | Per-agent spend cap enforcement |
| **Identity Registry** | `CBQV3JXYZS7ABOTLCYZM6U4LUEF7PTIUXV76QAPHYAACERXHROVTT2YM` | Agent identity and reputation |

Admin: `GDSUBJ4J6V4DR7B3UZ7IETLM7TPF23BXEZ7U4KTHQPSHXM3HACV2HWIC`

### Stellar Agents

| Agent | Role | Tool |
|---|---|---|
| **Scout** | Web search and research | Linkup x402-native search SDK |
| **Ledger** | Stellar on-chain data | Local Horizon x402 server (pays per query) |
| **Signal** | Market signals and analytics | External data APIs via x402 |
| **Scribe** | Report synthesis | Claude API (Anthropic) |
| **Notary** | Consensus attestation | SHA-256 → Soroban Shield Contract + DEX settlement |

### x402 Dual Role

Aegis operates on **both sides of x402 simultaneously**:

| Role | Component | What it does |
|---|---|---|
| **Provider** | `horizon-x402-server.ts` | Wraps Stellar Horizon behind a paywall; returns 402 if no valid payment |
| **Consumer** | `ledger.ts` | Handles 402 responses, signs Stellar payment, retries |

Agent-to-agent payments: Scribe pays Scout 0.001 XLM per synthesis (`aegis:scribe->scout`).

### Stellar Environment

| Variable | Purpose |
|---|---|
| `STELLAR_NETWORK` | `testnet` (default) |
| `STELLAR_HORIZON_URL` | Horizon endpoint |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `SHIELD_CONTRACT_ID` | Shield Contract address |
| `REGISTRY_CONTRACT_ID` | Identity Registry address |
| `ORCHESTRATOR_SECRET_KEY` | Admin keypair for on-chain registration |
| `HORIZON_PAYMENT_RECEIVER` | Stellar address for x402 payments (blank = dev mode) |

---

## What Makes Aegis Different

1. **Multi-chain from day one** — same agent architecture on Celo (EVM/cUSD) and Stellar (Soroban/XLM)
2. **Full-stack x402** — simultaneously an x402 provider and consumer on both chains
3. **On-chain spend governance** — Shield Contract (Stellar) and AegisCeloPolicy (Celo) enforce caps before transactions hit the network
4. **Agent-to-agent payments** — agents have financial relationships with each other, settled on-chain
5. **Live reputation** — Identity Registry increments scores on-chain after every task
6. **Verifiable run receipts** — every run produces `aegis.receipt.v1` with task/output hashes, payment txs, Ed25519 signature
7. **Discoverable manifests** — agents declare capabilities, endpoints, payment terms via portable SDK manifests

---

## Monorepo Structure

```
aegis/
├── apps/dashboard/              Next.js 14 App Router — live dashboard + public agent API
├── packages/
│   ├── orchestrator/            Master pipeline (Scout→Ledger→Signal→Scribe→Notary)
│   ├── agent-kit/               @calebux/agent-kit — reusable SDK
│   ├── agents/                  Standalone agent processes / x402 servers
│   ├── shared/                  Shared types
│   ├── aegis-chain-celo/        Celo/viem helpers, registry ABI
│   └── aegis-mcp-stellar/       MCP server wrapping the public agent API
├── contracts/
│   ├── identity-registry/       Soroban — agent identity + reputation (Rust)
│   ├── shield-contract/         Soroban — per-agent spend cap enforcement (Rust)
│   └── celo/                    Foundry — AegisCeloRegistry + AegisCeloPolicy (Solidity)
└── scripts/                     Manifest publishing, smoke tests, demos
```

---

## Getting Started

### Prerequisites

- Node.js >= 20
- `ANTHROPIC_API_KEY` and `LINKUP_API_KEY`

### Install and Run

```bash
npm install
cp .env.example .env.local
# Fill in ANTHROPIC_API_KEY and LINKUP_API_KEY

npm run dev    # Dashboard on :3000
```

### API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Deployment readiness, x402 config, contract pointers |
| `GET /api/agents` | Machine-readable agent manifests |
| `GET /api/agents?chain=celo` | Celo agent manifests |
| `POST /api/agents/:id/run` | Call a single agent (x402 gated) |
| `POST /api/run` | Full pipeline orchestration (add `chain: "celo"` for Celo) |
| `GET /api/receipts` | List run receipts |
| `GET /api/receipts/:id` | Fetch receipt with verification |
| `GET /api/openapi.json` | OpenAPI spec |

### Publish Manifest Hashes

```bash
# Stellar
npm run publish:manifest-hashes

# Celo
npm run publish:celo-manifest-hashes
```

### MCP Setup

```json
{
  "mcpServers": {
    "aegis-stellar": {
      "command": "node",
      "args": ["packages/aegis-mcp-stellar/dist/index.js"],
      "env": {
        "AEGIS_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

---

## @calebux/agent-kit

The reusable SDK for building governed multi-agent systems:

```bash
npm install @calebux/agent-kit
```

```ts
import { defineAgent, createOrchestrator } from '@calebux/agent-kit'

const researcher = defineAgent({
  id: 'researcher',
  spendCapXlm: 1,
  run: async (task, { pay }) => {
    const data = await pay('https://my-x402-api.com/search?q=' + task)
    return { result: JSON.stringify(data) }
  }
})

const { run } = createOrchestrator([researcher], {
  shieldContractId:   process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,
})

const report = await run('Analyze current DeFi activity')
```

Full docs: [npmjs.com/package/@calebux/agent-kit](https://www.npmjs.com/package/@calebux/agent-kit)

---

## License

MIT
