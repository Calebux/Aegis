/**
 * @calebux/agent-kit
 *
 * Governed multi-agent orchestration on Stellar.
 * Handles wallet provisioning, Soroban spend-cap enforcement,
 * on-chain reputation tracking, and x402 payment flows —
 * so you can focus on writing agent logic.
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

// Self Protocol
export { isSelfVerified, selfEnforced, SELF_AGENT_REGISTRY } from "./self-protocol.js";

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
