# MiniPay Yield Copilot Bootstrap Checklist

## Purpose

Use this checklist when creating the separate repo so the first build sprint is
blocked by as little setup ambiguity as possible.

## Before repo creation

- choose final product name
- create GitHub repo
- decide `pnpm` as package manager
- decide whether `apps/api` is a standalone service or part of Next.js
- pick v1 venues:
  - `MiniPay Boost`
  - `Kiln`
  - optional third venue

## Repo initialization

1. Create workspace files:
   - `package.json`
   - `pnpm-workspace.yaml`
   - `tsconfig.base.json`
   - `.gitignore`
   - `.env.example`
2. Create app packages:
   - `apps/miniapp`
   - `apps/api`
3. Create shared packages:
   - `packages/agents`
   - `packages/celo`
   - `packages/shared`
   - `packages/ui`
4. Add lint, format, and typecheck scripts at the root.

## Frontend setup

- initialize `Next.js` app for `apps/miniapp`
- install `wagmi`, `viem`, `zod`, and data-fetching library
- add MiniPay provider detection
- implement wallet auto-connect on load
- add outside-MiniPay fallback screen
- create mobile-first layout shell

## Backend setup

- initialize `apps/api` with TypeScript
- add `POST /recommend`
- add `GET /venues`
- add `POST /execution-plan`
- wire zod request/response validation

## Shared package setup

- define enums for supported tokens
- define recommendation request and response schemas
- define venue adapter interfaces
- define risk label constants

## First UI screens

- landing / intake
- goal selector
- recommendation result
- risk details
- active position
- legal pages
- support page

## First implementation tasks

1. Hardcode 2-3 venues with mock APY and risk metadata.
2. Build deterministic recommendation logic.
3. Display one recommendation and one backup.
4. Add a placeholder execution flow.
5. Replace mocked venue data with first live integration.

## Environment variables

At minimum define:

- `NEXT_PUBLIC_APP_ENV`
- `NEXT_PUBLIC_DEFAULT_CHAIN`
- `NEXT_PUBLIC_MINIPAY_ONLY`
- `API_BASE_URL`

Add integration secrets only when needed. Keep v1 secrets narrowly scoped.

## Design requirements

- must work at `360x720` and above
- no connect button inside MiniPay
- clear ownership branding
- simple typography and high contrast
- obvious support and legal links

## Submission readiness

- HTTPS production URL
- working auto-connect
- mobile performance tuned
- support URL ready
- Terms of Service ready
- Privacy Policy ready
- network manifest ready
- sample transactions prepared for any user-facing contracts

## First sprint target

By the end of sprint 1, the new repo should have:

- a working MiniPay shell
- mock recommendation flow
- clear product framing
- adapter interface ready
- one real integration selected and scoped

## Handoff note

Do not start by building many agents. Start by proving one user flow:

`open app -> get recommendation -> take action`

Everything else should support that path.
