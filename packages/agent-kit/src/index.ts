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

// Payment utilities
export { payAndFetch, submitXlmPayment, agentToAgentPayment } from "./payments.js";

// Soroban contract wrappers
export { ShieldContract } from "./contracts/shield.js";
export { IdentityRegistry } from "./contracts/registry.js";

// Types
export type {
  AgentDefinition,
  AgentContext,
  AgentRunResult,
  AgentResult,
  OrchestratorOptions,
  OrchestratorReport,
  Orchestrator,
} from "./types.js";
