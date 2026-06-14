/**
 * Self Protocol integration — sybil-resistant agent identity on Celo.
 *
 * Uses the Self Protocol Agent Registry contract to verify whether an
 * agent address has completed Self verification.
 */

import {
  createPublicClient,
  http,
  type Address,
} from "viem";
import { celo, celoAlfajores } from "viem/chains";

// ── Constants ────────────────────────────────────────────────────────────────

/** Self Protocol Agent Registry on Celo mainnet. */
export const SELF_AGENT_REGISTRY = "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944" as const;

const SELF_REGISTRY_ABI = [
  {
    name: "isVerified",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── isSelfVerified ──────────────────────────────────────────────────────────

/**
 * Check whether an agent address is verified via Self Protocol.
 * Uses eth_call (no gas required).
 *
 * @param agentAddress - EVM address to check
 * @param rpcUrl - Override RPC URL (defaults to CELO_RPC_URL env or Celo mainnet)
 * @returns true if the agent is Self-verified
 */
export async function isSelfVerified(
  agentAddress: string,
  rpcUrl?: string,
): Promise<boolean> {
  const url =
    rpcUrl ??
    process.env.CELO_RPC_URL ??
    "https://forno.celo.org";

  const network = process.env.CALAGENT_CELO_NETWORK ?? "mainnet";
  const chain = network === "mainnet" ? celo : celoAlfajores;

  const client = createPublicClient({
    chain,
    transport: http(url),
  });

  try {
    const result = await client.readContract({
      address: SELF_AGENT_REGISTRY,
      abi: SELF_REGISTRY_ABI,
      functionName: "isVerified",
      args: [agentAddress as Address],
    });
    return result as boolean;
  } catch {
    // If the call fails (contract not deployed on testnet, etc.), return false
    return false;
  }
}

// ── Self enforcement check ──────────────────────────────────────────────────

/**
 * Whether Self Protocol enforcement is enabled.
 * Controlled by CALAGENT_SELF_ENFORCE env var.
 */
export function selfEnforced(): boolean {
  return process.env.CALAGENT_SELF_ENFORCE === "true";
}
