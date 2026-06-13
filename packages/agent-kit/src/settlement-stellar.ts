/**
 * Stellar settlement provider.
 * Wraps existing submitXlmPayment() + DEX settle functionality.
 */

import type { SettlementProvider, SettlementParams, SettlementResult, CostEstimate } from "./settlement.js";
import { submitXlmPayment } from "./payments.js";
import { Keypair } from "@stellar/stellar-sdk";

export function createStellarSettlement(keypair: Keypair): SettlementProvider {
  return {
    chain: "stellar",

    async settle(params: SettlementParams): Promise<SettlementResult> {
      const txHash = await submitXlmPayment(keypair, params.to, params.amount);
      return {
        chain: "stellar",
        txHash,
        amount: params.amount,
        asset: "XLM",
        timestamp: new Date().toISOString(),
      };
    },

    async estimateCost(_amount: string): Promise<CostEstimate> {
      return {
        chain: "stellar",
        feeEstimate: "0.00001", // 100 stroops = 0.00001 XLM
        timeEstimateMs: 5_000, // ~5 second finality
        asset: "XLM",
      };
    },
  };
}
