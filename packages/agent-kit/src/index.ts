/**
 * @calebux/agent-kit
 *
 * Infrastructure for autonomous agent economies on Celo and Stellar.
 * Identity, reputation, payments, governance, discovery, coordination,
 * and audit — so you can focus on writing agent logic.
 *
 * @example
 * ```ts
 * import { defineAgent, createOrchestrator } from '@calebux/agent-kit'
 *
 * const researcher = defineAgent({
 *   id: 'researcher',
 *   spendCapXlm: 1,
 *   run: async (task, { pay }) => {
 *     const data = await pay('https://my-x402-api.com/search?q=' + task)
 *     return { result: JSON.stringify(data) }
 *   }
 * })
 *
 * const { run } = createOrchestrator([researcher], {
 *   shieldContractId: process.env.SHIELD_CONTRACT_ID,
 *   registryContractId: process.env.REGISTRY_CONTRACT_ID,
 * })
 *
 * const report = await run('research the XLM/USDC market')
 * console.log(report.report)
 * ```
 */

// Core API
export { defineAgent } from "./agent.js";
export { createOrchestrator } from "./orchestrator.js";
export { createCeloOrchestrator } from "./orchestrator-celo.js";
export type { CeloOrchestratorOptions } from "./orchestrator-celo.js";
export { createAutomation } from "./automation.js";
export type {
  AutomationOptions,
  AutomationRunResult,
  Automation,
} from "./automation.js";
export {
  computeAgentManifestHash,
  createAgentManifest,
  createAgentManifests,
  discoverAgents,
} from "./discovery.js";
export {
  computeReceiptHash,
  createRunReceipt,
  sha256Hex,
  signRunReceipt,
  stableStringify,
  verifyRunReceipt,
} from "./receipts.js";

// Payment utilities
export { payAndFetch, submitXlmPayment, agentToAgentPayment } from "./payments.js";
export { submitCusdPayment, payAndFetchCelo, celoAgentToAgentPayment } from "./payments-celo.js";

// Federation (cross-instance agent routing)
export {
  PeerRegistry,
  routeToPeer,
  verifyPeerTrust,
  getHopCount,
  HOP_COUNT_HEADER,
  MAX_HOP_COUNT,
  MIN_PEER_REPUTATION,
} from "./federation.js";
export type {
  PeerInstance,
  FederatedRouteResult,
  TrustVerification,
} from "./federation.js";

// Multi-chain settlement
export {
  selectChain,
  getDefaultChainPreference,
} from "./settlement.js";
export type {
  SettlementChain,
  SettlementParams,
  SettlementResult,
  SettlementProvider,
  CostEstimate,
  ChainPreference,
} from "./settlement.js";
export { createStellarSettlement } from "./settlement-stellar.js";
export { createCeloSettlement } from "./settlement-celo.js";
export { createBaseSettlement, USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "./settlement-base.js";

// Soroban contract wrappers
export { ShieldContract } from "./contracts/shield.js";
export { IdentityRegistry } from "./contracts/registry.js";

// Celo contract wrappers
export { CeloIdentityRegistry } from "./contracts/celo-registry.js";
export { CeloPolicyManager } from "./contracts/celo-policy.js";
export { Erc8004Adapter } from "./contracts/erc8004-adapter.js";
export { AgentStakingManager } from "./contracts/agent-staking.js";
export { ConsensusVotingManager } from "./contracts/consensus-voting.js";
export { TaskEscrowManager } from "./contracts/task-escrow.js";
export type { EscrowInfo } from "./contracts/task-escrow.js";

// Agent Credentials
export { AgentCredentialManager } from "./contracts/agent-credentials.js";
export type { CredentialInfo } from "./contracts/agent-credentials.js";

// Trust Scores
export {
  calculateTrustScore,
  createDefaultTrustProviders,
  ReputationProvider,
  StakeProvider,
  TaskCompletionProvider,
  EscrowCompletionProvider,
} from "./trust-score.js";
export type {
  TrustScoreProvider,
  TrustScoreBreakdown,
  TrustScoreResult,
  DefaultTrustProviderConfig,
} from "./trust-score.js";

// Capability-Based Routing (Agent DNS)
export { AgentRouter } from "./routing.js";
export type {
  RankedAgent,
  RouteResult,
  AgentRouterOptions,
} from "./routing.js";

// Human Approval Gateway
export {
  ApprovalGateway,
  ApprovalRequiredError,
  approvalMiddleware,
} from "./approval.js";
export type {
  ApprovalRequest,
  ApprovalStatus,
} from "./approval.js";

// Self Protocol
export { isSelfVerified, selfEnforced, SELF_AGENT_REGISTRY } from "./self-protocol.js";

// Delegation / Sub-Orchestration
export {
  delegateTask,
  createSubOrchestrator,
} from "./delegation.js";
export type {
  DelegationOptions,
  DelegationResult,
  SubOrchestratorOptions,
} from "./delegation.js";

// LLM Provider
export {
  AnthropicProvider,
  OpenRouterProvider,
  createLLMProvider,
} from "./llm.js";
export type {
  LLMProvider,
  LLMProviderConfig,
  ChatMessage,
  LLMChatOptions,
  LLMChatResult,
} from "./llm.js";

// Memory (gBrain integration)
export {
  GBrainMemory,
  InMemoryProvider,
  FileMemoryProvider,
  createMemoryProvider,
} from "./memory.js";
export type {
  MemoryProvider,
  MemoryResult,
  GBrainMemoryConfig,
  MemoryProviderConfig,
} from "./memory.js";

// Markdown / Obsidian memory
export { MarkdownMemoryProvider } from "./memory-markdown.js";

// Hermes Agent (Nous Research)
export { createHermesAgent, getHermesMcpConfig } from "./hermes.js";
export type { HermesAgentConfig } from "./hermes.js";

// Tool-use framework
export {
  defineTool,
  createToolkit,
  toOpenAIFunctions,
  toAnthropicTools,
  webFetchTool,
  fileReadTool,
  fileWriteTool,
  shellTool,
  grepTool,
} from "./tools.js";
export type { Tool, ToolResult, Toolkit, OpenAIFunction, AnthropicTool } from "./tools.js";

// Agentic loops
export { createAgentLoop } from "./agent-loop.js";
export type {
  AgentLoopOptions,
  LoopStep,
  LoopResult,
  ThinkResult,
} from "./agent-loop.js";

// Types
export type {
  AgentDefinition,
  AgentDiscoveryQuery,
  AgentContext,
  AgentChain,
  AgentEndpoint,
  AgentManifest,
  AgentPaymentAsset,
  AgentPaymentCapability,
  AgentPaymentProtocol,
  AgentPolicyConstraints,
  AgentRunResult,
  AgentResult,
  RunReceipt,
  RunReceiptAgent,
  RunReceiptPolicy,
  RunReceiptSignature,
  RunReceiptVerification,
  OrchestratorOptions,
  OrchestratorReport,
  Orchestrator,
} from "./types.js";

// Client
export { AegisClient } from "./client.js";
export type {
  AegisClientOptions,
  AegisChatMessage,
  AegisChatCompletionRequest,
  AegisChatCompletionResponse,
} from "./client.js";
