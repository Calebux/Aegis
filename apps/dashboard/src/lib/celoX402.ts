export const CELO_CHAIN = "celo";
export const CELO_NETWORK = process.env.CALAGENT_CELO_NETWORK ?? "alfajores";
export const CELO_CHAIN_ID = CELO_NETWORK === "mainnet" ? 42220 : 44787;
export const CELO_NETWORK_ID = `eip155:${CELO_CHAIN_ID}`;

export const CELO_RPC_URL =
  process.env.CELO_RPC_URL ??
  (CELO_NETWORK === "mainnet"
    ? "https://forno.celo.org"
    : "https://alfajores-forno.celo-testnet.org");

export const CELO_STABLE_ASSET = process.env.CALAGENT_CELO_ASSET ?? "cUSD";
export const CELO_STABLE_ASSET_DECIMALS = Number(
  process.env.CALAGENT_CELO_ASSET_DECIMALS ?? 18
);
export const CELO_STABLE_ASSET_CONTRACT =
  process.env.CALAGENT_CELO_ASSET_CONTRACT ??
  (CELO_NETWORK === "mainnet"
    ? "0x765DE816845861e75A25fCA122bb6898B8B1282a"
    : "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1");

export const CALAGENT_CELO_AGENT_PRICE =
  process.env.CALAGENT_CELO_AGENT_PRICE ?? "0.001";

export function celoPaymentReceiver(): string | undefined {
  return process.env.CALAGENT_CELO_X402_RECEIVER ?? process.env.CALAGENT_EVM_X402_RECEIVER;
}

/**
 * Celo x402 enforcement is active only when both a payment receiver AND a
 * facilitator URL are configured. Unlike Stellar (which uses a manual flag),
 * Celo enforcement is self-describing: the two env vars are the gate.
 */
export function celoX402Enforced(): boolean {
  return !!(celoPaymentReceiver() && celoFacilitatorUrl());
}

export function celoFacilitatorUrl(): string | undefined {
  return (
    process.env.CALAGENT_CELO_X402_FACILITATOR_URL ??
    process.env.CALAGENT_EVM_X402_FACILITATOR_URL
  );
}

export function celoAmountToBaseUnits(amount: string): string {
  const normalized = amount
    .replace(/^\$/, "")
    .replace(new RegExp(`\\s*${CELO_STABLE_ASSET}$`, "i"), "")
    .trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid Celo ${CELO_STABLE_ASSET} amount: ${amount}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const padded = fraction
    .padEnd(CELO_STABLE_ASSET_DECIMALS, "0")
    .slice(0, CELO_STABLE_ASSET_DECIMALS);
  return `${whole}${padded}`.replace(/^0+/, "") || "0";
}
