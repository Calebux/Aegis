/**
 * Celo settlement provider.
 * Wraps existing submitCusdPayment() functionality.
 */

import type { SettlementProvider, SettlementParams, SettlementResult, CostEstimate } from "./settlement.js";
import { submitCusdPayment } from "./payments-celo.js";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

export function createCeloSettlement(privateKey: Hex): SettlementProvider {
  const account = privateKeyToAccount(privateKey);

  return {
    chain: "celo",

    async settle(params: SettlementParams): Promise<SettlementResult> {
      const txHash = await submitCusdPayment(
        account,
        params.to as Address,
        params.amount
      );
      return {
        chain: "celo",
        txHash,
        amount: params.amount,
        asset: "cUSD",
        timestamp: new Date().toISOString(),
      };
    },

    async estimateCost(_amount: string): Promise<CostEstimate> {
      return {
        chain: "celo",
        feeEstimate: "0.0001", // ~0.0001 CELO gas
        timeEstimateMs: 5_000, // ~5 second block time
        asset: "cUSD",
      };
    },
  };
}
