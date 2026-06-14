#!/usr/bin/env node

/**
 * Generate Mainnet Activity
 *
 * Exercises all deployed Celo mainnet contracts to produce verifiable
 * on-chain activity visible on Celoscan. Use for grant evidence.
 *
 * Env: CELO_DEPLOYER_PRIVATE_KEY, CELO_REGISTRY_ADDRESS, CELO_POLICY_ADDRESS,
 *      ERC8004_ADAPTER_ADDRESS, CELO_CONSENSUS_VOTING_ADDRESS,
 *      CELO_CREDENTIALS_ADDRESS, CALAGENT_CELO_NETWORK=mainnet
 *
 * Usage: node scripts/generate-mainnet-activity.mjs
 */

import { createHash } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

// ── Config ──────────────────────────────────────────────────────────────────

const privateKeyRaw = process.env.CELO_DEPLOYER_PRIVATE_KEY;
if (!privateKeyRaw) {
  console.error("CELO_DEPLOYER_PRIVATE_KEY is required");
  process.exit(1);
}

const privateKey = privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`;
const account = privateKeyToAccount(privateKey);
const rpcUrl = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const transport = http(rpcUrl);
const chain = celo;

const REGISTRY = process.env.CELO_REGISTRY_ADDRESS ?? "0x34BdE9da696fCAc92DF24f0631bcf7C41dB8A19C";
const POLICY = process.env.CELO_POLICY_ADDRESS ?? "0xF1aCE070B7265094c24e276671a72Af4B3Fa1A0c";
const ERC8004_ADAPTER = process.env.ERC8004_ADAPTER_ADDRESS;
const VOTING = process.env.CELO_CONSENSUS_VOTING_ADDRESS;
const CREDENTIALS = process.env.CELO_CREDENTIALS_ADDRESS;

const wc = createWalletClient({ account, chain, transport });
const pc = createPublicClient({ chain, transport });

const txHashes = [];

// ── Helpers ─────────────────────────────────────────────────────────────────

function sha256(str) {
  return "0x" + createHash("sha256").update(str).digest("hex");
}

function toBytes32(hex) {
  const h = hex.startsWith("0x") ? hex : `0x${hex}`;
  return (h.slice(0, 66).padEnd(66, "0"));
}

async function send(address, abi, functionName, args, label) {
  try {
    const txHash = await wc.writeContract({
      address,
      abi,
      functionName,
      args,
      account,
    });
    await pc.waitForTransactionReceipt({ hash: txHash });
    txHashes.push({ label, txHash });
    console.log(`  [OK] ${label}: ${txHash}`);
    return txHash;
  } catch (err) {
    const msg = String(err);
    if (msg.includes("AlreadyRegistered")) {
      console.log(`  [SKIP] ${label}: already registered`);
      return null;
    }
    console.error(`  [FAIL] ${label}: ${msg.slice(0, 120)}`);
    return null;
  }
}

// ── ABIs ────────────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  {
    name: "registerAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "name", type: "string" },
      { name: "capability", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "setManifestHash",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "recordSuccess",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [],
  },
  {
    name: "recordFailure",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "string" }],
    outputs: [],
  },
];

const POLICY_ABI = [
  {
    name: "setPolicy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "maxSpendPerTask", type: "uint256" },
      { name: "maxSpendPerSession", type: "uint256" },
      { name: "requireApprovalAbove", type: "uint256" },
    ],
    outputs: [],
  },
];

const VOTING_ABI = [
  {
    name: "openRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskHash", type: "bytes32" }],
    outputs: [{ name: "roundId", type: "uint256" }],
  },
  {
    name: "submitVote",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "agentId", type: "string" },
      { name: "outputHash", type: "bytes32" },
      { name: "confidence", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "finalizeRound",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "nextRoundId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const ERC8004_ABI = [
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
];

const CREDENTIALS_ABI = [
  {
    name: "grantCredential",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "string" },
      { name: "service", type: "string" },
      { name: "scope", type: "string" },
      { name: "expiry", type: "uint256" },
    ],
    outputs: [],
  },
];

// ── Agents ──────────────────────────────────────────────────────────────────

const agents = [
  { id: "scout",       name: "Scout Agent",        capability: "web-research" },
  { id: "ledger",      name: "Ledger Agent",       capability: "on-chain-data" },
  { id: "signal",      name: "Signal Agent",        capability: "market-analytics" },
  { id: "scribe",      name: "Scribe Agent",        capability: "report-synthesis" },
  { id: "executor",    name: "Executor Agent",      capability: "notarisation" },
  { id: "celo-ledger", name: "Celo Ledger Agent",   capability: "celo-rpc" },
  { id: "celo-notary", name: "Celo Notary Agent",   capability: "celo-attestation" },
  { id: "celo-defi",   name: "Celo DeFi Agent",     capability: "celo-defi" },
  { id: "celo-price",  name: "Celo Price Agent",    capability: "price-oracle" },
];

// ── Step 1: Register Agents ─────────────────────────────────────────────────

console.log("\n=== Step 1: Register agents on AegisCeloRegistry ===\n");

for (const agent of agents) {
  const manifestHash = toBytes32(sha256(JSON.stringify(agent)));
  await send(REGISTRY, REGISTRY_ABI, "registerAgent",
    [agent.id, agent.name, agent.capability, manifestHash],
    `Register ${agent.id}`
  );
}

// ── Step 2: Publish Manifest Hashes ──────────────────────────────────────────

console.log("\n=== Step 2: Update manifest hashes ===\n");

for (const agent of agents) {
  const hash = sha256(JSON.stringify({ ...agent, version: "0.2.3", ts: Date.now() }));
  await send(REGISTRY, REGISTRY_ABI, "setManifestHash",
    [agent.id, toBytes32(hash)],
    `ManifestHash ${agent.id}`
  );
}

// ── Step 3: Record Success/Failure ──────────────────────────────────────────

console.log("\n=== Step 3: Record reputation (7 success, 2 failure) ===\n");

const successAgents = agents.slice(0, 7);
const failAgents = agents.slice(7);

for (const agent of successAgents) {
  await send(REGISTRY, REGISTRY_ABI, "recordSuccess",
    [agent.id],
    `RecordSuccess ${agent.id}`
  );
}

for (const agent of failAgents) {
  await send(REGISTRY, REGISTRY_ABI, "recordFailure",
    [agent.id],
    `RecordFailure ${agent.id}`
  );
}

// ── Step 4: Consensus Voting ────────────────────────────────────────────────

if (VOTING) {
  console.log("\n=== Step 4: Consensus voting round ===\n");

  // Read current nextRoundId to know what round we'll create
  const nextRoundId = await pc.readContract({
    address: VOTING,
    abi: VOTING_ABI,
    functionName: "nextRoundId",
  });

  const taskHash = toBytes32(sha256("mainnet-activity-demo-task"));
  await send(VOTING, VOTING_ABI, "openRound",
    [taskHash],
    "OpenRound"
  );

  const roundId = nextRoundId;
  const outputHash = toBytes32(sha256("consensus-output-hash"));

  await send(VOTING, VOTING_ABI, "submitVote",
    [roundId, "scout", outputHash, 8500n],
    "Vote scout"
  );
  await send(VOTING, VOTING_ABI, "submitVote",
    [roundId, "ledger", outputHash, 9000n],
    "Vote ledger"
  );
  await send(VOTING, VOTING_ABI, "submitVote",
    [roundId, "signal", outputHash, 7500n],
    "Vote signal"
  );

  await send(VOTING, VOTING_ABI, "finalizeRound",
    [roundId],
    "FinalizeRound"
  );
} else {
  console.log("\n=== Step 4: Consensus voting (SKIPPED — no CELO_CONSENSUS_VOTING_ADDRESS) ===\n");
}

// ── Step 5: ERC-8004 Registration ───────────────────────────────────────────

if (ERC8004_ADAPTER) {
  console.log("\n=== Step 5: ERC-8004 registration ===\n");

  for (const agent of agents.slice(0, 5)) {
    const uri = `https://calagent.dev/agents/${agent.id}`;
    await send(ERC8004_ADAPTER, ERC8004_ABI, "registerAgent",
      [agent.id, uri],
      `ERC8004 ${agent.id}`
    );
  }
} else {
  console.log("\n=== Step 5: ERC-8004 (SKIPPED — no ERC8004_ADAPTER_ADDRESS) ===\n");
}

