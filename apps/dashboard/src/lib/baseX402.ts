/**
 * Base x402 enforcement — same pattern as celoX402.ts.
 *
 * Env vars:
 *   BASE_RPC_URL — Base JSON-RPC endpoint
 *   BASE_NETWORK — "mainnet" or "sepolia" (default: "mainnet")
 *   CALAGENT_BASE_X402_RECEIVER — Base address receiving USDC payments
 *   CALAGENT_BASE_X402_FACILITATOR_URL — x402 facilitator for Base
 */

export const BASE_CHAIN = "base";
export const BASE_NETWORK = process.env.BASE_NETWORK ?? "mainnet";
export const BASE_CHAIN_ID = BASE_NETWORK === "mainnet" ? 8453 : 84532;
export const BASE_NETWORK_ID = `eip155:${BASE_CHAIN_ID}`;

export const BASE_RPC_URL =
  process.env.BASE_RPC_URL ??
  (BASE_NETWORK === "mainnet"
    ? "https://mainnet.base.org"
    : "https://sepolia.base.org");

export const BASE_USDC_ASSET = "USDC";
export const BASE_USDC_DECIMALS = 6;
export const BASE_USDC_CONTRACT =
  BASE_NETWORK === "mainnet"
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const CALAGENT_BASE_AGENT_PRICE =
  process.env.CALAGENT_BASE_AGENT_PRICE ?? "0.001";

export function basePaymentReceiver(): string | undefined {
  return process.env.CALAGENT_BASE_X402_RECEIVER ?? process.env.CALAGENT_EVM_X402_RECEIVER;
}

/**
 * Base x402 enforcement is active only when both a payment receiver AND a
 * facilitator URL are configured. Without a facilitator, there's no way to
 * verify the payment header on-chain.
 */
export function baseX402Enforced(): boolean {
  return Boolean(basePaymentReceiver() && baseFacilitatorUrl());
}

export function baseFacilitatorUrl(): string | undefined {
  return process.env.CALAGENT_BASE_X402_FACILITATOR_URL;
}

/** Convert a decimal USDC amount to base units (6 decimals) */
export function baseAmountToBaseUnits(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return "0";
  return Math.round(num * 10 ** BASE_USDC_DECIMALS).toString();
}
