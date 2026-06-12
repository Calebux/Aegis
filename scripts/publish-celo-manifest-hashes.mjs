#!/usr/bin/env node

import { publishCeloManifestHash } from "../packages/aegis-chain-celo/dist/index.js";

const agentsUrl = process.env.AEGIS_AGENTS_URL ?? "http://localhost:3000/api/agents?chain=celo";
const registryAddress = process.env.CELO_REGISTRY_ADDRESS;
const privateKeyRaw = process.env.CELO_DEPLOYER_PRIVATE_KEY ?? process.env.EVM_PRIVATE_KEY;
const rpcUrl = process.env.CELO_RPC_URL;
const network = process.env.AEGIS_CELO_NETWORK === "mainnet" ? "eip155:42220" : "eip155:44787";

if (!registryAddress) {
  console.error("CELO_REGISTRY_ADDRESS is required");
  process.exit(1);
}

if (!privateKeyRaw) {
  console.error("CELO_DEPLOYER_PRIVATE_KEY or EVM_PRIVATE_KEY is required");
  process.exit(1);
}

const privateKey = privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`;

const res = await fetch(agentsUrl);
if (!res.ok) throw new Error(`Could not fetch ${agentsUrl}: ${res.status}`);

const body = await res.json();
const agents = Array.isArray(body.agents) ? body.agents : [];
if (agents.length === 0) throw new Error(`No Celo agents found at ${agentsUrl}`);

for (const agent of agents) {
  if (agent.chain !== "celo" || !agent.manifestHash) continue;

  const txHash = await publishCeloManifestHash({
    registryAddress,
    privateKey,
    rpcUrl,
    network,
    agentId: agent.id,
    name: agent.name,
    capability: agent.capabilities?.[0] ?? "celo",
    manifestHash: agent.manifestHash,
  });

  console.log(`[${agent.id}] Celo manifest hash published: ${agent.manifestHash} tx:${txHash}`);
}
