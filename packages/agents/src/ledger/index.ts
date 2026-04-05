/**
 * Ledger Agent — standalone process
 *
 * Wraps the Stellar Horizon API behind a local x402-gated HTTP endpoint.
 * The orchestrator's LedgerAgent client pays per request; the spend is
 * deducted from the ledger agent's Shield Contract allowance.
 */

import "dotenv/config";
import {
  keypairFromSecret,
  generateKeypair,
  fundTestnetAccount,
  getHorizonServer,
} from "@aegis/shared";

// TODO: replace with express or hono once logic is implemented
async function main(): Promise<void> {
  console.log("[ledger] Starting…");

  let secretKey = process.env.LEDGER_SECRET_KEY;
  if (!secretKey) {
    console.log("[ledger] No wallet found — generating new keypair…");
    const kp = generateKeypair();
    secretKey = kp.secretKey;
    console.log("[ledger] New public key:", kp.publicKey);
    await fundTestnetAccount(kp.publicKey);
    console.log("[ledger] Funded. Add to .env: LEDGER_SECRET_KEY=" + kp.secretKey);
  }

  const keypair = keypairFromSecret(secretKey);
  console.log("[ledger] Wallet:", keypair.publicKey());

  // Smoke-test Horizon connection
  const server = getHorizonServer();
  const ledgerPage = await server.ledgers().order("desc").limit(1).call();
  console.log(
    "[ledger] Latest ledger sequence:",
    ledgerPage.records[0]?.sequence
  );

  // TODO: start local x402-gated HTTP server
  // TODO: implement route handlers for ledger, accounts, transactions, offers

  console.log("[ledger] Ready (stub — no HTTP server yet)");
}

main().catch((err) => {
  console.error("[ledger] Fatal:", err);
  process.exit(1);
});
