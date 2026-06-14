import type { EventEmitter } from "events";
import type { Keypair } from "@stellar/stellar-sdk";

// ── Agent definition ──────────────────────────────────────────────────────────

export interface AgentContext {
  /** This agent's funded Stellar keypair */
  wallet: Keypair;
  /**
   * Pay-and-fetch helper. Probes the URL; if a 402 is returned it submits
   * a real Stellar XLM payment and retries automatically.
   */
  pay: <T = unknown>(url: string) => Promise<T>;
  /** Accumulates real Stellar tx hashes produced during this run */
  txHashes: string[];
}

// ── Agent infrastructure metadata ────────────────────────────────────────────

export type AgentPaymentProtocol = "x402" | "mpp";
export type AgentPaymentAsset = "XLM" | "USDC" | "PYUSD" | "USDY" | string;
export type AgentChain = "stellar" | "celo" | string;

export interface AgentPaymentCapability {
  /** HTTP payment protocol the agent or API endpoint accepts. */
  protocol: AgentPaymentProtocol;
  /** Settlement chain, e.g. stellar or celo. */
  chain?: AgentChain;
  /** Network identifier, e.g. stellar:testnet, eip155:42220, eip155:44787. */
  network: string;
  /** Asset accepted for settlement. Prefer stable assets for production APIs. */
  asset: AgentPaymentAsset;
  /** Optional human-readable floor price, e.g. "$0.001" or "0.01 XLM". */
  price?: string;
  /** Optional receiver address for direct-payment integrations. */
  payTo?: string;
}

export interface AgentPolicyConstraints {
  /** Maximum spend for one orchestrated task, in stroops or asset base units. */
  maxSpendPerTask?: bigint;
  /** Maximum spend for a session, in stroops or asset base units. */
  maxSpendPerSession?: bigint;
  /** Domains this agent is allowed to call while executing a task. */
  allowedDomains?: string[];
  /** Payment assets this agent may spend. */
  allowedAssets?: AgentPaymentAsset[];
  /** Minimum counterparty reputation required before paying/calling another agent. */
  minCounterpartyReputation?: number;
  /** Require a human approval step above this spend amount. */
  requireApprovalAbove?: bigint;
}

export interface AgentEndpoint {
  /** Public task execution endpoint for remote agent-to-agent calls. */
  url: string;
  /** Optional protocol label for compatibility with A2A/MCP style gateways. */
  protocol?: "http" | "mcp" | "a2a";
}

