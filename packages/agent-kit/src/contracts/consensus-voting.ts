/**
 * ConsensusVotingManager — SDK wrapper for the ConsensusVoting contract on Celo.
 *
 * Provides on-chain consensus voting for multi-agent pipeline outputs.
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

const VOTING_ABI = [
  {
    name: "openRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskHash", type: "bytes32" }],
    outputs: [{ name: "roundId", type: "uint256" }],
  },
  {
    name: "submitVote",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "agentId", type: "string" },
      { name: "outputHash", type: "bytes32" },
      { name: "confidence", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "finalizeRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "getRoundResult",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [
      { name: "outputHash", type: "bytes32" },
      { name: "voteCount", type: "uint256" },
      { name: "finalized", type: "bool" },
    ],
  },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBytes32(hash: string): Hex {
  const h = hash.startsWith("0x") ? hash : `0x${hash}`;
  const raw = h.slice(2).padEnd(64, "0").slice(0, 64);
  return `0x${raw}` as Hex;
}

// ── ConsensusVotingManager ──────────────────────────────────────────────────

export class ConsensusVotingManager {
  private readonly address: Address;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: typeof celo | typeof celoAlfajores;
  private readonly transport: ReturnType<typeof http>;

  constructor(
    votingAddress: string,
    privateKey: string,
    rpcUrl?: string,
    network?: string
  ) {
    this.address = votingAddress as Address;
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

  /** Open a new voting round for a task. Returns the roundId. */
  async openRound(taskHash: string): Promise<bigint> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: VOTING_ABI,
      functionName: "openRound",
      args: [toBytes32(taskHash)],
      account: this.account,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });

    // Parse roundId from RoundOpened event log
    // Event signature: RoundOpened(uint256 indexed roundId, bytes32 taskHash)
    for (const log of receipt.logs) {
      if (log.topics.length >= 2 && log.topics[1]) {
        return BigInt(log.topics[1]);
      }
    }
    return 0n;
  }

  /** Submit a vote for a round. */
  async submitVote(
    roundId: bigint,
    agentId: string,
    outputHash: string,
    confidence: number
  ): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: VOTING_ABI,
      functionName: "submitVote",
      args: [roundId, agentId, toBytes32(outputHash), BigInt(confidence)],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Finalize a round — picks the majority output hash. */
  async finalizeRound(roundId: bigint): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: VOTING_ABI,
      functionName: "finalizeRound",
      args: [roundId],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Get the result of a round (read-only). */
  async getRoundResult(roundId: bigint): Promise<{
    outputHash: Hex;
    voteCount: bigint;
    finalized: boolean;
  }> {
    try {
      const pc = this.publicClient();
      const result = await pc.readContract({
        address: this.address,
        abi: VOTING_ABI,
        functionName: "getRoundResult",
        args: [roundId],
      });
      const [outputHash, voteCount, finalized] = result as [Hex, bigint, boolean];
      return { outputHash, voteCount, finalized };
    } catch {
      return { outputHash: "0x" as Hex, voteCount: 0n, finalized: false };
    }
  }
}
