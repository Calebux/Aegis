#!/usr/bin/env node

/**
 * Register Cal-AgentKit Celo agents on canonical ERC-8004 registries
 * via the Erc8004Adapter bridge contract.
 *
 * Requires:
 *   - ERC8004_ADAPTER_ADDRESS
 *   - CELO_DEPLOYER_PRIVATE_KEY or EVM_PRIVATE_KEY
 *   - CELO_RPC_URL (optional, defaults to mainnet)
 *   - CALAGENT_AGENTS_URL (optional, defaults to localhost:3000)
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoAlfajores } from "viem/chains";

const agentsUrl =
  process.env.CALAGENT_AGENTS_URL ?? "http://localhost:3000/api/agents?chain=celo";
const adapterAddress = process.env.ERC8004_ADAPTER_ADDRESS;
const privateKeyRaw =
  process.env.CELO_DEPLOYER_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY;
const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const network = process.env.CALAGENT_CELO_NETWORK ?? "mainnet";

if (!adapterAddress) {
  console.error("ERC8004_ADAPTER_ADDRESS is required");
  process.exit(1);
}

if (!privateKeyRaw) {
  console.error("CELO_DEPLOYER_PRIVATE_KEY or EVM_PRIVATE_KEY is required");
  process.exit(1);
}

const privateKey = privateKeyRaw.startsWith("0x")
  ? privateKeyRaw
  : `0x${privateKeyRaw}`;

const ADAPTER_ABI = [
  {
    name: "registerAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "calagentId", type: "string" },
      { name: "agentURI", type: "string" },
    ],
    outputs: [{ name: "erc8004Id", type: "uint256" }],
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "calagentId", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

const chain = network === "mainnet" ? celo : celoAlfajores;
const account = privateKeyToAccount(privateKey);
const transport = http(rpcUrl);

const walletClient = createWalletClient({ account, chain, transport });
const publicClient = createPublicClient({ chain, transport });

// Fetch agent manifests
const res = await fetch(agentsUrl);
if (!res.ok) throw new Error(`Could not fetch ${agentsUrl}: ${res.status}`);

const body = await res.json();
const agents = Array.isArray(body.agents) ? body.agents : [];
if (agents.length === 0)
  throw new Error(`No Celo agents found at ${agentsUrl}`);

const origin = new URL(agentsUrl).origin;

for (const agent of agents) {
  if (agent.chain !== "celo") continue;

  // Check if already registered
  const registered = await publicClient.readContract({
    address: adapterAddress,
    abi: ADAPTER_ABI,
    functionName: "isRegistered",
    args: [agent.id],
  });

  if (registered) {
    console.log(`[${agent.id}] Already registered on ERC-8004, skipping.`);
    continue;
  }

  const agentURI = `${origin}/api/agents/${encodeURIComponent(agent.id)}/uri`;

  try {
    const txHash = await walletClient.writeContract({
      address: adapterAddress,
      abi: ADAPTER_ABI,
      functionName: "registerAgent",
      args: [agent.id, agentURI],
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[${agent.id}] Registered on ERC-8004 → tx:${txHash}`);
  } catch (err) {
    console.error(`[${agent.id}] Registration failed:`, err);
  }
}
