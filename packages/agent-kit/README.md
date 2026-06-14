# @calebux/agent-kit

**Governed multi-agent orchestration on Celo and Stellar.**

Build AI agents that pay for data, enforce on-chain spend limits, earn verifiable reputation, and produce cryptographically signed run receipts — without writing any infrastructure code.

```bash
npm install @calebux/agent-kit
```

---

## What it does

| Feature | Celo | Stellar |
|---|---|---|
| **Wallet provisioning** | viem Account from private key or random | Fresh Stellar keypair, auto-funded via Friendbot on testnet |
| **On-chain spend caps** | AegisCeloPolicy contract | Soroban Shield Contract |
| **x402 payments** | `payAndFetchCelo()` — probe → pay USDm → retry | `payAndFetch()` — probe → pay XLM → retry |
| **Verifiable reputation** | AegisCeloRegistry on Celo mainnet | Soroban Identity Registry |
| **Agent-to-agent payments** | USDm ERC-20 transfers | XLM with on-chain memos |
| **Run receipts** | SHA-256 hashed, Ed25519 signed | SHA-256 hashed, Ed25519 signed |
| **Agent manifests** | Same shape, `chain: "celo"` | Capabilities, endpoints, payment terms, policies |
| **ERC-8004 compliance** | Erc8004Adapter bridge to canonical registries | N/A |
| **Self Protocol identity** | Sybil-resistant agent verification | N/A |

---

## Quick start (Celo)

```ts
import {
  CeloIdentityRegistry,
  CeloPolicyManager,
  payAndFetchCelo,
  submitCusdPayment,
  celoAgentToAgentPayment,
} from '@calebux/agent-kit'

// Registry — agent identity and reputation on Celo mainnet
const registry = new CeloIdentityRegistry(
  '0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C',
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

await registry.registerAgent('my-agent', 'My Agent', 'research')
await registry.setManifestHash('my-agent', manifestHash)
await registry.recordSuccess('my-agent')
const rep = await registry.getReputation('my-agent') // number | null

// Policy — per-agent spend caps and session management on Celo
const policy = new CeloPolicyManager(
  '0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c',
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

await policy.setSpendCap('my-agent', 1000000n) // in USDm base units
await policy.authorizeSpend('my-agent', 50000n)

// x402 payment helper for Celo (probe → pay USDm → retry)
const result = await payAndFetchCelo('https://api.example.com/data', account, txHashes)

// Direct USDm transfer
const txHash = await submitCusdPayment(account, '0xDEST...', '0.5')

// Agent-to-agent USDm payment
const hash = await celoAgentToAgentPayment(fromAccount, toAddress, '0.001')
```

---

## ERC-8004 and Self Protocol (Celo)

```ts
import {
  Erc8004Adapter,
  isSelfVerified,
  selfEnforced,
  SELF_AGENT_REGISTRY,
} from '@calebux/agent-kit'

// ERC-8004 adapter — bridge to canonical Identity + Reputation registries
const adapter = new Erc8004Adapter(
  process.env.ERC8004_ADAPTER_ADDRESS!,
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

// Register an agent → gets an ERC-8004 NFT ID
const { txHash, erc8004Id } = await adapter.registerOnErc8004(
  'my-agent',
  'https://myapp.com/api/agents/my-agent/uri'
)

// Sync reputation to the canonical ERC-8004 Reputation Registry
await adapter.syncReputation('my-agent', 10, 'task-success')

// Update agent metadata URI
await adapter.updateAgentURI('my-agent', 'https://myapp.com/api/agents/my-agent/uri')

// Check registration
const registered = await adapter.isRegistered('my-agent')
const nftId = await adapter.getErc8004AgentId('my-agent')

// Self Protocol — sybil-resistant identity
const verified = await isSelfVerified('0xAgentWalletAddress')
const enforce = selfEnforced() // checks CALAGENT_SELF_ENFORCE env var
```

---

## Agent Staking (Celo)

```ts
import { AgentStakingManager } from '@calebux/agent-kit'

const staking = new AgentStakingManager(
  process.env.CELO_STAKING_ADDRESS!,
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

// Stake USDm as collateral (must approve token first)
await staking.stake('my-agent', 100_000000000000000000n)

// Check stake
const stake = await staking.getStake('my-agent')
const isStaked = await staking.isStaked('my-agent', 50_000000000000000000n)

// Unstake with cooldown
await staking.requestUnstake('my-agent', 50_000000000000000000n)
// ... wait 24h ...
await staking.unstake('my-agent')
```

---

## Consensus Voting (Celo)

```ts
import { ConsensusVotingManager } from '@calebux/agent-kit'

const voting = new ConsensusVotingManager(
  process.env.CELO_CONSENSUS_VOTING_ADDRESS!,
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

// Open a round, submit votes, finalize
const roundId = await voting.openRound(taskHash)
await voting.submitVote(roundId, 'scout', outputHash, 9000)
await voting.submitVote(roundId, 'ledger', outputHash, 8500)
await voting.submitVote(roundId, 'signal', otherHash, 7000)
await voting.finalizeRound(roundId)

const { outputHash, voteCount, finalized } = await voting.getRoundResult(roundId)
```

