/**
 * Multi-Chain Settlement Interface
 *
 * Abstracts chain-specific settlement behind a common interface.
 * Supports Stellar, Celo, and Base (USDC). The chain selector picks
 * the optimal chain based on user preference, cost, and speed.
 */

// ── Settlement Types ──────────────────────────────────────────────────────────

export type SettlementChain = "stellar" | "celo" | "base";

export interface SettlementParams {
  from: string;
  to: string;
  /** Amount in human-readable form, e.g. "0.01" */
  amount: string;
  memo?: string;
}

export interface SettlementResult {
  chain: SettlementChain;
  txHash: string;
  /** Amount settled in human-readable form */
  amount: string;
  /** Asset settled, e.g. "XLM", "cUSD", "USDC" */
  asset: string;
  timestamp: string;
}

export interface CostEstimate {
  chain: SettlementChain;
  /** Estimated fee in the chain's native asset */
  feeEstimate: string;
  /** Estimated confirmation time in ms */
  timeEstimateMs: number;
  /** Asset used for settlement */
  asset: string;
}

export interface SettlementProvider {
  chain: SettlementChain;
  /** Settle a payment on this chain */
  settle(params: SettlementParams): Promise<SettlementResult>;
  /** Estimate the cost of a settlement */
  estimateCost(amount: string): Promise<CostEstimate>;
}

// ── Chain Selector ────────────────────────────────────────────────────────────

export type ChainPreference = "lowest-fee" | "fastest" | SettlementChain;

/**
 * Pick the optimal settlement chain based on preference and cost estimates.
 *
 * Priority:
 *   1. Explicit chain name → use that chain
 *   2. "lowest-fee" → pick cheapest estimate
 *   3. "fastest" → pick fastest estimate
 *
 * Falls back to "stellar" if no providers or estimates fail.
 */
export async function selectChain(
  providers: SettlementProvider[],
  amount: string,
  preference?: ChainPreference
): Promise<SettlementProvider> {
  if (!preference || preference === "stellar" || preference === "celo" || preference === "base") {
    const explicit = providers.find((p) => p.chain === (preference ?? "stellar"));
    if (explicit) return explicit;
  }

  // Get cost estimates from all providers
  const estimates = await Promise.allSettled(
    providers.map(async (p) => ({ provider: p, estimate: await p.estimateCost(amount) }))
  );

  const successful = estimates
    .filter((e): e is PromiseFulfilledResult<{ provider: SettlementProvider; estimate: CostEstimate }> =>
      e.status === "fulfilled"
    )
    .map((e) => e.value);

  if (successful.length === 0) {
    return providers[0]!; // fallback
  }

  if (preference === "lowest-fee") {
    successful.sort((a, b) => parseFloat(a.estimate.feeEstimate) - parseFloat(b.estimate.feeEstimate));
  } else if (preference === "fastest") {
    successful.sort((a, b) => a.estimate.timeEstimateMs - b.estimate.timeEstimateMs);
  }

  return successful[0]!.provider;
}

/**
 * Get the default settlement chain preference from env.
 * Reads SETTLEMENT_CHAIN; defaults to "stellar" if unset.
 */
export function getDefaultChainPreference(): ChainPreference {
  const env = process.env.SETTLEMENT_CHAIN;
  if (env === "celo" || env === "base" || env === "stellar" || env === "lowest-fee" || env === "fastest") {
    return env;
  }
  return "stellar";
}
