/**
 * CeloPolicyManager — SDK wrapper around AegisCeloPolicy on Celo.
 *
 * Provides spend-cap enforcement for Celo agents. All write methods
 * require admin-level access (deployer private key).
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

const POLICY_ABI = [
  {
    name: "setPolicy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "maxSpendPerTask", type: "uint256" },
      { name: "maxSpendPerSession", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "revokePolicy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [],
  },
  {
    name: "authorizeSpend",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "sessionId", type: "bytes32" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "policies",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "maxSpendPerTask", type: "uint256" },
      { name: "maxSpendPerSession", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
] as const;

// ── CeloPolicyManager ─────────────────────────────────────────────────────────

export class CeloPolicyManager {
  private readonly address: Address;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: typeof celo | typeof celoAlfajores;
  private readonly transport: ReturnType<typeof http>;

  constructor(
    policyAddress: string,
    privateKey: string,
    rpcUrl?: string,
    network?: string
  ) {
    this.address = policyAddress as Address;
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

  /**
   * Set or update the spend policy for an agent.
   * allowedTokens is reserved for future use — the contract currently uses
   * per-asset spend tracking via the authorizeSpend sessionId mechanism.
   */
  async setPolicy(
    agentId: string,
    spendLimitWei: bigint,
    _allowedTokens: string[] = []
  ): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: POLICY_ABI,
      functionName: "setPolicy",
      args: [agentId, spendLimitWei, spendLimitWei],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /**
   * Non-fatal spend authorization check. Calls authorizeSpend on-chain;
   * returns true if authorized, false if the policy is inactive or cap exceeded.
   */
  async authorizeSpend(
    agentId: string,
    amountWei: bigint,
    token: string
  ): Promise<boolean> {
    try {
      // Generate a deterministic sessionId from agentId + current minute
      const sessionSeed = `${agentId}:${Math.floor(Date.now() / 60_000)}`;
      const sessionBytes = Buffer.from(sessionSeed.slice(0, 32).padEnd(32, "0"));
      const sessionId = `0x${sessionBytes.toString("hex")}` as Hex;

      const wc = this.walletClient();
      await wc.writeContract({
        address: this.address,
        abi: POLICY_ABI,
        functionName: "authorizeSpend",
        args: [agentId, sessionId, token as Address, amountWei],
        account: this.account,
      });
      return true;
    } catch (err) {
      const msg = String(err);
      if (msg.includes("PolicyInactive") || msg.includes("SpendCapExceeded")) {
        console.warn(`[celo-policy] authorizeSpend rejected for ${agentId}: ${msg}`);
      } else {
        console.warn(`[celo-policy] authorizeSpend failed for ${agentId} (non-fatal):`, err);
      }
      return false;
    }
  }

  /**
   * Revoke the spend policy for an agent. Fire-and-forget.
   */
  async revokePolicy(agentId: string): Promise<void> {
    try {
      const wc = this.walletClient();
      await wc.writeContract({
        address: this.address,
        abi: POLICY_ABI,
        functionName: "revokePolicy",
        args: [agentId],
        account: this.account,
      });
    } catch (err) {
      console.warn(`[celo-policy] revokePolicy failed for ${agentId} (non-fatal):`, err);
    }
  }
}
