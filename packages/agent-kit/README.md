# @calebux/agent-kit

**Governed multi-agent orchestration on Stellar and Celo.**

Build AI agents that pay for data, enforce on-chain spend limits, earn verifiable reputation, and produce cryptographically signed run receipts — without writing any infrastructure code.

```bash
npm install @calebux/agent-kit
```

---

## What it does

| Feature | Stellar | Celo |
|---|---|---|
| **Wallet provisioning** | Fresh Stellar keypair, auto-funded via Friendbot on testnet | viem Account from private key or random |
| **On-chain spend caps** | Soroban Shield Contract | AegisCeloPolicy contract |
| **x402 payments** | `payAndFetch()` — probe → pay XLM → retry | `payAndFetchCelo()` — probe → pay cUSD → retry |
| **Verifiable reputation** | Soroban Identity Registry | AegisCeloRegistry on Celo mainnet |
| **Agent-to-agent payments** | XLM with on-chain memos | cUSD ERC-20 transfers |
| **Run receipts** | SHA-256 hashed, Ed25519 signed | SHA-256 hashed, Ed25519 signed |
| **Agent manifests** | Capabilities, endpoints, payment terms, policies | Same shape, `chain: "celo"` |

---

## Quick start (Stellar)

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

## Celo support

v0.2.0 adds full Celo/EVM support alongside Stellar:

```ts
import {
  CeloIdentityRegistry,
  CeloPolicyManager,
  payAndFetchCelo,
  submitCusdPayment,
  celoAgentToAgentPayment,
} from '@calebux/agent-kit'

// Registry — agent identity and reputation on Celo
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

await policy.setSpendCap('my-agent', 1000000n) // in cUSD base units
await policy.authorizeSpend('my-agent', 50000n)

// x402 payment helper for Celo (probe → pay cUSD → retry)
const result = await payAndFetchCelo('https://api.example.com/data', account, txHashes)

// Direct cUSD transfer
const txHash = await submitCusdPayment(account, '0xDEST...', '0.5')

// Agent-to-agent cUSD payment
const hash = await celoAgentToAgentPayment(fromAccount, toAddress, '0.001')
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

Receipt schema: `aegis.receipt.v1`

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
  asset: 'cUSD',
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
| `AEGIS_CELO_NETWORK` | Celo | `mainnet` or `alfajores` |

All contract options are optional — omit them to run in dev mode with no on-chain enforcement.

---

## Reference implementation

[Aegis](https://github.com/Calebux/Aegis) is the full reference implementation: five specialized agents per chain (Scout, Ledger, Signal, Scribe, Notary), live x402 payment servers, agent-to-agent payments, verifiable run receipts, and a Next.js dashboard — all built on `@calebux/agent-kit`.

---

## License

MIT
