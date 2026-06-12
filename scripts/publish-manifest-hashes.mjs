#!/usr/bin/env node

import { Keypair, SorobanRpc } from "@stellar/stellar-sdk";
import { IdentityRegistry } from "../packages/agent-kit/dist/index.js";

const agentsUrl = process.env.AEGIS_AGENTS_URL ?? "http://localhost:3000/api/agents";
const registryId =
  process.env.REGISTRY_CONTRACT_ID ?? process.env.IDENTITY_REGISTRY_CONTRACT_ID;
const adminSecret = process.env.ORCHESTRATOR_SECRET_KEY;
const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

if (!registryId) {
  console.error("REGISTRY_CONTRACT_ID or IDENTITY_REGISTRY_CONTRACT_ID is required");
  process.exit(1);
}

if (!adminSecret) {
  console.error("ORCHESTRATOR_SECRET_KEY is required");
  process.exit(1);
}

const capabilityByAgent = {
  scout: "scout",
  ledger: "ledger",
  signal: "signal",
  scribe: "scribe",
  executor: "executor",
};

const res = await fetch(agentsUrl);
if (!res.ok) {
  throw new Error(`Could not fetch ${agentsUrl}: ${res.status}`);
}

const body = await res.json();
const agents = Array.isArray(body.agents) ? body.agents : [];
if (agents.length === 0) {
  throw new Error(`No agents found at ${agentsUrl}`);
}

const registry = new IdentityRegistry(
  registryId,
  new SorobanRpc.Server(rpcUrl),
  Keypair.fromSecret(adminSecret)
);

for (const agent of agents) {
  if (!agent.id || !agent.name || !agent.manifestHash) {
    console.warn(`Skipping malformed manifest: ${JSON.stringify(agent)}`);
    continue;
  }

  const capability = capabilityByAgent[agent.id] ?? agent.capabilities?.[0] ?? agent.id;
  await registry.registerAgent(agent.id, agent.name, capability).catch((err) => {
    console.warn(`[${agent.id}] register skipped: ${err instanceof Error ? err.message : err}`);
  });

  const txHash = await registry.setManifestHash(agent.id, agent.manifestHash);
  if (txHash) {
    console.log(`[${agent.id}] manifest hash published: ${agent.manifestHash} tx:${txHash}`);
  } else {
    console.warn(`[${agent.id}] manifest hash publish failed`);
  }
}
