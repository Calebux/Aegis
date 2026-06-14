/**
 * AgentStakingManager — SDK wrapper for the AgentStaking contract on Celo.
 *
 * Provides USDm staking, slashing, and reward management for agents.
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

const STAKING_ABI = [
  {
    name: "stake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "requestUnstake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "unstake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [],
  },
  {
    name: "slash",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "amount", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "reward",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getStake",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "isStaked",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "minAmount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── AgentStakingManager ──────────────────────────────────────────────────────

export class AgentStakingManager {
  private readonly address: Address;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: typeof celo | typeof celoAlfajores;
  private readonly transport: ReturnType<typeof http>;

  constructor(
    stakingAddress: string,
    privateKey: string,
    rpcUrl?: string,
    network?: string
  ) {
    this.address = stakingAddress as Address;
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

  /** Stake USDm for an agent. Caller must have approved the staking contract. */
  async stake(agentId: string, amountWei: bigint): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: STAKING_ABI,
      functionName: "stake",
      args: [agentId, amountWei],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Request unstake — must wait cooldown before calling unstake(). */
  async requestUnstake(agentId: string, amountWei: bigint): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: STAKING_ABI,
      functionName: "requestUnstake",
      args: [agentId, amountWei],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Withdraw staked tokens after cooldown has elapsed. */
  async unstake(agentId: string): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: STAKING_ABI,
      functionName: "unstake",
      args: [agentId],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Get the current stake amount for an agent (read-only). */
  async getStake(agentId: string): Promise<bigint> {
    try {
      const pc = this.publicClient();
      const result = await pc.readContract({
        address: this.address,
        abi: STAKING_ABI,
        functionName: "getStake",
        args: [agentId],
      });
      return result as bigint;
    } catch {
      return 0n;
    }
  }

  /** Check if an agent meets a minimum stake threshold (read-only). */
  async isStaked(agentId: string, minAmountWei: bigint): Promise<boolean> {
    try {
      const pc = this.publicClient();
      const result = await pc.readContract({
        address: this.address,
        abi: STAKING_ABI,
        functionName: "isStaked",
        args: [agentId, minAmountWei],
      });
      return result as boolean;
    } catch {
      return false;
    }
  }
}
