/**
 * USDm (Mento Dollar) Yield Monitor Agent
 *
 * Tracks USDm total supply via the ERC-20 totalSupply() call.
 * Reports supply changes (mint/burn activity) between runs.
 *
 * Note: USDm is the rebranded cUSD (Celo Dollar → Mento Dollar).
 * The contract address is unchanged.
 */
import { createPublicClient, http, formatUnits } from "viem";
import { celo } from "viem/chains";
import { defineAgent, createAutomation } from "@calagent/agent-kit";

// USDm (formerly cUSD) — same contract, rebranded symbol
const USDM_ADDRESS = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as const;

const ERC20_ABI = [
  {
    type: "function" as const,
    name: "totalSupply",
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Track previous supply for delta calculation
let previousSupply: bigint | null = null;

export const usdmYieldMonitor = defineAgent({
  id: "celo-usdm-yield-monitor",
  run: async (task) => {
    const client = createPublicClient({
      chain: celo,
      transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
    });

    const totalSupply = await client.readContract({
      address: USDM_ADDRESS,
      abi: ERC20_ABI,
      functionName: "totalSupply",
    });

    const supplyFormatted = formatUnits(totalSupply, 18);
    const delta = previousSupply !== null ? totalSupply - previousSupply : 0n;
    const deltaFormatted = previousSupply !== null ? formatUnits(delta, 18) : "N/A (first run)";

    const activity =
      delta > 0n ? "NET_MINT" : delta < 0n ? "NET_BURN" : "STABLE";

    previousSupply = totalSupply;

    return {
      result: JSON.stringify({
        asset: "USDm",
        totalSupply: supplyFormatted,
        delta: deltaFormatted,
        activity: previousSupply !== null ? activity : "INITIAL",
        timestamp: new Date().toISOString(),
      }),
    };
  },
});

export const usdmYieldMonitorAutomation = createAutomation(usdmYieldMonitor, {
  task: "Check USDm total supply",
  schedule: "0 * * * *", // every hour
  retries: 2,
  retryDelayMs: 5000,
  onResult: (r) => {
    const data = JSON.parse(r.result);
    console.log(
      `[usdm-yield] supply: ${data.totalSupply} USDm | delta: ${data.delta} | ${data.activity}`
    );
  },
  onError: (err) => console.error(`[usdm-yield] error: ${err.message}`),
});