---

## Task Escrow (Celo)

```ts
import { TaskEscrowManager } from '@calebux/agent-kit'

const escrow = new TaskEscrowManager(
  process.env.CELO_TASK_ESCROW_ADDRESS!,
  process.env.CELO_DEPLOYER_PRIVATE_KEY!,
  'https://forno.celo.org',
  'mainnet'
)

// Create escrow — deposit USDm for a task with a deadline
const { txHash, escrowId } = await escrow.createEscrow(
  taskHash,           // bytes32 task hash
  'my-agent',         // agent ID
  50_000000000000000000n, // 50 USDm
  BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour deadline
)

// Release funds to agent after verifying receipt
await escrow.releaseEscrow(escrowId, receiptHash)

// Or refund depositor if deadline passed
await escrow.refundEscrow(escrowId)

// Read escrow details
const info = await escrow.getEscrow(escrowId)
// info.depositor, info.agentId, info.amount, info.taskHash, info.released, info.deadline
```

---

## Agent Delegation

```ts
import { delegateTask, createSubOrchestrator } from '@calebux/agent-kit'

// Simple delegation with receipt chain linking
const delegation = delegateTask('parent-agent', 'child-agent', 'research task', parentRunId)
// delegation.childRunId, delegation.receiptHash — linked to parentRunId

// Sub-orchestrator with inherited budget
const sub = createSubOrchestrator(['scout', 'ledger', 'signal'], {
  parentRunId,
  parentAgentId: 'orchestrator',
  maxSpend: 1_000000n,
})

const d = sub.delegate('scout', 'web research on Celo DeFi')
sub.recordSpend(500000n)  // track spend against budget
console.log(sub.remaining) // 500000n
```

---

## Stellar support

Full Stellar/Soroban support with x402 payments in XLM:

```ts
import { defineAgent, createOrchestrator } from '@calebux/agent-kit'

const researcher = defineAgent({
  id: 'researcher',
  spendCapXlm: 1,
  manifest: {
    name: 'Researcher',
    capabilities: ['research', 'web-search'],
    payments: [
      { protocol: 'x402', network: 'stellar:testnet', asset: 'USDC', price: '$0.001' }
    ],
    policies: {
      allowedAssets: ['USDC'],
      minCounterpartyReputation: 5000,
    },
  },
  run: async (task, { pay }) => {
    const data = await pay<{ summary: string }>('https://my-x402-api.com/search?q=' + task)
    return { result: data.summary }
  }
})

const { run } = createOrchestrator([researcher], {
  shieldContractId:   process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,
})

const report = await run('What is the current XLM price?')
```

---

## Run receipts

Every agent run can produce a verifiable receipt — a JSON object containing task hash, output hash, agent wallets, payment transactions, and an optional Ed25519 signature.

```ts
import {
  createRunReceipt,
  signRunReceipt,
  computeReceiptHash,
  verifyRunReceipt,
} from '@calebux/agent-kit'

// Create a receipt from an orchestrator report
const receipt = createRunReceipt(orchestratorReport, {
  shieldContractId: process.env.SHIELD_CONTRACT_ID,
  registryContractId: process.env.REGISTRY_CONTRACT_ID,
  network: 'stellar:testnet',
})

// Sign it with a Stellar keypair
const signed = signRunReceipt(receipt, adminKeypair)

// Verify a receipt
const verification = verifyRunReceipt(signed)
// { valid: true, taskHashMatch: true, outputHashMatch: true, signatureValid: true }

// Compute a deterministic hash of any receipt
const hash = computeReceiptHash(signed)
```

Receipt schema: `calagent.receipt.v1`

---

## Agent manifests and discovery

Manifests declare capabilities, endpoints, payment terms, and policy constraints. They work across both chains.

```ts
import {
  createAgentManifest,
  computeAgentManifestHash,
  discoverAgents,
} from '@calebux/agent-kit'

const manifest = createAgentManifest(agent, {
  walletAddress: 'G...',
  registryContractId: process.env.REGISTRY_CONTRACT_ID,
  shieldContractId: process.env.SHIELD_CONTRACT_ID,
})

// SHA-256 hash for on-chain registration
const hash = computeAgentManifestHash(manifest)

// Filter agents by capability, protocol, asset, reputation
const matches = discoverAgents(manifests, {
  capability: 'web-search',
  protocol: 'x402',
  asset: 'USDm',
  network: 'eip155:42220',
  minReputation: 5000,
}, reputationMap)
```

---

## Streaming to a UI

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

---

## Low-level utilities (Stellar)

