/**
 * Erc8004Adapter — SDK wrapper for the Erc8004Adapter bridge contract on Celo.
 *
 * Registers Cal-AgentKit agents on the canonical ERC-8004 Identity and
 * Reputation registries via the adapter contract.
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

// ── ABI ─────────────────────────────────────────────────────────────────────

const ERC8004_ADAPTER_ABI = [
  {
    name: "registerAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "calagentId", type: "string" },
      { name: "agentURI", type: "string" },
    ],
    outputs: [{ name: "erc8004Id", type: "uint256" }],
  },
  {
    name: "syncReputation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "calagentId", type: "string" },
      { name: "value", type: "int256" },
      { name: "tag", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "updateAgentURI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "calagentId", type: "string" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "getErc8004Id",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "calagentId", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "calagentId", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Erc8004Adapter ──────────────────────────────────────────────────────────

export class Erc8004Adapter {
  private readonly address: Address;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: typeof celo | typeof celoAlfajores;
  private readonly transport: ReturnType<typeof http>;

  constructor(
    adapterAddress: string,
    privateKey: string,
    rpcUrl?: string,
    network?: string,
  ) {
    this.address = adapterAddress as Address;
    this.account = privateKeyToAccount(
      (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex,
    );
    const net = network ?? process.env.CALAGENT_CELO_NETWORK ?? "alfajores";
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
   * Register a Cal-AgentKit agent on the canonical ERC-8004 Identity Registry.
   * Silently returns `{ txHash: "0x", erc8004Id: 0n }` if already registered.
   */
  async registerOnErc8004(
    calagentId: string,
    agentURI: string,
  ): Promise<{ txHash: Hex; erc8004Id: bigint }> {
    try {
      const wc = this.walletClient();
      const pc = this.publicClient();
      const txHash = await wc.writeContract({
        address: this.address,
        abi: ERC8004_ADAPTER_ABI,
        functionName: "registerAgent",
        args: [calagentId, agentURI],
        account: this.account,
      });
      const receipt = await pc.waitForTransactionReceipt({ hash: txHash });

      // Read back the assigned ID
      const erc8004Id = await this.getErc8004AgentId(calagentId);
      return { txHash, erc8004Id };
    } catch (err) {
      const msg = String(err);
      if (msg.includes("AlreadyRegistered")) {
        return { txHash: "0x" as Hex, erc8004Id: 0n };
      }
      throw err;
    }
  }

  /** Forward a reputation signal to the ERC-8004 Reputation Registry. */
  async syncReputation(
    calagentId: string,
    value: number,
    tag: string,
  ): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: ERC8004_ADAPTER_ABI,
      functionName: "syncReputation",
      args: [calagentId, BigInt(value), tag],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Update the agent metadata URI on the ERC-8004 Identity Registry. */
  async updateAgentURI(calagentId: string, newURI: string): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: ERC8004_ADAPTER_ABI,
      functionName: "updateAgentURI",
      args: [calagentId, newURI],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Get the ERC-8004 NFT token ID for a Cal-AgentKit agent. */
  async getErc8004AgentId(calagentId: string): Promise<bigint> {
    try {
      const pc = this.publicClient();
      const result = await pc.readContract({
        address: this.address,
        abi: ERC8004_ADAPTER_ABI,
        functionName: "getErc8004Id",
        args: [calagentId],
      });
      return result as bigint;
    } catch {
      return 0n;
    }
  }

  /** Check whether a Cal-AgentKit agent has been registered on ERC-8004. */
  async isRegistered(calagentId: string): Promise<boolean> {
    try {
      const pc = this.publicClient();
      const result = await pc.readContract({
        address: this.address,
        abi: ERC8004_ADAPTER_ABI,
        functionName: "isRegistered",
        args: [calagentId],
      });
      return result as boolean;
    } catch {
      return false;
    }
  }
}
