# Calagent Agentic Infrastructure Roadmap

Calagent should be positioned as the agent execution and trust layer for Stellar:
wallets, policies, payments, identity, reputation, and verifiable agent actions.

The goal is to move from a strong hackathon demo to infrastructure that other
Stellar builders can depend on.

## Core Thesis

AI agents need four things before they can safely operate on Stellar:

- A wallet and payment rail.
- A policy layer that limits what the agent can spend or execute.
- A discovery layer for finding trusted agents and paid services.
- A verification layer for proving who produced an output and what it cost.

Calagent already has early versions of these pieces through agent wallets, x402
payments, the Shield Contract, the Identity Registry, signed outputs, and the
dashboard. The next phase is to standardize those pieces into reusable APIs.

## Product Direction

Do not lead with "multi-agent research dashboard." Lead with:

> Cal-AgentKit is the agent execution and trust layer for Stellar.

The dashboard remains the reference application, but the product is the
infrastructure:

- `@calagent/agent-kit` for developers embedding governed agents.
- Agent manifests for discovery and payment metadata.
- Soroban contracts for spend policies, identity, reputation, and attestations.
- MCP tools for AI assistants and agents to discover, pay, run, and verify
  Stellar-native agents.

## Roadmap

### 1. Agent Manifests

Every agent should expose a portable manifest:

- Stable agent ID.
- Name, version, and description.
- Capabilities.
- Endpoint.
- Supported payment protocols: x402 first, MPP next.
- Supported Stellar assets: USDC first.
- Wallet binding.
- Registry and policy contract references.
- Optional attestation reference.

Status: TypeScript model and discovery helpers are implemented in
`packages/agent-kit/src/discovery.ts`; the dashboard publishes manifests at
`GET /api/agents`; each manifest points to `POST /api/agents/:id/run`.

### 2. Policy Engine

The current Shield Contract enforces per-agent spend caps. Expand this into a
policy model that can cover:

- Per-task budgets.
- Per-session budgets.
- Allowed domains.
- Allowed assets.
- Minimum counterparty reputation.
- Human approval thresholds.
- Emergency revocation.

The SDK should expose the same policy vocabulary off-chain and on-chain.

### 3. Stablecoin Payments

XLM is acceptable for testnet demos, but production agent payments should be
priced in stable assets.

Priority:

- USDC support in payment helpers.
- Asset-aware payment declarations in manifests.
- x402 examples priced in USDC.
- Facilitator-backed payment verification for `POST /api/agents/:id/run`.

### 4. MPP Sessions

x402 is ideal for request-level payment. MPP is better for long-running or
high-frequency sessions.

Calagent should support:

- `openSession`.
- `authorizeSessionBudget`.
- `streamPayment`.
- `settleSession`.
- Session-level policy checks.

### 5. MCP Server

Build `calagent-mcp-stellar` so agent runtimes and AI coding assistants can use
Calagent directly.

Implemented tools:

- `discover_agents`
- `get_agent_manifest`
- `calagent_agents_endpoint`
- `run_agent_task`
- `call_external_agent`
- `get_task_status`
- `get_run_receipt`
- `verify_run_receipt`

Next tools:

- `quote_agent_task`
- `pay_x402`
- `open_mpp_session`
- `check_reputation`
- `set_spend_policy`

This should become the easiest way for non-Stellar agents to access Stellar
payments, policy, and reputation.

### 6. Verifiable Output

Every agent result should include:

- Agent ID.
- Wallet address.
- Run ID.
- Task hash.
- Output hash.
- Signature.
- Payment receipts.
- Optional Soroban attestation.

This lets another app verify that a registered agent produced a specific output
under a specific budget.

### 7. Reference Use Case

The strongest demo is a Stellar DeFi copilot:

1. User grants a USDC budget.
2. Calagent discovers trusted agents.
3. Reputation and policy checks run.
4. Agents query paid data sources using x402 or MPP.
5. Outputs are signed and summarized.
6. A proposed action is executed only if the Soroban policy allows it.
7. The user can verify receipts, outputs, and reputation changes.

This demonstrates why Stellar matters: cheap stablecoin micropayments, fast
settlement, programmable policies, and real-world payment connectivity.

## Near-Term Implementation Checklist

- Publish agent manifests from the dashboard API. Done.
- Add a local `/api/agents` route that returns discoverable manifests. Done.
- Add `POST /api/agents/:id/run` for external agent calls. Done.
- Add USDC-capable payment declarations to agent definitions. Done.
- Add policy checks before every external request, not only payment requests.
- Add a first MCP server package. Done.
- Add a Soroban-compatible manifest hash to the Identity Registry.
- Add output hash/signature verification helpers to `agent-kit`.
