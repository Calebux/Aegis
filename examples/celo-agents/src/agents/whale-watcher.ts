/**
 * Whale Watcher Agent
 *
 * Scans recent Celo blocks for large CELO transfers (>10k CELO).
 * Reports whale movements with sender, receiver, and amount.
 */
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { celo } from "viem/chains";
import { defineAgent, createAutomation } from "@calebux/agent-kit";

const WHALE_THRESHOLD = parseEther("10000"); // 10k CELO
const BLOCKS_TO_SCAN = 20;

interface WhaleTransfer {
  blockNumber: string;
  from: string;
  to: string;
  value: string;
  hash: string;
}

export const whaleWatcher = defineAgent({
  id: "celo-whale-watcher",
  run: async (task) => {
    const client = createPublicClient({
      chain: celo,
      transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
    });

    const latestBlock = await client.getBlockNumber();
    const whaleTransfers: WhaleTransfer[] = [];

    // Scan recent blocks for large transfers
    const startBlock = latestBlock - BigInt(BLOCKS_TO_SCAN);
    for (let i = startBlock; i <= latestBlock; i++) {
      const block = await client.getBlock({
        blockNumber: i,
        includeTransactions: true,
      });

      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        if (tx.value >= WHALE_THRESHOLD) {
          whaleTransfers.push({
            blockNumber: i.toString(),
            from: tx.from,
            to: tx.to ?? "contract-creation",
            value: formatEther(tx.value),
            hash: tx.hash,
          });
        }
      }
    }

    return {
      result: JSON.stringify({
        blocksScanned: BLOCKS_TO_SCAN,
        latestBlock: latestBlock.toString(),
        whaleTransfers,
        whaleCount: whaleTransfers.length,
        threshold: "10000 CELO",
        timestamp: new Date().toISOString(),
      }),
    };
  },
});

export const whaleWatcherAutomation = createAutomation(whaleWatcher, {
  task: "Scan for whale CELO transfers",
  schedule: "*/10 * * * *", // every 10 minutes
  retries: 2,
  retryDelayMs: 5000,
  onResult: (r) => {
    const data = JSON.parse(r.result);
    if (data.whaleCount > 0) {
      console.warn(
        `[whale-watcher] ${data.whaleCount} whale transfer(s) detected!`
      );
      for (const t of data.whaleTransfers) {
        console.warn(`  ${t.value} CELO: ${t.from} → ${t.to}`);
      }
    } else {
      console.log(`[whale-watcher] no whale activity in last ${data.blocksScanned} blocks`);
    }
  },
  onError: (err) => console.error(`[whale-watcher] error: ${err.message}`),
});
