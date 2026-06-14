/**
 * Executor Agent — Consensus Notary (Infrastructure)
 *
 * The final step in the Cal-AgentKit pipeline. Once the agent swarm reaches
 * consensus, the Notary does two things in parallel:
 *
 *   1. SOROBAN NOTARISATION
 *      SHA-256 hashes the agreed output, signs with its Stellar keypair,
 *      and stores the signature + hash on the Shield Contract permanently.
 *      Any third party can verify the AI conclusion without trusting Cal-AgentKit.
 *
 *   2. DEX SETTLEMENT
 *      Executes a small XLM → USDC swap on the native Stellar DEX as a
 *      pipeline completion marker. Demonstrates Stellar's full stack:
 *      Soroban (verification) + DEX (settlement) in one agent.
 *      Falls back to a limit order if no liquidity path exists on testnet.
 *
 * Published payload: executor:complete → { notaryTxHash, dexTxHash, payloadHash }
 */

import { createHash } from "node:crypto";
import {
  Keypair,
  SorobanRpc,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Asset,
  Memo,
} from "@stellar/stellar-sdk";
import { getHorizonServer } from "@calagent/shared";
import { ShieldContract, type SettlementProvider } from "@calebux/agent-kit";
import { bus } from "../lib/bus.js";
import { withTimeout } from "../lib/timeout.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** USDC on Stellar testnet (Circle) */
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

/** Settlement amount — small enough to be noise-free, visible enough to show DEX usage */
const SETTLE_XLM = "0.01";

// ── Helpers ───────────────────────────────────────────────────────────────────

function networkPassphrase(): string {
  const net = process.env.STELLAR_NETWORK ?? "testnet";
  if (net === "futurenet") return Networks.FUTURENET;
  if (net === "testnet")   return Networks.TESTNET;
  return Networks.PUBLIC;
}

/**
 * Execute a tiny settlement swap on Stellar DEX: XLM → USDC.
 * Tries pathPaymentStrictSend first (immediate market swap).
 * Falls back to manageSellOffer (limit order) if no path exists on testnet.
 */
async function settleDex(keypair: Keypair): Promise<string> {
  const server = getHorizonServer();
  const account = await server.loadAccount(keypair.publicKey());

  // Attempt 1: pathPaymentStrictSend — actual market swap
  try {
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(Operation.changeTrust({ asset: USDC, limit: "1000" }))
      .addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset:   Asset.native(),
          sendAmount:  SETTLE_XLM,
          destination: keypair.publicKey(),
          destAsset:   USDC,
          destMin:     "0.000001",
          path:        [],
        })
      )
      .addMemo(Memo.text("calagent:settle"))
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const result = await server.submitTransaction(tx);
    return (result as unknown as { hash: string }).hash;
  } catch {
    // fall through to limit order
  }

  // Attempt 2: manageSellOffer — limit order, always succeeds on-chain
  const account2 = await server.loadAccount(keypair.publicKey());
  const tx2 = new TransactionBuilder(account2, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(Operation.changeTrust({ asset: USDC, limit: "1000" }))
    .addOperation(
      Operation.manageSellOffer({
        selling: Asset.native(),
        buying:  USDC,
        amount:  SETTLE_XLM,
        price:   "0.14",
        offerId: 0,
      })
    )
    .addMemo(Memo.text("calagent:settle"))
    .setTimeout(30)
    .build();

  tx2.sign(keypair);
  const result2 = await server.submitTransaction(tx2);
  return (result2 as unknown as { hash: string }).hash;
}

// ── ExecutorAgent ─────────────────────────────────────────────────────────────

export class ExecutorAgent {
  readonly id = "executor";
  private settlementProvider?: SettlementProvider;

  /** Optionally inject a multi-chain settlement provider (Base, Celo, etc.) */
  setSettlementProvider(provider: SettlementProvider): void {
    this.settlementProvider = provider;
  }

  wire(runId: string, keypair: Keypair): void {
    bus.subscribe(
      "consensus:reached",
      async (msg) => {
        if (msg.runId !== runId) return;
        if (msg.agentId !== "consensus-manager") return;

        const { agreedOutput } = msg.payload as { agreedOutput: string };
        console.log("[notary] Consensus received — notarising + settling…");

        let notaryTxHash = "";
        let dexTxHash    = "";
        let payloadHash  = "";

        // Run Soroban notarisation and DEX settlement in parallel (with per-op timeouts)
        const [notaryResult, dexResult] = await Promise.allSettled([
          // ── Soroban notarisation (60s timeout) ─────────────────────────────
          withTimeout(async () => {
            const hash      = createHash("sha256").update(agreedOutput).digest();
            payloadHash     = hash.toString("hex");
            const signature = keypair.sign(hash).toString("hex");

            const contractId = process.env.SHIELD_CONTRACT_ID ?? "";
            const rpcUrl     = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

            if (!contractId) {
              console.warn("[notary] SHIELD_CONTRACT_ID not set — skipping");
              return "";
            }

            const shield = new ShieldContract(
              contractId,
              new SorobanRpc.Server(rpcUrl),
              keypair
            );

            return shield.storeSignature({ agentId: "consensus-notary", runId, signature, payloadHash });
          }, 60_000, "executor:soroban"),

          // ── DEX / multi-chain settlement (60s timeout) ──────────────────────
          withTimeout(async () => {
            // Use multi-chain provider if configured, otherwise default to Stellar DEX
            if (this.settlementProvider) {
              const result = await this.settlementProvider.settle({
                from: keypair.publicKey(),
                to: keypair.publicKey(), // self-settle as pipeline marker
                amount: SETTLE_XLM,
                memo: "calagent:settle",
              });
              return result.txHash;
            }
            return settleDex(keypair);
          }, 60_000, "executor:settlement"),
        ]);

        if (notaryResult.status === "fulfilled") {
          notaryTxHash = notaryResult.value;
          console.log(`[notary] ✅ Soroban — tx:${notaryTxHash.slice(0, 12)}…`);
        } else {
          console.warn("[notary] Soroban notarisation failed (non-fatal):", notaryResult.reason);
        }

        if (dexResult.status === "fulfilled") {
          dexTxHash = dexResult.value;
          console.log(`[notary] ✅ DEX settlement — tx:${dexTxHash.slice(0, 12)}…`);
        } else {
          console.warn("[notary] DEX settlement failed (non-fatal):", dexResult.reason);
        }

        const allTxHashes = [notaryTxHash, dexTxHash].filter(Boolean);

        bus.publish({
          topic:   "executor:complete",
          agentId: this.id,
          runId,
          payload: {
            notaryTxHash,
            dexTxHash,
            payloadHash,
            runId,
            amountSpent: Math.round(parseFloat(SETTLE_XLM) * 1e7),
            txHashes:    allTxHashes,
            paymentMode: "notary",
          },
          confidence: 1.0,
          timestamp:  Date.now(),
        });
      },
      runId
    );
  }
}