```ts
import {
  payAndFetch,
  submitXlmPayment,
  agentToAgentPayment,
  ShieldContract,
  IdentityRegistry,
} from '@calebux/agent-kit'

// x402 payment helper (probe → pay → retry)
const { data, paymentMode } = await payAndFetch('https://api.example.com/data', keypair, txHashes)

// Direct XLM transfer
const txHash = await submitXlmPayment(fromKeypair, 'G...DEST', '0.5')

// Agent-to-agent payment with on-chain memo
const hash = await agentToAgentPayment(fromKeypair, toAddress, '0.001', 'myapp:agent-a->agent-b')

// Shield Contract — per-agent spend caps
const shield = new ShieldContract(process.env.SHIELD_CONTRACT_ID!, rpc, adminKeypair)
await shield.registerAgent('my-agent', agentKeypair, 10_000_000n)
await shield.authorizeSpend('my-agent', 100_000n)

// Identity Registry — verifiable reputation
const registry = new IdentityRegistry(process.env.REGISTRY_CONTRACT_ID!, rpc, adminKeypair)
await registry.registerAgent('my-agent', 'My Agent', 'research')
await registry.recordSuccess('my-agent', agentKeypair)
const score = await registry.getReputation('my-agent')
```

---

## Automation

Schedule recurring agent tasks with `createAutomation()`:

```ts
import { createAutomation } from '@calebux/agent-kit'

const automation = createAutomation({
  agent: 'celo-defi',
  task: 'Get Mento exchange rates',
  schedule: '*/15 * * * *',  // every 15 minutes
  chain: 'celo',
  onResult: (receipt) => console.log('Rate:', receipt.output),
})

automation.start()
```

---

## Interoperability

Cal-AgentKit is chain-agnostic. The same agent definitions, manifests, and receipts work across every supported chain — and across independently deployed instances.

```ts
import { selectChain, PeerRegistry, routeToPeer } from '@calebux/agent-kit'

// Route payments to any supported chain
const chain = selectChain('celo')   // or 'stellar', 'base'
await chain.pay(destination, amount)

// Discover and delegate to peer instances
const peers = new PeerRegistry()
peers.add('https://partner.example.com', { trust: 'verified' })

const result = await routeToPeer(peers, {
  capability: 'celo-defi',
  task: 'Get Mento exchange rates',
})
```

---

## Deployed contracts

**Stellar testnet (Soroban):**

| Contract | ID |
|---|---|
| Shield Contract | `CDGVUNE47FXSG6KJATMZB3MFTE7UJFBMUKNFK7FWZRAHPG5BUGBFV2RS` |
| Identity Registry | `CBQV3JXYZS7ABOTLCYZM6U4LUEF7PTIUXV76QAPHYAACERXHROVTT2YM` |

**Celo mainnet:**

| Contract | Address |
|---|---|
| AegisCeloRegistry | `0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C` |
| AegisCeloPolicy | `0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c` |
| Erc8004Adapter | _(deployed via `deploy.sh`)_ |
| AgentStaking | _(deployed via `deploy.sh`)_ |
| ConsensusVoting | _(deployed via `deploy.sh`)_ |
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Self Agent Registry | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` |

---

## Environment variables

| Variable | Chain | Description |
|---|---|---|
| `STELLAR_NETWORK` | Stellar | `testnet` (default) or `futurenet` |
| `STELLAR_HORIZON_URL` | Stellar | Horizon endpoint |
| `STELLAR_RPC_URL` | Stellar | Soroban RPC endpoint |
| `SHIELD_CONTRACT_ID` | Stellar | Shield Contract address |
| `REGISTRY_CONTRACT_ID` | Stellar | Identity Registry address |
| `ORCHESTRATOR_SECRET_KEY` | Stellar | Admin keypair for on-chain registration |
| `CELO_RPC_URL` | Celo | Celo JSON-RPC endpoint (default: `https://forno.celo.org`) |
| `CELO_REGISTRY_ADDRESS` | Celo | AegisCeloRegistry contract address |
| `CELO_POLICY_ADDRESS` | Celo | AegisCeloPolicy contract address |
| `CELO_DEPLOYER_PRIVATE_KEY` | Celo | Admin key for registry/policy writes |
| `CALAGENT_CELO_NETWORK` | Celo | `mainnet` or `alfajores` |
| `ERC8004_ADAPTER_ADDRESS` | Celo | Erc8004Adapter bridge contract address |
| `CALAGENT_SELF_ENFORCE` | Celo | `true` to gate agent runs behind Self Protocol verification |
| `CELO_STAKING_ADDRESS` | Celo | AgentStaking contract address |
| `CELO_CONSENSUS_VOTING_ADDRESS` | Celo | ConsensusVoting contract address |
| `CALAGENT_PEERS` | Any | Comma-separated peer instance URLs for auto-federation |

All contract options are optional — omit them to run in dev mode with no on-chain enforcement.

---

## Reference implementation

[Aegis](https://github.com/Calebux/Aegis) is the full reference implementation: five specialized agents per chain (Scout, Ledger, Signal, Scribe, Notary), live x402 payment servers, agent-to-agent payments, verifiable run receipts, and a Next.js dashboard — all built on `@calebux/agent-kit`.

---

## License

MIT
