import {
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Asset,
  Memo,
} from "@stellar/stellar-sdk";
import { getHorizonServer } from "@aegis/shared";

function networkPassphrase(): string {
  const net = process.env.STELLAR_NETWORK ?? "testnet";
  if (net === "futurenet") return Networks.FUTURENET;
  if (net === "testnet") return Networks.TESTNET;
  return Networks.PUBLIC;
}

/** Submit a native XLM payment on Stellar; returns the transaction hash. */
export async function submitXlmPayment(
  keypair: Keypair,
  destination: string,
  amountXlm: string
): Promise<string> {
  const server = getHorizonServer();
  const account = await server.loadAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      Operation.payment({ destination, asset: Asset.native(), amount: amountXlm })
    )
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return (result as unknown as { hash: string }).hash;
}

interface PaymentRequired {
  payTo: string;
  amount: string;
  nonce: string;
}

/**
 * Probe a URL. If the server returns HTTP 402, submit a real Stellar XLM
 * payment and retry with the payment receipt as headers.
 * Falls back transparently when the server returns 200 directly (dev mode).
 */
export async function payAndFetch<T = unknown>(
  url: string,
  keypair: Keypair,
  txHashes: string[]
): Promise<{ data: T; paymentMode: "x402" | "dev" }> {
  const probe = await fetch(url);

  if (probe.ok) {
    return { data: (await probe.json()) as T, paymentMode: "dev" };
  }

  if (probe.status !== 402) {
    throw new Error(`Unexpected status ${probe.status} from ${url}`);
  }

  const { payTo, amount, nonce } = (await probe.json()) as PaymentRequired;
  const txHash = await submitXlmPayment(keypair, payTo, amount);
  txHashes.push(txHash);

  const resp = await fetch(url, {
    headers: { "x-payment-tx-hash": txHash, "x-payment-nonce": nonce },
  });
  if (!resp.ok) {
    throw new Error(`Data fetch failed after payment: ${resp.status}`);
  }

  return { data: (await resp.json()) as T, paymentMode: "x402" };
}

/**
 * Send a direct XLM payment from one agent to another with an on-chain memo.
 * Non-fatal — returns an empty string on failure.
 */
export async function agentToAgentPayment(
  fromKeypair: Keypair,
  toAddress: string,
  amountXlm: string,
  memo: string
): Promise<string> {
  try {
    const server = getHorizonServer();
    const account = await server.loadAccount(fromKeypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        Operation.payment({ destination: toAddress, asset: Asset.native(), amount: amountXlm })
      )
      .addMemo(Memo.text(memo.slice(0, 28)))
      .setTimeout(30)
      .build();
    tx.sign(fromKeypair);
    const result = await server.submitTransaction(tx);
    return (result as unknown as { hash: string }).hash;
  } catch {
    return "";
  }
}
