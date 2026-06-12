# MiniPay Yield Copilot Scaffold Plan

## Goal

Create a separate repo for a MiniPay-first yield decision agent using
TypeScript. The architecture should keep the Mini App frontend thin and move
decision logic, monitoring, and venue adapters into backend and shared
packages.

## Recommended stack

- `pnpm` workspaces
- `TypeScript` across all packages
- `apps/miniapp`: `Next.js` App Router
- `apps/api`: lightweight Node service or Next.js route handlers
- `wagmi` + `viem` for MiniPay wallet flows
- `zod` for schemas
- `tanstack-query` or `swr` for client data fetching

## Why this stack

- MiniPay expects EVM wallet integration and officially recommends `wagmi` and
  `viem`
- TypeScript keeps scoring logic, adapter contracts, and API payloads aligned
- a monorepo keeps Mini App UI, backend agents, and Celo integrations versioned
  together

## Repo structure

```text
yield-copilot/
├── apps/
│   ├── miniapp/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── public/
│   │   └── package.json
│   └── api/
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── orchestrator/
│       │   └── index.ts
│       └── package.json
├── packages/
│   ├── agents/
│   │   ├── src/
│   │   │   ├── yield-scout.ts
│   │   │   ├── risk-guard.ts
│   │   │   ├── goal-planner.ts
│   │   │   ├── execution-agent.ts
│   │   │   └── monitor-agent.ts
│   │   └── package.json
│   ├── celo/
│   │   ├── src/
│   │   │   ├── chains.ts
│   │   │   ├── tokens.ts
│   │   │   ├── venues/
│   │   │   ├── minipay.ts
│   │   │   └── transactions.ts
│   │   └── package.json
│   ├── shared/
│   │   ├── src/
│   │   │   ├── env.ts
│   │   │   ├── schemas.ts
│   │   │   ├── types.ts
│   │   │   └── constants.ts
│   │   └── package.json
│   └── ui/
│       ├── src/
│       └── package.json
├── docs/
│   ├── prd.md
│   ├── architecture.md
│   └── integrations.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .env.example
```

## Package responsibilities

### `apps/miniapp`

- MiniPay runtime detection
- wallet auto-connect
- intake flow
- recommendation display
- execution UI
- position and alert UI

### `apps/api`

- recommendation endpoint
- venue metadata endpoint
- monitored position endpoint
- optional server-side orchestration
- adapter caching and normalization

### `packages/agents`

- yield discovery logic
- risk scoring
- goal-to-allocation mapping
- transaction plan generation
- monitoring and rebalance suggestion logic

### `packages/celo`

- chain config
- token metadata
- venue adapters
- transaction builder helpers
- integration-specific parsing

### `packages/shared`

- common types
- zod schemas
- env parsing
- constants and enums

### `packages/ui`

- mobile-first design system primitives
- shared cards, badges, layout shells, and feedback states

## Frontend architecture

### App shell

- detect MiniPay provider
- attempt auto-connect once on initial load
- fail gracefully when opened outside MiniPay

### Pages

- `/` home and balance intake
- `/recommendation` result view
- `/position` active deposit view
- `/alerts` status and rebalance suggestions
- `/legal/terms`
- `/legal/privacy`

### State model

- wallet state
- input state
- recommendation result
- active positions
- venue availability

Avoid complex global state until needed. Start with server state plus local
component state.

## Backend architecture

### Core endpoints

- `POST /recommend`
- `GET /venues`
- `GET /positions/:address`
- `POST /execution-plan`

### Internal services

- `VenueRegistry`
- `RecommendationService`
- `RiskService`
- `PositionMonitorService`

## Agent interactions

```text
User input
  -> Goal Planner
  -> Yield Scout gathers supported venues
  -> Risk Guard annotates venues
  -> RecommendationService ranks candidates
  -> Execution Agent returns action steps
  -> Mini App displays result and executes user-approved flow
```

## Integration strategy

Start with a strict adapter model. Every venue integration should expose the
same interface.

```ts
type YieldVenueAdapter = {
  id: string;
  label: string;
  supportedTokens: string[];
  getAvailability(input: VenueInput): Promise<VenueAvailability>;
  getQuote(input: QuoteInput): Promise<YieldQuote>;
  getRiskMeta(): Promise<RiskMeta>;
  buildDepositPlan(input: DepositInput): Promise<ExecutionPlan>;
  buildWithdrawPlan(input: WithdrawInput): Promise<ExecutionPlan>;
};
```

## Recommendation strategy for v1

Do not start with AI-generated recommendations. Use deterministic policy code.

Ranking factors:

- token compatibility
- current yield
- liquidity and exit flexibility
- protocol risk bucket
- user time horizon
- user flexibility preference
- venue availability in MiniPay context

This keeps behavior testable and reviewable.

## MiniPay-specific requirements

- auto-connect wallet on load
- no connect button
- mobile-first layout
- HTTPS-only deployment
- test on real iOS or Android devices
- support Celo Mainnet and testnet as needed

## Data model suggestions

### Recommendation request

```ts
{
  walletAddress: string;
  token: "USDT" | "USDC" | "USDm";
  amount: string;
  goal: "keep-flexible" | "earn-more" | "save-safely";
  timeHorizonDays: number;
  riskComfort: "low" | "medium";
}
```

### Recommendation response

```ts
{
  recommended: VenueResult;
  backup: VenueResult | null;
  rationale: string[];
  warnings: string[];
  generatedAt: string;
}
```

## Testing strategy

### Unit tests

- recommendation scoring
- risk bucketing
- adapter normalization
- execution plan building

### Integration tests

- venue adapter responses
- wallet state detection
- API contract validation

### Manual tests

- open inside MiniPay on a real phone
- recommendation flow
- deposit flow
- error handling when venue is unavailable

## Milestones

### Milestone 1

- repo initialized
- MiniPay auto-connect working
- UI shell and navigation in place

### Milestone 2

- mock recommendation engine
- static venue cards
- legal and support pages

### Milestone 3

- first real venue integration
- execution plan generation
- real deposit flow testing

### Milestone 4

- monitoring and position status
- second venue integration
- submission prep for listing

## Non-goals for the first repo

- generic agent marketplace
- token discovery platform
- multi-chain yield engine
- full autonomous capital allocation

## Recommendation

Initialize the repo as a focused product monorepo, not an experimental agent
framework. Keep the agent abstraction lightweight until the first 2 venue
integrations are working end-to-end.
