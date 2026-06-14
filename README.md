# Cal-AgentKit

**Multi-chain agent execution and trust infrastructure**

Cal-AgentKit is a multi-agent orchestration framework where a master orchestrator decomposes tasks into specialized sub-agents — each with its own wallet, on-chain spend caps, verifiable reputation, and x402 payment gating. Agents pay for external services, settle micropayments with each other, and produce cryptographically signed run receipts.

Currently live on **Celo mainnet** and **Stellar testnet**.

```bash
npm install @calebux/agent-kit
```

---

## Celo — Live on Mainnet

Cal-AgentKit deploys a full agent infrastructure on Celo: identity registry, policy enforcement, stablecoin payments, Mento oracle integration, and verifiable attestations — all on mainnet.

### Deployed Contracts

| Contract | Address | Purpose |
|---|---|---|
| **AegisCeloRegistry** | [`0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C`](https://celoscan.io/address/0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C) | Agent identity, manifest hashes, on-chain reputation |
| **AegisCeloPolicy** | [`0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c`](https://celoscan.io/address/0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c) | Per-agent spend caps and session management |
| **Erc8004Adapter** | _(deployed via `deploy.sh`)_ | Bridge to canonical ERC-8004 Identity and Reputation registries |
| **AgentStaking** | _(deployed via `deploy.sh`)_ | USDm staking, slashing, and rewards for agents |
| **ConsensusVoting** | _(deployed via `deploy.sh`)_ | On-chain consensus voting for multi-agent pipelines |
| **TaskEscrow** | _(deployed via `deploy.sh`)_ | USDm escrow with conditional release on verified receipt |

### ERC-8004 Compliance

Cal-AgentKit bridges to the canonical [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) registries on Celo mainnet via the `Erc8004Adapter` contract:

| Registry | Address | Purpose |
|---|---|---|
| **ERC-8004 Identity** | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://celoscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) | Canonical agent identity NFTs |
| **ERC-8004 Reputation** | [`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`](https://celoscan.io/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63) | Canonical agent reputation feedback |

The adapter provides:
- `registerAgent(calagentId, agentURI)` — registers on ERC-8004 Identity Registry, returns NFT ID
- `syncReputation(calagentId, value, tag)` — forwards reputation signals to ERC-8004 Reputation Registry
- `updateAgentURI(calagentId, newURI)` — updates agent metadata on-chain
- Bidirectional mapping between Cal-AgentKit agent IDs and ERC-8004 NFT token IDs

### Agent Staking

The `AgentStaking` contract lets agents stake USDm as collateral. Admins can slash misbehaving agents or reward reliable ones:

```ts
import { AgentStakingManager } from '@calebux/agent-kit'

const staking = new AgentStakingManager(
  process.env.CELO_STAKING_ADDRESS!,
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

await staking.stake('my-agent', 100_000000000000000000n) // 100 USDm
const stake = await staking.getStake('my-agent')
const isStaked = await staking.isStaked('my-agent', 50_000000000000000000n)
```

### Consensus Voting

The `ConsensusVoting` contract records multi-agent consensus on-chain:

```ts
import { ConsensusVotingManager } from '@calebux/agent-kit'

const voting = new ConsensusVotingManager(
  process.env.CELO_CONSENSUS_VOTING_ADDRESS!,
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

const roundId = await voting.openRound(taskHash)
await voting.submitVote(roundId, 'scout', outputHash, 9000)
await voting.submitVote(roundId, 'ledger', outputHash, 8500)
await voting.finalizeRound(roundId)
const result = await voting.getRoundResult(roundId)
```

### Task Escrow

The `TaskEscrow` contract holds USDm in escrow for agent tasks. Funds are released when a verified receipt is provided, or refunded to the depositor after a deadline:

```ts
import { TaskEscrowManager } from '@calebux/agent-kit'

const escrow = new TaskEscrowManager(
  process.env.CELO_TASK_ESCROW_ADDRESS!,
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

// Deposit USDm into escrow for a task
const { escrowId } = await escrow.createEscrow(taskHash, 'my-agent', 50_000000000000000000n, deadlineTimestamp)

// Release after verifying the agent's receipt
await escrow.releaseEscrow(escrowId, receiptHash)

// Or refund if deadline passed without completion
await escrow.refundEscrow(escrowId)
```

### Agent Delegation

Parent agents can delegate tasks to child agents with linked receipt chains:

```ts
import { delegateTask, createSubOrchestrator } from '@calebux/agent-kit'

// Simple delegation
const delegation = delegateTask('parent-agent', 'child-agent', 'research task', parentRunId)

// Sub-orchestrator with inherited budget
const sub = createSubOrchestrator(['scout', 'ledger'], {
  parentRunId,
  parentAgentId: 'orchestrator',
  maxSpend: 1_000000n,
})
const d = sub.delegate('scout', 'web research on Celo DeFi')
```

API endpoint: `POST /api/agents/:id/delegate` with `{ childAgentId, task }`.

### Self Protocol Integration

[Self Protocol](https://self.xyz) provides sybil-resistant agent identity. The Self Agent Registry on Celo mainnet (`0xaC3DF9ABf80d0F5c020C06B04Cced27763355944`) verifies that agent wallets belong to authenticated humans.

- `isSelfVerified(agentAddress)` — check if an agent wallet is Self-verified (read-only, no gas)
- Set `CALAGENT_SELF_ENFORCE=true` to gate agent runs behind Self verification (returns 403 if unverified)
- Dashboard shows "Self" and "8004" badges on verified agents

### Celo Agents

| Agent | Capabilities | What it does |
|---|---|---|
| **celo-ledger** | `celo`, `onchain-data`, `stablecoins`, `rpc` | Live Celo RPC reads — block height, gas price, chain ID |
| **celo-notary** | `celo`, `attestation`, `execution`, `proof` | On-chain attestation writes to AegisCeloRegistry |
| **celo-defi** | `celo`, `defi`, `stablecoins`, `mento`, `oracles`, `yield`, `reserves`, `liquidity` | Mento oracles, reserve data, Ubeswap pools, Moola rates |
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

Agents are gated behind x402 with **USDm** (Mento USD) as the settlement asset:

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
  Erc8004Adapter,
  isSelfVerified,
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

// ERC-8004 adapter — bridge to canonical registries
const adapter = new Erc8004Adapter(
  process.env.ERC8004_ADAPTER_ADDRESS!,
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

const { txHash, erc8004Id } = await adapter.registerOnErc8004(
  'my-agent',
  'https://myapp.com/api/agents/my-agent/uri'
)
await adapter.syncReputation('my-agent', 10, 'task-success')

// Self Protocol — sybil-resistant identity check
const verified = await isSelfVerified('0xAgentWallet...')
```

### Celo Environment

| Variable | Purpose |
|---|---|
| `CALAGENT_CELO_NETWORK` | `mainnet` or `alfajores` |
| `CELO_RPC_URL` | Celo JSON-RPC endpoint |
| `CELO_REGISTRY_ADDRESS` | AegisCeloRegistry address |
| `CELO_POLICY_ADDRESS` | AegisCeloPolicy address |
| `CELO_DEPLOYER_PRIVATE_KEY` | Admin key for registry/policy writes |
| `CALAGENT_CELO_X402_RECEIVER` | Celo address receiving x402 USDm payments |
| `CALAGENT_CELO_X402_FACILITATOR_URL` | Celo/EVM x402 facilitator |
| `ERC8004_ADAPTER_ADDRESS` | Erc8004Adapter bridge contract address |
| `CALAGENT_SELF_ENFORCE` | `true` to gate agent runs behind Self Protocol verification |
| `CELO_STAKING_ADDRESS` | AgentStaking contract address |
| `CELO_CONSENSUS_VOTING_ADDRESS` | ConsensusVoting contract address |
| `CALAGENT_PEERS` | Comma-separated peer instance URLs for auto-federation |

### Celo Contracts (Foundry)

```bash
# Deploy
cd contracts/celo && bash deploy.sh

# Test
cd contracts/celo && forge test

# Publish manifest hashes (dashboard must be running)
npm run publish:celo-manifest-hashes

# Register agents on ERC-8004 (dashboard must be running)
npm run publish:erc8004
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

Agent-to-agent payments: Scribe pays Scout 0.001 XLM per synthesis (`calagent:scribe->scout`).

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

## What Makes Cal-AgentKit Different

1. **Multi-chain from day one** — same agent architecture on Celo (EVM/USDm) and Stellar (Soroban/XLM)
2. **Full-stack x402** — simultaneously an x402 provider and consumer on both chains
3. **On-chain spend governance** — Shield Contract (Stellar) and AegisCeloPolicy (Celo) enforce caps before transactions hit the network
4. **Agent-to-agent payments** — agents have financial relationships with each other, settled on-chain
5. **Live reputation** — Identity Registry increments scores on-chain after every task
6. **Verifiable run receipts** — every run produces `calagent.receipt.v1` with task/output hashes, payment txs, Ed25519 signature
7. **Discoverable manifests** — agents declare capabilities, endpoints, payment terms via portable SDK manifests
8. **Cross-chain federation** — `PeerRegistry` + `routeToPeer()` let independent Cal-AgentKit instances discover and delegate tasks across chains and organizations
9. **ERC-8004 compliant** — bridge adapter registers agents on canonical ERC-8004 Identity and Reputation registries with NFT-based identity
10. **Sybil-resistant identity** — Self Protocol integration verifies agent wallets belong to authenticated humans, optional enforcement gate on agent runs
11. **Agent staking** — USDm staking contract with slash/reward mechanics for agent accountability
12. **On-chain consensus voting** — multi-agent consensus recorded immutably on-chain with majority finalization
13. **Agent delegation** — parent agents delegate to child agents with linked receipt chains and inherited spend budgets

---

## Interoperable by Design

Cal-AgentKit is chain-agnostic infrastructure. The same agent definitions, manifests, receipts, and orchestration logic work across every supported chain — and across independently deployed instances.

### Multi-chain settlement

`selectChain()` routes agent payments to the right network at runtime:

```ts
import { selectChain } from '@calebux/agent-kit'

const chain = selectChain('celo')   // or 'stellar', 'base'
await chain.pay(destination, amount)
await chain.attest(outputHash)
```

### Cross-instance federation

`PeerRegistry` lets Cal-AgentKit instances discover and delegate tasks to each other, with trust verification:

```ts
import { PeerRegistry, routeToPeer } from '@calebux/agent-kit'

const peers = new PeerRegistry()
peers.add('https://partner-instance.example.com', { trust: 'verified' })

// Route a task to a peer instance's specialized agent
const result = await routeToPeer(peers, {
  capability: 'celo-defi',
  task: 'Get Mento exchange rates',
})
```

### Unified receipts

Every run produces `calagent.receipt.v1` — the same schema regardless of chain. Receipts from Celo, Stellar, or Base are interchangeable and independently verifiable.

### Chain-agnostic manifests

Agent manifests use the same `AgentManifest` shape across chains. To target a different chain, set the `chain` field:

```ts
const manifest = createAgentManifest(agent, {
  chain: 'celo',        // or 'stellar', 'base'
  network: 'eip155:42220',
  asset: 'USDm',
})
```

---

## Monorepo Structure

```
calagent/
├── apps/dashboard/              Next.js 14 App Router — live dashboard + public agent API
├── packages/
│   ├── orchestrator/            Master pipeline (Scout→Ledger→Signal→Scribe→Notary)
│   ├── agent-kit/               @calebux/agent-kit — reusable SDK
│   ├── agents/                  Standalone agent processes / x402 servers
│   ├── shared/                  Shared types
│   ├── calagent-chain-celo/        Celo/viem helpers, registry ABI
│   └── calagent-mcp-stellar/       MCP server wrapping the public agent API
├── contracts/
│   ├── identity-registry/       Soroban — agent identity + reputation (Rust)
│   ├── shield-contract/         Soroban — per-agent spend cap enforcement (Rust)
│   └── celo/                    Foundry — AegisCeloRegistry + AegisCeloPolicy + Erc8004Adapter + AgentStaking + ConsensusVoting
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
| `POST /api/agents/:id/run` | Call a single agent (x402 gated, optional Self Protocol gate, CeloPolicy spend caps) |
| `POST /api/agents/:id/delegate` | Delegate a task from parent to child agent (linked receipt chains) |
| `GET /api/agents/:id/uri` | ERC-8004-compatible agent metadata JSON |
| `GET /api/agents/:id/verify` | Self Protocol + ERC-8004 verification status |
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

# ERC-8004
npm run publish:erc8004
```

### MCP Setup

```json
{
  "mcpServers": {
    "calagent-stellar": {
      "command": "node",
      "args": ["packages/calagent-mcp-stellar/dist/index.js"],
      "env": {
        "CALAGENT_BASE_URL": "http://localhost:3000"
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
