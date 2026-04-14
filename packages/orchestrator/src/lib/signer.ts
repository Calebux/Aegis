/**
 * Agent Output Signer (Upgrade 7)
 *
 * Every agent signs its output with its Stellar keypair before publishing
 * to the bus. The signature is stored in the Shield Contract on Soroban.
 * Any verifier can call verify_signature() on-chain to confirm provenance.
 */

import { Keypair, SorobanRpc } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { ShieldContract } from "@calebux/agent-kit";
import { bus, type AgentMessage, type AgentTopic } from "./bus.js";

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * Deterministic SHA-256 hash of a payload.
 * Keys are sorted so the hash is stable regardless of insertion order.
 */
export function hashPayload(payload: unknown): string {
  let str: string;
  if (payload !== null && typeof payload === "object") {
    str = JSON.stringify(payload, Object.keys(payload as object).sort());
  } else {
    str = JSON.stringify(payload);
  }
  return createHash("sha256").update(str).digest("hex");
}

// ── Signing ───────────────────────────────────────────────────────────────────

interface SignableMsg {
  agentId: string;
  runId: string;
  topic: string;
  confidence: number;
  payload: unknown;
  timestamp: number;
}

function buildSignable(msg: SignableMsg): Buffer {
  const obj = {
    agentId: msg.agentId,
    runId: msg.runId,
    topic: msg.topic,
    confidence: msg.confidence,
    payloadHash: hashPayload(msg.payload),
    timestamp: msg.timestamp,
  };
  return Buffer.from(JSON.stringify(obj), "utf8");
}

/**
 * Sign an agent message with its Stellar keypair.
 * Returns a hex-encoded signature string.
 */
export function signOutput(keypair: Keypair, msg: SignableMsg): string {
  return keypair.sign(buildSignable(msg)).toString("hex");
}

/**
 * Verify a previously-signed message.
 * @param agentPublicKey  The agent's Stellar public key (G…)
 * @param msg             The original message fields
 * @param signature       Hex-encoded signature from signOutput()
 */
export function verifySignature(
  agentPublicKey: string,
  msg: SignableMsg,
  signature: string
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(agentPublicKey);
    return keypair.verify(buildSignable(msg), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// ── Signed publish ─────────────────────────────────────────────────────────────

/**
 * Sign an agent message, publish it to the bus, and fire-and-forget store
 * the signature + payload hash on the Shield Contract.
 *
 * This is the recommended entry-point for all agent output publishes.
 * Non-blocking: the on-chain store never delays the bus publish.
 *
 * @param msg             The message to sign and publish (without `signature`)
 * @param keypair         The agent's Stellar keypair
 * @param shieldContractId  Optional Shield Contract ID; skipped when absent
 */
export async function publishSigned(
  msg: Omit<AgentMessage, "signature"> & { topic: AgentTopic },
  keypair: Keypair,
  shieldContractId?: string
): Promise<void> {
  const signable: SignableMsg = {
    agentId: msg.agentId,
    runId: msg.runId,
    topic: msg.topic,
    confidence: msg.confidence,
    payload: msg.payload,
    timestamp: msg.timestamp,
  };

  const signature = signOutput(keypair, signable);
  const payloadHash = hashPayload(msg.payload);

  // Publish immediately — never wait for on-chain storage
  bus.publish({ ...msg, signature });

  // Fire-and-forget on-chain signature storage (uses admin keypair — store_signature is admin-gated)
  const adminSecret = process.env.ORCHESTRATOR_SECRET_KEY;
  if (shieldContractId && adminSecret) {
    const rpcUrl =
      process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
    const rpc = new SorobanRpc.Server(rpcUrl);
    const adminKp = Keypair.fromSecret(adminSecret);
    const shield = new ShieldContract(shieldContractId, rpc, adminKp);
    shield
      .storeSignature({
        agentId: msg.agentId,
        runId: msg.runId,
        signature,
        payloadHash,
      })
      .then((sigTxHash: string) => {
        console.log(
          `   [${msg.agentId}] ✍️  Signature stored on-chain (Shield Contract) tx: ${sigTxHash}`
        );
        // Notify the bus so the dashboard can display the sig tx explorer link
        bus.publish({
          topic: "sig:stored",
          agentId: msg.agentId,
          runId: msg.runId,
          payload: { agentId: msg.agentId, runId: msg.runId, sigTxHash },
          confidence: 1,
          timestamp: Date.now(),
        });
      })
      .catch((err: unknown) => {
        console.warn(
          `   [${msg.agentId}] storeSignature non-fatal:`,
          (err as Error).message ?? err
        );
      });
  }
}