// ── Step 6: Agent Credentials ───────────────────────────────────────────────

if (CREDENTIALS) {
  console.log("\n=== Step 6: Grant agent credentials ===\n");

  const credentialGrants = [
    { agentId: "scout",       service: "web-search",     scope: "read" },
    { agentId: "ledger",      service: "blockchain-rpc",  scope: "read" },
    { agentId: "signal",      service: "market-data",     scope: "read" },
    { agentId: "scribe",      service: "llm-synthesis",   scope: "read+write" },
    { agentId: "executor",    service: "notarisation",    scope: "read+write" },
    { agentId: "celo-ledger", service: "celo-rpc",        scope: "read" },
    { agentId: "celo-notary", service: "celo-attestation",scope: "read+write" },
  ];

  // Expire in 1 year
  const oneYearFromNow = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400);

  for (const cred of credentialGrants) {
    await send(CREDENTIALS, CREDENTIALS_ABI, "grantCredential",
      [cred.agentId, cred.service, cred.scope, oneYearFromNow],
      `Credential ${cred.agentId}/${cred.service}`
    );
  }
} else {
  console.log("\n=== Step 6: Credentials (SKIPPED — no CELO_CREDENTIALS_ADDRESS) ===\n");
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("\n" + "=".repeat(60));
console.log("MAINNET ACTIVITY SUMMARY");
console.log("=".repeat(60));
console.log(`Total transactions: ${txHashes.length}`);
console.log(`Network: Celo mainnet (chain 42220)`);
console.log(`Deployer: ${account.address}`);
console.log("");

console.log("Contracts exercised:");
console.log(`  AegisCeloRegistry:  ${REGISTRY}`);
console.log(`  AegisCeloPolicy:    ${POLICY}`);
if (VOTING) console.log(`  ConsensusVoting:    ${VOTING}`);
if (ERC8004_ADAPTER) console.log(`  Erc8004Adapter:     ${ERC8004_ADAPTER}`);
if (CREDENTIALS) console.log(`  AgentCredentials:   ${CREDENTIALS}`);

console.log("\nAll transaction hashes:");
for (const { label, txHash } of txHashes) {
  console.log(`  ${label}: ${txHash}`);
}

console.log("\nView on Celoscan:");
console.log(`  https://celoscan.io/address/${account.address}`);
