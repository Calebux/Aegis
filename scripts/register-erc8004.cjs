#!/usr/bin/env node
/**
 * Register Aegis on the ERC-8004 Identity Registry (Celo mainnet)
 *
 * Registry: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 */

const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Fix the BigInt JSON serialization bug in the SDK
BigInt.prototype.toJSON = function () { return this.toString(); };

const { ChaosChainSDK, NetworkConfig } = require("@chaoschain/sdk");

const privateKey = process.env.CELO_DEPLOYER_PRIVATE_KEY;
if (!privateKey) {
  console.error("❌ CELO_DEPLOYER_PRIVATE_KEY not set");
  process.exit(1);
}

async function main() {
  console.log("🔗 Registering Aegis on ERC-8004 Identity Registry (Celo mainnet)…\n");

  const sdk = new ChaosChainSDK({
    agentName: "aegis",
    agentDomain: "aegis.calebux.com",
    agentRole: "orchestrator",
    network: NetworkConfig.CELO_MAINNET,
    privateKey: privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
    rpcUrl: process.env.CELO_RPC_URL || "https://forno.celo.org",
    enablePayments: false,
    enableStorage: false,
    enableProcessIntegrity: false,
  });

  try {
    const registration = await sdk.registerIdentity({
      name: "Aegis",
      domain: "aegis.calebux.com",
      role: "orchestrator",
      capabilities: [
        "agent-orchestration",
        "on-chain-identity",
        "on-chain-reputation",
        "spend-governance",
        "x402-payments",
        "verifiable-receipts",
        "agent-discovery",
        "celo",
        "stellar",
      ],
      version: "0.2.1",
      description:
        "Multi-chain agent orchestration framework — identity registry, policy enforcement, x402 micropayments, verifiable run receipts. Live on Celo mainnet and Stellar testnet.",
    });

    console.log("✅ ERC-8004 registration successful!\n");
    console.log(`   Agent ID:  ${registration.agentId}`);
    console.log(`   Tx Hash:   ${registration.txHash}`);
    console.log(`   Owner:     ${registration.owner}`);
    console.log(`\n   View on CeloScan: https://celoscan.io/tx/${registration.txHash}`);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("already") || msg.includes("exists") || msg.includes("minted")) {
      console.log("ℹ️  Agent already registered on ERC-8004.");
      const agentId = sdk.getAgentId?.();
      if (agentId !== undefined) {
        console.log(`   Existing Agent ID: ${agentId}`);
      }
    } else {
      console.error("❌ Registration failed:", err.message || err);
      process.exit(1);
    }
  }
}

main();
