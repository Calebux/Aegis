/**
 * Governance Voter Agent
 *
 * Monitors Celo Governance contract for active proposals.
 * Reports proposal IDs, descriptions, and voting status.
 */
import { createPublicClient, http, type Address } from "viem";
import { celo } from "viem/chains";
import { defineAgent, createAutomation } from "@calebux/agent-kit";

// Celo Governance proxy (mainnet)
const GOVERNANCE_ADDRESS: Address = "0xD533Ca259b330c7A88f74E000a3FaEa2d63B7972";

const GOVERNANCE_ABI = [
  {
    type: "function" as const,
    name: "dequeued",
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function" as const,
    name: "getProposal",
    stateMutability: "view" as const,
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      { name: "proposer", type: "address" },
      { name: "deposit", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "transactionCount", type: "uint256" },
      { name: "descriptionUrl", type: "string" },
    ],
  },
  {
    type: "function" as const,
    name: "proposalCount",
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface ProposalInfo {
  id: string;
  proposer: string;
  deposit: string;
  timestamp: string;
  descriptionUrl: string;
}

export const governanceVoter = defineAgent({
  id: "celo-governance-voter",
  run: async (task) => {
    const client = createPublicClient({
      chain: celo,
      transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
    });

    let proposalCount: bigint;
    try {
      proposalCount = await client.readContract({
        address: GOVERNANCE_ADDRESS,
        abi: GOVERNANCE_ABI,
        functionName: "proposalCount",
      });
    } catch {
      // Contract may not be accessible — return graceful fallback
      return {
        result: JSON.stringify({
          status: "unavailable",
          message: "Could not read Governance contract. It may have been upgraded.",
          timestamp: new Date().toISOString(),
        }),
      };
    }

    // Fetch the last 5 proposals (or fewer if less exist)
    const count = Number(proposalCount);
    const start = Math.max(1, count - 4);
    const proposals: ProposalInfo[] = [];

    for (let i = start; i <= count; i++) {
      try {
        const [proposer, deposit, timestamp, , descriptionUrl] =
          await client.readContract({
            address: GOVERNANCE_ADDRESS,
            abi: GOVERNANCE_ABI,
            functionName: "getProposal",
            args: [BigInt(i)],
          });

        proposals.push({
          id: i.toString(),
          proposer,
          deposit: deposit.toString(),
          timestamp: new Date(Number(timestamp) * 1000).toISOString(),
          descriptionUrl,
        });
      } catch {
        // Proposal may not exist or contract reverted — skip
      }
    }

    return {
      result: JSON.stringify({
        totalProposals: count,
        recentProposals: proposals,
        timestamp: new Date().toISOString(),
      }),
    };
  },
});

export const governanceVoterAutomation = createAutomation(governanceVoter, {
  task: "Check Celo governance proposals",
  schedule: "0 */6 * * *", // every 6 hours
  retries: 2,
  retryDelayMs: 5000,
  onResult: (r) => {
    const data = JSON.parse(r.result);
    if (data.status === "unavailable") {
      console.log(`[governance] ${data.message}`);
      return;
    }
    console.log(
      `[governance] ${data.totalProposals} total proposals, showing last ${data.recentProposals.length}`
    );
    for (const p of data.recentProposals) {
      console.log(`  #${p.id} by ${p.proposer.slice(0, 10)}... — ${p.descriptionUrl || "(no URL)"}`);
    }
  },
  onError: (err) => console.error(`[governance] error: ${err.message}`),
});
