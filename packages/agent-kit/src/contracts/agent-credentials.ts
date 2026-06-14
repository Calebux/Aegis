/**
 * AgentCredentialManager — SDK wrapper for the AgentCredentials contract on Celo.
 *
 * Manages scoped, time-limited credentials that gate agent access to services.
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

const CREDENTIALS_ABI = [
  {
    name: "grantCredential",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "service", type: "string" },
      { name: "scope", type: "string" },
      { name: "expiry", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "revokeCredential",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "service", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "hasCredential",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "service", type: "string" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getCredential",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "service", type: "string" },
    ],
    outputs: [
      { name: "scope", type: "string" },
      { name: "grantedAt", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
] as const;

// ── AgentCredentialManager ──────────────────────────────────────────────────

export interface CredentialInfo {
  scope: string;
  grantedAt: bigint;
  expiresAt: bigint;
  active: boolean;
}

export class AgentCredentialManager {
  private readonly address: Address;
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chain: typeof celo | typeof celoAlfajores;
  private readonly transport: ReturnType<typeof http>;

  constructor(
    credentialsAddress: string,
    privateKey: string,
    rpcUrl?: string,
    network?: string
  ) {
    this.address = credentialsAddress as Address;
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

  /** Grant a credential to an agent for a service. */
  async grantCredential(
    agentId: string,
    service: string,
    scope: string,
    expiry: bigint = 0n
  ): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: CREDENTIALS_ABI,
      functionName: "grantCredential",
      args: [agentId, service, scope, expiry],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Revoke a credential. */
  async revokeCredential(agentId: string, service: string): Promise<Hex> {
    const wc = this.walletClient();
    const pc = this.publicClient();
    const txHash = await wc.writeContract({
      address: this.address,
      abi: CREDENTIALS_ABI,
      functionName: "revokeCredential",
      args: [agentId, service],
      account: this.account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Check if an agent has a valid credential for a service (read-only). */
  async hasCredential(agentId: string, service: string): Promise<boolean> {
    try {
      const pc = this.publicClient();
      const result = await pc.readContract({
        address: this.address,
        abi: CREDENTIALS_ABI,
        functionName: "hasCredential",
        args: [agentId, service],
      });
      return result as boolean;
    } catch {
      return false;
    }
  }

  /** Get full credential details (read-only). */
  async getCredential(
    agentId: string,
    service: string
  ): Promise<CredentialInfo> {
    try {
      const pc = this.publicClient();
      const result = await pc.readContract({
        address: this.address,
        abi: CREDENTIALS_ABI,
        functionName: "getCredential",
        args: [agentId, service],
      });
      const [scope, grantedAt, expiresAt, active] = result as [
        string,
        bigint,
        bigint,
        boolean,
      ];
      return { scope, grantedAt, expiresAt, active };
    } catch {
      return { scope: "", grantedAt: 0n, expiresAt: 0n, active: false };
    }
  }
}
