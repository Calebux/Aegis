/**
 * Scout Agent — standalone process
 *
 * Listens for task instructions from the orchestrator (via IPC or HTTP),
 * performs x402-paid web searches using the Linkup SDK, and returns results.
 */

import "dotenv/config";
import { keypairFromSecret, generateKeypair, fundTestnetAccount } from "@aegis/shared";

async function main(): Promise<void> {
  console.log("[scout] Starting…");

  let secretKey = process.env.SCOUT_SECRET_KEY;
  if (!secretKey) {
    console.log("[scout] No wallet found — generating new keypair…");
    const kp = generateKeypair();
    secretKey = kp.secretKey;
    console.log("[scout] New public key:", kp.publicKey);
    console.log("[scout] Funding via Friendbot…");
    await fundTestnetAccount(kp.publicKey);
    console.log("[scout] Funded. Add to .env: SCOUT_SECRET_KEY=" + kp.secretKey);
  }

  const keypair = keypairFromSecret(secretKey);
  console.log("[scout] Wallet:", keypair.publicKey());

  // TODO: register with orchestrator
  // TODO: start listening for task instructions
  // TODO: initialise Linkup client
  // TODO: wire up x402 payment middleware

  console.log("[scout] Ready (stub — no tasks will be processed yet)");
}

main().catch((err) => {
  console.error("[scout] Fatal:", err);
  process.exit(1);
});
