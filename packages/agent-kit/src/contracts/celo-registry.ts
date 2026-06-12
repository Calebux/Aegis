/**
 * CeloIdentityRegistry — SDK wrapper around AegisCeloRegistry on Celo.
 *
 * Mirrors the Stellar IdentityRegistry but targets the EVM contract
 * via viem. All write methods require `privateKey` (admin key).
 * Read methods use eth_call (no gas).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoAlfajores } from "viem/chains";

// ── ABI ───────────────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  {
    name: "registerAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "name", type: "string" },
      { name: "capability", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "setManifestHash",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "getManifestHash",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "recordSuccess",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [],
  },
  {
    name: "recordFailure",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [],
  },
  {
    name: "getAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "capability", type: "string" },
          { name: "manifestHash", type: "bytes32" },
          { name: "reputation", type: "uint256" },
          { name: "tasksCompleted", type: "uint256" },
          { name: "tasksFailed", type: "uint256" },
          { name: "registeredAt", type: "uint256" },
          { name: "registered", type: "bool" },
        ],
      },
    ],
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBytes32(hash: string): Hex {
  const h = hash.startsWith("0x") ? hash : `0x${hash}`;
  // Pad or truncate to 32 bytes (64 hex chars)
  const raw = h.slice(2).padEnd(64, "0").slice(0, 64);
  return `0x${raw}` as Hex;
}

// ── CeloIdentityRegistry ──────────────────────────────────────────────────────

export class CeloIdentityRegistry {
  private readonly address: Address;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: typeof celo | typeof celoAlfajores;
  private readonly transport: ReturnType<typeof http>;

  constructor(
    registryAddress: string,
    privateKey: string,
    rpcUrl?: string,
    network?: string
  ) {
    this.address = registryAddress as Address;
    this.account = privateKeyToAccount((privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex);
    const net = network ?? process.env.AEGIS_CELO_NETWORK ?? "alfajores";
    this.chain = net === "mainnet" ? celo : celoAlfajores;
    const url =
      rpcUrl ??
      process.env.CELO_RPC_URL ??
      (this.chain.id === 42220
        ? "https://forno.celo.org"
        : "https://alfajores-forno.celo-testnet.org");
    this.transport = http(url);
  }

  private walletClient() {
    return createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: this.transport,
    });
  }

  private publicClient() {
    return createPublicClient({
      chain: this.chain,
      transport: this.transport,
    });
  }

  /**
   * Register a new agent on-chain. Silently ignores AlreadyRegistered reverts.
   */
  async registerAgent(
    agentId: string,
    name: string,
    capability: string,
    manifestHash: string = "0x" + "0".repeat(64)
  ): Promise<Hex> {
    try {
      const wc = this.walletClient();
      const pc = this.publicClient();
      const txHash = await wc.writeContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: "registerAgent",
        args: [agentId, name, capability, toBytes32(manifestHash)],
        account: this.account,
      });
      await pc.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("AlreadyRegistered")) {
        // Already registered — not an error
        return "0x" as Hex;
      }
      throw err;
    }
  }

  /** Store the canonical manifest hash for an already-registered agent. */
  async setManifestHash(agentId: string, manifestHash: string): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: REGISTRY_ABI,
      functionName: "setManifestHash",
      args: [agentId, toBytes32(manifestHash)],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Read the canonical manifest hash for an agent via eth_call (no gas). */
  async getManifestHash(agentId: string): Promise<Hex> {
    try {
      const pc = this.publicClient();
      const result = await pc.readContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: "getManifestHash",
        args: [agentId],
      });
      return result as Hex;
    } catch {
      return "0x" as Hex;
    }
  }

  /** Increment on-chain reputation after a successful task. Fire-and-forget. */
  async recordSuccess(agentId: string): Promise<void> {
    try {
      const wc = this.walletClient();
      const txHash = await wc.writeContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: "recordSuccess",
        args: [agentId],
        account: this.account,
      });
      // Don't await receipt — fire-and-forget
      void txHash;
    } catch (err) {
      console.warn(`[celo-registry] recordSuccess failed for ${agentId} (non-fatal):`, err);
    }
  }

  /** Decrement on-chain reputation after a failed task. Fire-and-forget. */
  async recordFailure(agentId: string): Promise<void> {
    try {
      const wc = this.walletClient();
      await wc.writeContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: "recordFailure",
        args: [agentId],
        account: this.account,
      });
    } catch (err) {
      console.warn(`[celo-registry] recordFailure failed for ${agentId} (non-fatal):`, err);
    }
  }

  /**
   * Read the reputation score for an agent via eth_call.
   * Returns null if the agent is not registered or the call fails.
   */
  async getReputation(agentId: string): Promise<number | null> {
    try {
      const pc = this.publicClient();
      const agent = await pc.readContract({
        address: this.address,
        abi: REGISTRY_ABI,
        functionName: "getAgent",
        args: [agentId],
      });
      const a = agent as { reputation: bigint };
      return Number(a.reputation);
    } catch {
      return null;
    }
  }
}
