/**
 * Signal Agent — standalone process
 *
 * Aggregates market signals (price feeds, DEX trading volumes, order-book
 * depth) from external providers accessed via x402 micropayments.
 */

import "dotenv/config";
import { keypairFromSecret, generateKeypair, fundTestnetAccount } from "@aegis/shared";

async function main(): Promise<void> {
  console.log("[signal] Starting…");

  let secretKey = process.env.SIGNAL_SECRET_KEY;
  if (!secretKey) {
    console.log("[signal] No wallet found — generating new keypair…");
    const kp = generateKeypair();
    secretKey = kp.secretKey;
    console.log("[signal] New public key:", kp.publicKey);
    await fundTestnetAccount(kp.publicKey);
    console.log("[signal] Funded. Add to .env: SIGNAL_SECRET_KEY=" + kp.secretKey);
  }

  const keypair = keypairFromSecret(secretKey);
  console.log("[signal] Wallet:", keypair.publicKey());

  // TODO: identify signal data sources (StellarTerm, SDEX, CoinGecko, etc.)
  // TODO: wire x402 payment middleware for each provider
  // TODO: start listening for task instructions from orchestrator

  console.log("[signal] Ready (stub — no tasks will be processed yet)");
}

main().catch((err) => {
  console.error("[signal] Fatal:", err);
  process.exit(1);
});
