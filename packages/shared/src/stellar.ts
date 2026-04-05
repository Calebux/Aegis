/**
 * Stellar / Soroban helpers shared by orchestrator and agents.
 */

import {
  Horizon,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// Network config
// ---------------------------------------------------------------------------

export const TESTNET_CONFIG = {
  networkPassphrase: Networks.TESTNET,
  horizonUrl: process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
} as const;

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

export function getHorizonServer(): Horizon.Server {
  return new Horizon.Server(TESTNET_CONFIG.horizonUrl);
}

export function getSorobanRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(TESTNET_CONFIG.rpcUrl);
}

// ---------------------------------------------------------------------------
// Wallet helpers
// ---------------------------------------------------------------------------

/** Generate a new random keypair (for dev / first-run wallet creation). */
export function generateKeypair(): { publicKey: string; secretKey: string } {
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secretKey: kp.secret() };
}

/** Load a keypair from a secret key string. */
export function keypairFromSecret(secret: string): Keypair {
  return Keypair.fromSecret(secret);
}

/** Fetch XLM balance for an account. Returns "0" if account not found. */
export async function getXlmBalance(publicKey: string): Promise<string> {
  const server = getHorizonServer();
  try {
    const account = await server.loadAccount(publicKey);
    const nativeBalance = account.balances.find(
      (b) => b.asset_type === "native"
    );
    return nativeBalance?.balance ?? "0";
  } catch {
    return "0";
  }
}

/** Fund an account on testnet via Friendbot. */
export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
  );
  if (!response.ok) {
    throw new Error(`Friendbot funding failed: ${response.statusText}`);
  }
}

/** Build a basic transaction builder for an account. */
export async function buildTransactionBuilder(
  sourcePublicKey: string
): Promise<TransactionBuilder> {
  const server = getHorizonServer();
  const account = await server.loadAccount(sourcePublicKey);
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_CONFIG.networkPassphrase,
  });
}
