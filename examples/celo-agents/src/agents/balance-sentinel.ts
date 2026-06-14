/**
 * Balance Sentinel Agent
 *
 * Monitors a list of wallet addresses and alerts when any balance
 * drops below a configured threshold.
 */
import { createPublicClient, http, formatEther, parseEther, type Address } from "viem";
import { celo } from "viem/chains";
import { defineAgent, createAutomation } from "@calebux/agent-kit";

export interface WatchedWallet {
  address: Address;
  label?: string;
  /** Minimum CELO balance before alert (default: 1 CELO) */
  thresholdCelo?: string;
}

// Default watched wallets — override via environment or direct import
const DEFAULT_WALLETS: WatchedWallet[] = [
  {
    address: "0x0000000000000000000000000000000000000000",
    label: "example-wallet",
    thresholdCelo: "1",
  },
];

function getWallets(): WatchedWallet[] {
  const envWallets = process.env.WATCHED_WALLETS;
  if (envWallets) {
    try {
      return JSON.parse(envWallets) as WatchedWallet[];
    } catch {
      console.warn("[balance-sentinel] Invalid WATCHED_WALLETS JSON, using defaults");
    }
  }
  return DEFAULT_WALLETS;
}

interface BalanceReport {
  address: string;
  label: string;
  balance: string;
  threshold: string;
  belowThreshold: boolean;
}

export const balanceSentinel = defineAgent({
  id: "celo-balance-sentinel",
  run: async (task) => {
    const client = createPublicClient({
      chain: celo,
      transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
    });

    const wallets = getWallets();
    const reports: BalanceReport[] = [];
    let alertCount = 0;

    for (const w of wallets) {
      const balance = await client.getBalance({ address: w.address });
      const threshold = parseEther(w.thresholdCelo ?? "1");
      const belowThreshold = balance < threshold;
      if (belowThreshold) alertCount++;

      reports.push({
        address: w.address,
        label: w.label ?? w.address.slice(0, 10),
        balance: formatEther(balance),
        threshold: w.thresholdCelo ?? "1",
        belowThreshold,
      });
    }

    return {
      result: JSON.stringify({
        walletsChecked: wallets.length,
        alerts: alertCount,
        reports,
        timestamp: new Date().toISOString(),
      }),
    };
  },
});

export const balanceSentinelAutomation = createAutomation(balanceSentinel, {
  task: "Check wallet balances",
  schedule: "*/15 * * * *", // every 15 minutes
  retries: 2,
  retryDelayMs: 3000,
  onResult: (r) => {
    const data = JSON.parse(r.result);
    if (data.alerts > 0) {
      console.warn(`[balance-sentinel] ${data.alerts} wallet(s) below threshold!`);
      for (const rpt of data.reports) {
        if (rpt.belowThreshold) {
          console.warn(
            `  ${rpt.label}: ${rpt.balance} CELO (threshold: ${rpt.threshold})`
          );
        }
      }
    } else {
      console.log(`[balance-sentinel] all ${data.walletsChecked} wallets OK`);
    }
  },
  onError: (err) => console.error(`[balance-sentinel] error: ${err.message}`),
});
