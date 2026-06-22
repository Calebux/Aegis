/**
 * Gas Tracker Agent
 *
 * Monitors Celo gas prices via eth_gasPrice. Maintains a simple moving
 * average and flags spikes exceeding 2x the average.
 */
import { createPublicClient, http, formatGwei } from "viem";
import { celo } from "viem/chains";
import { defineAgent, createAutomation } from "@calagent/agent-kit";

const SPIKE_MULTIPLIER = 2n;
const WINDOW_SIZE = 10;

// Rolling window of recent gas prices (in-memory, resets on restart)
const gasPriceHistory: bigint[] = [];

function movingAverage(): bigint {
  if (gasPriceHistory.length === 0) return 0n;
  const sum = gasPriceHistory.reduce((a, b) => a + b, 0n);
  return sum / BigInt(gasPriceHistory.length);
}

export const gasTracker = defineAgent({
  id: "celo-gas-tracker",
  run: async (task) => {
    const client = createPublicClient({
      chain: celo,
      transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
    });

    const gasPrice = await client.getGasPrice();
    const avg = movingAverage();

    // Update rolling window
    gasPriceHistory.push(gasPrice);
    if (gasPriceHistory.length > WINDOW_SIZE) gasPriceHistory.shift();

    const isSpike = avg > 0n && gasPrice > avg * SPIKE_MULTIPLIER;
    const gasPriceGwei = formatGwei(gasPrice);
    const avgGwei = avg > 0n ? formatGwei(avg) : "N/A";

    const status = isSpike ? "SPIKE DETECTED" : "normal";

    return {
      result: JSON.stringify({
        status,
        gasPrice: gasPriceGwei,
        movingAverage: avgGwei,
        sampleCount: gasPriceHistory.length,
        spike: isSpike,
        timestamp: new Date().toISOString(),
      }),
    };
  },
});

export const gasTrackerAutomation = createAutomation(gasTracker, {
  task: "Check Celo gas price",
  schedule: "*/5 * * * *", // every 5 minutes
  retries: 2,
  retryDelayMs: 3000,
  onResult: (r) => {
    const data = JSON.parse(r.result);
    if (data.spike) {
      console.warn(`[gas-tracker] SPIKE: ${data.gasPrice} gwei (avg: ${data.movingAverage})`);
    } else {
      console.log(`[gas-tracker] ${data.gasPrice} gwei — normal`);
    }
  },
  onError: (err) => console.error(`[gas-tracker] error: ${err.message}`),
});
