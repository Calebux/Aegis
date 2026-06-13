/**
 * Base settlement provider.
 * USDC transfers on Base via viem.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { SettlementProvider, SettlementParams, SettlementResult, CostEstimate } from "./settlement.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** USDC on Base mainnet (Circle) */
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
/** USDC on Base Sepolia testnet */
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const USDC_DECIMALS = 6;

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBaseChain() {
  const network = process.env.BASE_NETWORK ?? "mainnet";
  return network === "sepolia" ? baseSepolia : base;
}

function getUsdcAddress(): Address {
  const network = process.env.BASE_NETWORK ?? "mainnet";
  return (network === "sepolia" ? USDC_BASE_SEPOLIA : USDC_BASE_MAINNET) as Address;
}

function getRpcUrl(): string {
  return (
    process.env.BASE_RPC_URL ??
    (getBaseChain().id === 8453
      ? "https://mainnet.base.org"
      : "https://sepolia.base.org")
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function createBaseSettlement(privateKey: Hex): SettlementProvider {
  const account = privateKeyToAccount(privateKey);
  const chain = getBaseChain();
  const transport = http(getRpcUrl());

  return {
    chain: "base",

    async settle(params: SettlementParams): Promise<SettlementResult> {
      const walletClient = createWalletClient({ account, chain, transport });
      const publicClient = createPublicClient({ chain, transport });

      const amount = parseUnits(params.amount, USDC_DECIMALS);
      const usdcAddress = getUsdcAddress();

      const txHash = await walletClient.writeContract({
        address: usdcAddress,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [params.to as Address, amount],
        account,
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      return {
        chain: "base",
        txHash,
        amount: params.amount,
        asset: "USDC",
        timestamp: new Date().toISOString(),
      };
    },

    async estimateCost(_amount: string): Promise<CostEstimate> {
      return {
        chain: "base",
        feeEstimate: "0.000005", // ~0.000005 ETH on Base (L2 fees)
        timeEstimateMs: 2_000, // ~2 second block time
        asset: "USDC",
      };
    },
  };
}

export { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA, USDC_DECIMALS };
