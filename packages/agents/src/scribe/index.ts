/**
 * Scribe Agent — standalone process
 *
 * Accepts structured research payloads from the orchestrator and uses
 * the Anthropic Claude API to synthesise a polished final report.
 * API call cost is tracked as spend against the Scribe's Shield Contract cap.
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { keypairFromSecret, generateKeypair, fundTestnetAccount } from "@calagent/shared";

async function main(): Promise<void> {
  console.log("[scribe] Starting…");

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  let secretKey = process.env.SCRIBE_SECRET_KEY;
  if (!secretKey) {
    console.log("[scribe] No wallet found — generating new keypair…");
    const kp = generateKeypair();
    secretKey = kp.secretKey;
    console.log("[scribe] New public key:", kp.publicKey);
    await fundTestnetAccount(kp.publicKey);
    console.log("[scribe] Funded. Add to .env: SCRIBE_SECRET_KEY=" + kp.secretKey);
  }

  const keypair = keypairFromSecret(secretKey);
  console.log("[scribe] Wallet:", keypair.publicKey());

  const _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // TODO: start listening for synthesis requests from orchestrator
  // TODO: implement report generation using claude-opus-4-6 or claude-sonnet-4-6
  // TODO: track Claude API token costs and map to Stellar stroops for spend accounting

  console.log("[scribe] Ready (stub — no tasks will be processed yet)");
}

main().catch((err) => {
  console.error("[scribe] Fatal:", err);
  process.exit(1);
});
