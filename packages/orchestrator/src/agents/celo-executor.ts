/**
 * Celo Executor Agent — Celo Consensus Notary
 *
 * The final step in the Celo pipeline. Once consensus is reached, the Notary:
 *
 *   1. SHA-256 hashes the agreed output → bytes32 payloadHash
 *   2. Calls AegisCeloRegistry.setManifestHash("celo-pipeline-notary", hash)
 *      — permanent on-chain attestation on Celo
 *   3. Calls recordSuccess("celo-pipeline-notary") — reputation update
 *
 * Published payload: executor:complete → { notaryTxHash, payloadHash, paymentMode: "celo-notary" }
 */

import { createHash } from "node:crypto";
import type { Account } from "viem";
import { CeloIdentityRegistry } from "@calebux/agent-kit";
import { bus } from "../lib/bus.js";

// ── CeloExecutorAgent ─────────────────────────────────────────────────────────

export class CeloExecutorAgent {
  readonly id = "executor";
  private account: Account | null = null;

  private buildRegistry(): CeloIdentityRegistry | null {
    const addr = process.env.CELO_REGISTRY_ADDRESS;
    const key = process.env.CELO_DEPLOYER_PRIVATE_KEY;
    if (!addr || !key) return null;
    return new CeloIdentityRegistry(
      addr,
      key,
      process.env.CELO_RPC_URL,
      process.env.AEGIS_CELO_NETWORK
    );
  }

  wire(runId: string, account?: Account): void {
    if (account) this.account = account;

    bus.subscribe(
      "consensus:reached",
      async (msg) => {
        if (msg.runId !== runId) return;
        if (msg.agentId !== "consensus-manager") return;

        const { agreedOutput } = msg.payload as { agreedOutput: string };
        console.log("[celo-notary] Consensus received — attesting on Celo…");

        const payloadHash = createHash("sha256")
          .update(agreedOutput)
          .digest("hex");

        const registry = this.buildRegistry();
        let notaryTxHash = "";

        if (registry) {
          try {
            // Store payload hash in AegisCeloRegistry
            notaryTxHash = await registry.setManifestHash(
              "celo-pipeline-notary",
              payloadHash
            );
            console.log(
              `[celo-notary] ✅ Manifest hash stored — tx:${notaryTxHash.slice(0, 12)}…`
            );
          } catch (err) {
            console.warn("[celo-notary] setManifestHash failed (non-fatal):", err);
          }

          // Record success (fire-and-forget, non-blocking)
          void registry.recordSuccess("celo-pipeline-notary").catch(() => {});
        } else {
          console.log(
            "[celo-notary] CELO_REGISTRY_ADDRESS or CELO_DEPLOYER_PRIVATE_KEY not set — skipping notarisation"
          );
        }

        const walletAddress = this.account?.address ?? "";
        const allTxHashes = [notaryTxHash].filter(Boolean);

        bus.publish({
          topic: "executor:complete",
          agentId: this.id,
          runId,
          payload: {
            notaryTxHash,
            dexTxHash: "", // No DEX on Celo — attestation only
            payloadHash: `0x${payloadHash}`,
            runId,
            walletAddress,
            amountSpent: 0,
            txHashes: allTxHashes,
            paymentMode: "celo-notary",
            chain: "celo",
          },
          confidence: 1.0,
          timestamp: Date.now(),
        });
      },
      runId
    );
  }
}
