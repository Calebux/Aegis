/**
 * Celo payment utilities for @calagent/agent-kit.
 *
 * Celo equivalent of payments.ts — uses viem ERC-20 transfer on cUSD
 * rather than Stellar native XLM. Supports x402 probe→pay→retry flow
 * and agent-to-agent cUSD settlement.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { celo, celoAlfajores } from "viem/chains";

// ── Constants ─────────────────────────────────────────────────────────────────

const CUSD_MAINNET = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as const;
const CUSD_ALFAJORES = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1" as const;
const CUSD_DECIMALS = 18;

const CUSD_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getViemChain(rpcUrl?: string) {
  const network =
    process.env.CALAGENT_CELO_NETWORK ?? process.env.CELO_NETWORK ?? "alfajores";
  if (network === "mainnet") return celo;
  return celoAlfajores;
}

function getCusdAddress(): Address {
  const network =
    process.env.CALAGENT_CELO_NETWORK ?? process.env.CELO_NETWORK ?? "alfajores";
  return (network === "mainnet" ? CUSD_MAINNET : CUSD_ALFAJORES) as Address;
}

function getRpcTransport(rpcUrl?: string) {
  const url =
    rpcUrl ??
    process.env.CELO_RPC_URL ??
    (getViemChain().id === 42220
      ? "https://forno.celo.org"
      : "https://alfajores-forno.celo-testnet.org");
  return http(url);
}

// ── Payment primitives ────────────────────────────────────────────────────────

/**
 * Transfer cUSD from `account` to `destination`.
 * Returns the transaction hash after the receipt is confirmed.
 */
export async function submitCusdPayment(
  account: Account,
  destination: Address,
  amountCusd: string,
  rpcUrl?: string
): Promise<Hex> {
  const chain = getViemChain(rpcUrl);
  const transport = getRpcTransport(rpcUrl);
  const cusdAddress = getCusdAddress();
  const amount = parseUnits(amountCusd, CUSD_DECIMALS);

  const walletClient = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  const txHash = await walletClient.writeContract({
    address: cusdAddress,
    abi: CUSD_ABI,
    functionName: "transfer",
    args: [destination, amount],
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

interface CeloPaymentRequired {
  payTo: Address;
  /** Amount in wei (bigint-string) */
  amountWei?: string;
  /** Fallback: amount in cUSD decimal string */
  amount?: string;
  nonce: string;
  contract?: string;
}

/**
 * Probe `url`. If the server returns HTTP 402, pay cUSD and retry.
 * Falls back transparently when the server returns 200 directly (dev mode)
 * or when CALAGENT_CELO_X402_RECEIVER is not set.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function fetchWithRetryInternal(
  url: string | URL | Request,
  init?: RequestInit,
  maxAttempts = 3
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (resp.ok || !RETRYABLE_STATUS.has(resp.status) || attempt === maxAttempts) return resp;
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
  }
  throw lastError;
}

export async function payAndFetchCelo<T = unknown>(
  url: string,
  account: Account,
  txHashesArr: string[],
  rpcUrl?: string
): Promise<{ data: T; paymentMode: "x402" | "dev" }> {
  const probe = await fetchWithRetryInternal(url);

  // Dev mode: server skipped the payment gate
  if (probe.ok) {
    return { data: (await probe.json()) as T, paymentMode: "dev" };
  }

  if (probe.status !== 402) {
    throw new Error(`Unexpected status ${probe.status} from ${url}`);
  }

  const payReq = (await probe.json()) as CeloPaymentRequired;
  const receiver = process.env.CALAGENT_CELO_X402_RECEIVER;

  // Dev mode: no receiver configured → pass through
  if (!receiver) {
    const retryResp = await fetchWithRetryInternal(url, {
      headers: { "x-payment-tx-hash": "dev-no-payment" },
    });
    if (!retryResp.ok) throw new Error(`Data fetch failed: ${retryResp.status}`);
    return { data: (await retryResp.json()) as T, paymentMode: "dev" };
  }

  const payTo = (payReq.payTo ?? receiver) as Address;

  // Convert amount: prefer amountWei (atomic units), fall back to decimal string
  let amountCusd: string;
  if (payReq.amountWei) {
    const wei = BigInt(payReq.amountWei);
    amountCusd = (Number(wei) / 10 ** CUSD_DECIMALS).toFixed(6);
  } else {
    amountCusd = payReq.amount ?? "0.001";
  }

  // NOT retried — submitCusdPayment is not idempotent
  const txHash = await submitCusdPayment(account, payTo, amountCusd, rpcUrl);
  txHashesArr.push(txHash);

  const resp = await fetchWithRetryInternal(url, {
    headers: {
      "x-payment-tx-hash": txHash,
      "x-payment-nonce": payReq.nonce ?? "",
    },
  });

  if (!resp.ok) {
    throw new Error(`Data fetch failed after cUSD payment: ${resp.status}`);
  }

  return { data: (await resp.json()) as T, paymentMode: "x402" };
}

/**
 * Fire-and-forget cUSD payment from one agent to another.
 * Non-fatal — returns an empty string on failure.
 */
export async function celoAgentToAgentPayment(
  from: Account,
  to: Address,
  amountCusd: string,
  rpcUrl?: string
): Promise<string> {
  try {
    const txHash = await submitCusdPayment(from, to, amountCusd, rpcUrl);
    return txHash;
  } catch {
    return "";
  }
}
