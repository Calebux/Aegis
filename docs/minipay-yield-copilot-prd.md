# MiniPay Yield Copilot PRD

## Summary

Build a MiniPay-first Mini App that helps users decide where to park idle
stablecoins. The product should compare keeping funds liquid in MiniPay,
using MiniPay-native earning options, and moving funds into approved
third-party yield venues on Celo.

This is not a generic yield aggregator. It is a guided decision and execution
product for MiniPay users.

## Why this product

MiniPay already offers native rewards and also appears to allow at least one
third-party yield Mini App. That means a new product needs to differentiate on:

- decision quality
- trust and risk explanation
- simple mobile execution
- ongoing monitoring after deposit

## Product thesis

Most users do not want to compare protocols, read audits, or interpret APY
tables. They want one clear answer:

"Given my balance, time horizon, and need for liquidity, where should I put my
stablecoins right now?"

Yield Copilot should answer that question in plain language and let the user
act immediately.

## Target user

- MiniPay users holding stablecoins as savings
- Users in inflation-sensitive markets who want yield without heavy DeFi UX
- Users who care more about safety and clarity than maximum raw APY

## Primary jobs to be done

1. Help me decide whether to keep funds liquid or earn yield.
2. Help me choose between MiniPay-native and third-party options.
3. Explain risks simply before I deposit.
4. Let me deposit and withdraw with minimal friction.
5. Warn me when my current option is no longer the best fit.

## MVP scope

### In scope

- MiniPay Mini App frontend
- wallet auto-connect inside MiniPay
- stablecoin-only flows
- recommendation engine for a short list of yield options
- plain-language risk summary
- user-approved deposit flow
- position monitoring and alerts in-app

### Out of scope

- autonomous fund movement
- leveraged strategies
- volatile tokens
- cross-chain routing
- support for many protocols at launch
- social features
- custom smart contracts unless an integration requires them

## Supported assets in v1

- `USDT`
- `USDC`
- optionally `USDm`

## Supported destinations in v1

- `Stay liquid in wallet`
- `MiniPay Boost` if available to the user
- `Kiln` inside MiniPay
- at most one additional direct DeFi option if the integration is simple

## Product principles

- recommend, do not over-automate
- mobile-first at every step
- explain risk before APY
- prefer trusted, simple venues over long-tail yield
- keep the first-time user flow under 3 screens before action

## Core user flow

1. User opens the Mini App inside MiniPay.
2. Wallet auto-connects.
3. User selects a goal:
   - `Keep flexible`
   - `Earn more`
   - `Save safely`
4. User enters:
   - token
   - amount
   - time horizon
   - risk comfort
5. Copilot returns:
   - one recommended option
   - one backup option
   - why this recommendation fits
   - major risks
6. User taps `Continue`.
7. App takes user into the deposit or routing flow.
8. App shows active position and ongoing status.

## Agent model

### Yield Scout

Discovers supported yield destinations and current rates from your approved
source list.

### Risk Guard

Produces a simple risk profile:

- protocol risk
- liquidity risk
- lockup risk
- token risk
- concentration risk
- rate volatility

### Goal Planner

Maps user goals and constraints to a recommendation.

### Execution Agent

Translates the recommendation into a concrete transaction path and prepares the
wallet action.

### Monitor Agent

Tracks yield changes and important state changes after deposit.

## Recommendation model

The recommendation engine in v1 should be intentionally simple and auditable.
Avoid opaque scoring at launch.

Inputs:

- amount
- token
- time horizon
- flexibility need
- risk comfort
- supported venue metadata
- current yield
- availability constraints

Outputs:

- recommended venue
- backup venue
- short explanation
- risk label
- action CTA

## Risk labels

Use a narrow label system:

- `Low complexity`
- `Moderate complexity`
- `Higher protocol risk`

Each label must be backed by short reasons, not just a badge.

## Differentiation

The product should win on:

- better decision support than static yield cards
- better user comprehension than raw DeFi dashboards
- stronger post-deposit monitoring than one-off deposit apps

## Key screens

- home / balance intake
- goal selection
- recommendation result
- risk detail
- execution confirmation
- active position
- alerts / rebalance suggestions

## Success metrics

- first recommendation completion rate
- recommendation-to-deposit conversion rate
- withdrawal completion rate
- 7-day retained active savers
- share of users who revisit after first deposit
- percentage of recommendations users follow

## Compliance and trust requirements

- do not present advice as guaranteed returns
- clearly mark third-party venues
- clearly explain that yields vary
- provide Terms of Service and Privacy Policy in-app
- provide support contact in-app
- verify any user-facing contracts on Celoscan if used

## Open product questions

1. Will v1 route into third-party Mini Apps, direct contracts, or both?
2. How much personalized recommendation logic should run client-side versus API?
3. Should alerts be purely in-app first, or also via off-app channels later?
4. Should `MiniPay Boost` be treated as a venue or as a baseline benchmark?

## v1 release criteria

- works inside MiniPay on a real device
- auto-connect works without a connect button
- at least 2 real yield destinations supported
- recommendation logic is deterministic and documented
- deposit flow works end-to-end for supported venues
- errors are understandable on mobile
- legal and support pages are ready for submission