export interface AgentManifest {
  /** Stable logical agent ID, usually matching the on-chain registry key. */
  id: string;
  name: string;
  description?: string;
  version?: string;
  capabilities: string[];
  /** Primary chain this manifest belongs to. */
  chain?: AgentChain;
  endpoint?: AgentEndpoint;
  payments: AgentPaymentCapability[];
  policies?: AgentPolicyConstraints;
  /** Bound Stellar public key when known. */
  walletAddress?: string;
  /** Soroban registry contract that can verify this agent's identity. */
  registryContractId?: string;
  /** Soroban policy contract that can verify this agent's spend controls. */
  shieldContractId?: string;
  /** Optional output attestation/signature endpoint or contract reference. */
  attestation?: {
    type: "soroban" | "signature" | "url";
    value: string;
  };
  /** Stable SHA-256 hash of the canonical manifest, suitable for registry storage. */
  manifestHash?: string;
  /** Arbitrary app-specific metadata kept JSON-serializable. */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AgentDiscoveryQuery {
  chain?: AgentChain;
  capability?: string;
  protocol?: AgentPaymentProtocol;
  asset?: AgentPaymentAsset;
  network?: string;
  minReputation?: number;
}

export interface AgentRunResult {
  /** Human-readable output passed to the synthesizer */
  result: string;
  /** Actual spend, in stroops (1 XLM = 10 000 000 stroops) */
  spentStroops?: bigint;
  /** Any additional tx hashes not captured via ctx.pay */
  txHashes?: string[];
  /** Payment mode used during this run */
  paymentMode?: string;
}

export interface AgentDefinition {
  /** Unique identifier — used as the on-chain agent ID */
  id: string;
  /** Maximum XLM this agent is allowed to spend (default: 1 XLM) */
  spendCapXlm?: number;
  /** Portable metadata used for discovery, registry publishing, and MCP tools. */
  manifest?: Partial<Omit<AgentManifest, "id">>;
  run: (task: string, ctx: AgentContext) => Promise<AgentRunResult>;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export interface OrchestratorOptions {
  /** Soroban Shield Contract ID — enforces per-agent spend caps on-chain */
  shieldContractId?: string;
  /** Soroban Identity Registry Contract ID — tracks agent reputation on-chain */
  registryContractId?: string;
  /**
   * Optional task decomposer. Receives the raw task and a list of agent IDs;
   * returns a map of agentId → subtask string.
   * If omitted, every agent receives the raw task unchanged.
   */
  decompose?: (
    task: string,
    agentIds: string[]
  ) => Promise<Record<string, string>>;
  /**
   * Optional synthesizer. Receives the original task and all agent results;
   * returns the final report string.
   * If omitted, results are concatenated with Markdown headers.
   */
  synthesize?: (task: string, results: AgentResult[]) => Promise<string>;
  /**
   * Called after all agent wallets are provisioned, before agents run.
   * Receives a map of agentId → Stellar public key.
   * Useful for cross-agent awareness (e.g. passing Scout's address to Ledger).
   */
  onWalletsProvisioned?: (wallets: Record<string, string>) => void;
}

export interface AgentResult {
  agentId: string;
  task: string;
  result: string;
  spentStroops: bigint;
  txHashes: string[];
  paymentMode: string;
}

export interface OrchestratorReport {
  task: string;
  subtasks: Record<string, string>;
  results: Record<string, string>;
  report: string;
  /** agentId → Stellar public key */
  wallets: Record<string, string>;
  /** agentId → stroops spent */
  spent: Record<string, number>;
  /** agentId → current reputation score */
  reputation: Record<string, number>;
  /** agentId → list of Stellar tx hashes */
  txHashes: Record<string, string[]>;
  timestamp: string;
}

// ── Verifiable run receipts ──────────────────────────────────────────────────

export interface RunReceiptAgent {
  agentId: string;
  walletAddress: string;
  spentStroops: number;
  reputation: number;
  txHashes: string[];
  paymentMode?: string;
  paymentProtocol?: AgentPaymentProtocol;
  paymentAsset?: AgentPaymentAsset;
  paymentAmount?: string;
  paymentAmountBaseUnits?: string;
  settlementTxHash?: string;
}

export interface RunReceiptPolicy {
  shieldContractId?: string;
  registryContractId?: string;
  network: string;
}

export interface RunReceiptSignature {
  signer: string;
  signature: string;
  algorithm: "stellar-ed25519";
}

export interface RunReceipt {
  version: "calagent.receipt.v1";
  runId: string;
  taskId?: string;
  task: string;
  taskHash: string;
  outputHash: string;
  receiptHash: string;
  createdAt: string;
  completedAt?: string;
  agents: RunReceiptAgent[];
  policy: RunReceiptPolicy;
  totalSpentStroops: number;
  payments?: Array<{
    agentId: string;
    protocol: AgentPaymentProtocol;
    network: string;
    asset: AgentPaymentAsset;
    amount: string;
    amountBaseUnits?: string;
    payer?: string;
    payTo?: string;
    transaction?: string;
    verificationMode?: string;
  }>;
  txHashes: string[];
  signature?: RunReceiptSignature;
}

export interface RunReceiptVerification {
  valid: boolean;
  receiptHashValid: boolean;
  taskHashValid: boolean;
  outputHashValid: boolean;
  signatureValid?: boolean;
  errors: string[];
}

export interface Orchestrator {
  run: (
    task: string,
    emitter?: EventEmitter
  ) => Promise<OrchestratorReport>;
}
