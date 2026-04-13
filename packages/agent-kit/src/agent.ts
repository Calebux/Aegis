import type { AgentDefinition } from "./types.js";

/**
 * Define a governed agent for use with `createOrchestrator`.
 *
 * @example
 * ```ts
 * const analyst = defineAgent({
 *   id: 'analyst',
 *   spendCapXlm: 1,
 *   run: async (task, { wallet, pay, txHashes }) => {
 *     const data = await pay<MyData>('https://my-x402-api.com/data')
 *     return { result: JSON.stringify(data), spentStroops: 100_000n }
 *   }
 * })
 * ```
 */
export function defineAgent(config: AgentDefinition): AgentDefinition {
  return config;
}
