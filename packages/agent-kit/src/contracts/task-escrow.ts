/**
 * TaskEscrowManager — SDK wrapper for the TaskEscrow contract on Celo.
 *
 * Provides USDm escrow with conditional release on verified receipt.
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

const ESCROW_ABI = [
  {
    name: "createEscrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskHash", type: "bytes32" },
      { name: "agentId", type: "string" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "escrowId", type: "uint256" }],
  },
  {
    name: "releaseEscrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "escrowId", type: "uint256" },
      { name: "receiptHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "refundEscrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "getEscrow",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [
      { name: "depositor", type: "address" },
      { name: "agentId", type: "string" },
      { name: "amount", type: "uint256" },
      { name: "taskHash", type: "bytes32" },
      { name: "released", type: "bool" },
      { name: "deadline", type: "uint256" },
    ],
  },
  {
    name: "nextEscrowId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EscrowInfo {
  depositor: Address;
  agentId: string;
  amount: bigint;
  taskHash: Hex;
  released: boolean;
  deadline: bigint;
}

// ── TaskEscrowManager ─────────────────────────────────────────────────────────

export class TaskEscrowManager {
  private readonly address: Address;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: typeof celo | typeof celoAlfajores;
  private readonly transport: ReturnType<typeof http>;

  constructor(
    escrowAddress: string,
    privateKey: string,
    rpcUrl?: string,
    network?: string
  ) {
    this.address = escrowAddress as Address;
    this.account = privateKeyToAccount(
      (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as Hex
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

  /** Create an escrow. Caller must have approved the escrow contract for the token. */
  async createEscrow(
    taskHash: Hex,
    agentId: string,
    amountWei: bigint,
    deadline: bigint
  ): Promise<{ txHash: Hex; escrowId: bigint }> {
    const wc = this.walletClient();
    const pc = this.publicClient();

    // Read current nextEscrowId before the tx
    const nextId = (await pc.readContract({
      address: this.address,
      abi: ESCROW_ABI,
      functionName: "nextEscrowId",
    })) as bigint;

    const txHash = await wc.writeContract({
      address: this.address,
      abi: ESCROW_ABI,
      functionName: "createEscrow",
      args: [taskHash, agentId, amountWei, deadline],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return { txHash, escrowId: nextId };
  }

  /** Release escrowed funds after verifying a receipt. Admin only. */
  async releaseEscrow(escrowId: bigint, receiptHash: Hex): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: ESCROW_ABI,
      functionName: "releaseEscrow",
      args: [escrowId, receiptHash],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Refund escrowed funds to depositor after deadline has passed. */
  async refundEscrow(escrowId: bigint): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: ESCROW_ABI,
      functionName: "refundEscrow",
      args: [escrowId],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Get escrow details (read-only). */
  async getEscrow(escrowId: bigint): Promise<EscrowInfo> {
    try {
      const pc = this.publicClient();
      const result = (await pc.readContract({
        address: this.address,
        abi: ESCROW_ABI,
        functionName: "getEscrow",
        args: [escrowId],
      })) as [Address, string, bigint, Hex, boolean, bigint];
      return {
        depositor: result[0],
        agentId: result[1],
        amount: result[2],
        taskHash: result[3],
        released: result[4],
        deadline: result[5],
      };
    } catch {
      return {
        depositor: "0x0000000000000000000000000000000000000000" as Address,
        agentId: "",
        amount: 0n,
        taskHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
        released: false,
        deadline: 0n,
      };
    }
  }
}
