/**
 * Core domain types shared across orchestrator, agents, and dashboard.
 */

// ---------------------------------------------------------------------------
// Agent identifiers
// ---------------------------------------------------------------------------

export type AgentId = "scout" | "ledger" | "signal" | "scribe" | "executor";

export interface AgentIdentity {
  id: AgentId;
  /** Stellar testnet public key */
  publicKey: string;
  /** Shield Contract spend cap in stroops */
  spendCapStroops: bigint;
}

// ---------------------------------------------------------------------------
// Task model
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SubTask {
  id: string;
  assignedAgent: AgentId;
  instruction: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  spentStroops?: bigint;
  startedAt?: Date;
  completedAt?: Date;
}

export interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  subTasks: SubTask[];
  finalReport?: string;
  createdAt: Date;
  completedAt?: Date;
}

// ---------------------------------------------------------------------------
// Wallet / spend tracking
// ---------------------------------------------------------------------------

export interface WalletBalance {
  agentId: AgentId;
  publicKey: string;
  xlmBalance: string;
  spentStroops: bigint;
  capStroops: bigint;
  /** Reputation score 0–100.00 (two decimal places stored as integer 0–10000) */
  reputationBps: number;
}

// ---------------------------------------------------------------------------
// x402 payment types
// ---------------------------------------------------------------------------

export interface X402PaymentRequest {
  /** Payment recipient address */
  recipient: string;
  /** Amount in stroops */
  amountStroops: bigint;
  /** Human-readable description of the service being paid for */
  description: string;
  /** Idempotency key */
  nonce: string;
}

export interface X402PaymentResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Contract interaction types
// ---------------------------------------------------------------------------

export interface ShieldContractConfig {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
}

export interface IdentityRegistryConfig {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
}
