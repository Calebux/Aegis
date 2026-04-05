# Aegis

**Soroban-governed multi-agent system on Stellar**

Built for the [Stellar Hacks: Agents](https://dorahacks.io) hackathon on DoraHacks.

## Overview

Aegis is a multi-agent orchestration framework where a master orchestrator decomposes high-level tasks and spawns specialized sub-agents. Each sub-agent has its own Stellar testnet wallet and spend caps enforced by a **Shield Contract** on Soroban. Sub-agents pay for external tools via the x402 payment protocol on Stellar testnet.

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
               │                 │                │                 │
               └─────────────────┴────────────────┴─────────────────┘
                                          │
                              ┌───────────▼───────────┐
                              │    Soroban Contracts   │
                              │  Shield Contract       │
                              │  Identity Registry     │
                              └───────────────────────┘
```

## Sub-Agents

| Agent  | Role | Tool |
|--------|------|------|
| **Scout** | Web search & research | Linkup x402-native search SDK |
| **Ledger** | Stellar on-chain data | Horizon API via local x402 endpoint |
| **Signal** | Market signals & analytics | External data APIs via x402 |
| **Scribe** | Report synthesis | Claude API (Anthropic) |

## Monorepo Structure

```
aegis/
├── contracts/              # Soroban smart contracts (Rust)
│   ├── shield-contract/    # Spend cap enforcement per agent
│   └── identity-registry/  # Agent identity & reputation
├── packages/
│   ├── orchestrator/       # Master orchestrator (TypeScript)
│   ├── agents/             # Sub-agent implementations
│   └── shared/             # Shared types, Stellar helpers, x402 utils
└── apps/
    └── dashboard/          # Next.js live dashboard
```

## Tech Stack

- **Smart Contracts**: Soroban (Rust) on Stellar testnet
- **Orchestrator & Agents**: TypeScript (Node.js)
- **Payments**: x402 protocol on Stellar testnet
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

### Run Orchestrator (dev)

```bash
npm run dev --workspace=packages/orchestrator
```

### Run Dashboard

```bash
npm run dev --workspace=apps/dashboard
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your keys.

## License

MIT
