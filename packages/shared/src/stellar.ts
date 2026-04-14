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
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
} as const;

// ---------------------------------------------------------------------------
// Dynamic network helpers (read env at call time, not module load time)
// ---------------------------------------------------------------------------

export function getNetworkPassphrase(): string {
  const net = process.env.STELLAR_NETWORK ?? "testnet";
  if (net === "futurenet") return Networks.FUTURENET;
  if (net === "mainnet" || net === "public") return Networks.PUBLIC;
  return Networks.TESTNET;
}

export function getHorizonUrl(): string {
  return process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
}

export function getRpcUrl(): string {
  return process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
}

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

export function getHorizonServer(): Horizon.Server {
  return new Horizon.Server(getHorizonUrl());
}

export function getSorobanRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(getRpcUrl());
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

/** Fund an account via Friendbot (testnet or futurenet). */
export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  const friendbotUrl =
    network === "futurenet"
      ? `https://friendbot-futurenet.stellar.org?addr=${encodeURIComponent(publicKey)}`
      : `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`;
  const response = await fetch(friendbotUrl);
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
    networkPassphrase: getNetworkPassphrase(),
  });
}
