#!/usr/bin/env node
/**
 * Register Aegis with Self Protocol Agent ID (Celo mainnet)
 *
 * Registry: 0xaC3DF9ABf80d0F5c020C06B04Cced27763355944
 */

const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const API_BASE = "https://app.ai.self.xyz";

async function main() {
  const deployerAddress = process.env.CELO_DEPLOYER_ADDRESS;
  if (!deployerAddress) {
    console.error("❌ CELO_DEPLOYER_ADDRESS not set in .env.local");
    process.exit(1);
  }

  // 1. Check existing agents
  console.log("🔍 Checking for existing Self Agent IDs…\n");
  try {
    const res = await fetch(`${API_BASE}/api/agent/agents/42220/${deployerAddress}`);
    if (res.ok) {
      const data = await res.json();
      if (data.totalCount > 0) {
        console.log(`✅ Already have ${data.totalCount} agent(s) registered!\n`);
        for (const agent of data.agents) {
          console.log(`   Agent ID:      ${agent.agentId}`);
          console.log(`   Agent Address: ${agent.agentAddress}`);
          console.log(`   Verified:      ${agent.isVerified}`);
        }
        return;
      }
    }
  } catch {}
  console.log("   No existing agents found.\n");

  // 2. Create registration session
  console.log("🔐 Registering Aegis with Self Protocol Agent ID…\n");
  console.log(`   Human wallet: ${deployerAddress}`);
  console.log(`   Network: mainnet (Celo)\n`);

  const regRes = await fetch(`${API_BASE}/api/agent/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "linked",
      network: "mainnet",
      humanAddress: deployerAddress,
      agentName: "Aegis",
      agentDescription: "Multi-chain agent orchestration framework — identity, reputation, spend governance, x402 payments, verifiable receipts.",
      disclosures: { minimumAge: 18, ofac: true },
    }),
  });

  if (!regRes.ok) {
    const err = await regRes.text();
    console.error("❌ Registration request failed:", err);
    process.exit(1);
  }

  const session = await regRes.json();
  let token = session.sessionToken;

  console.log("✅ Registration session created!\n");
  console.log(`   Agent address: ${session.agentAddress}`);
  console.log(`   Expires at:   ${session.expiresAt}`);
  console.log(`   Time left:    ${Math.round(session.timeRemainingMs / 1000)}s\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📱 OPEN THIS LINK ON YOUR PHONE:\n");
  console.log(session.deepLink);
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (session.humanInstructions?.length) {
    console.log("📋 Instructions:");
    session.humanInstructions.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
    console.log();
  }

  // 3. Poll for completion (GET with token query param per OpenAPI spec)
  console.log("⏳ Waiting for you to complete the Self app flow (5 min timeout)…\n");

  const deadline = Date.now() + 300_000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));

    const statusRes = await fetch(
      `${API_BASE}/api/agent/register/status?token=${encodeURIComponent(token)}`
    );

    if (!statusRes.ok) {
      process.stdout.write(".");
      continue;
    }

    const status = await statusRes.json();
    token = status.sessionToken || token;

    process.stdout.write(`[${status.stage}]`);

    if (status.stage === "completed" || status.stage === "registered") {
      console.log("\n\n✅ Self Agent ID registration complete!\n");
      console.log(`   Agent ID:      ${status.agentId}`);
      console.log(`   Agent Address: ${status.agentAddress || session.agentAddress}`);
      console.log(`   Tx Hash:       ${status.txHash || "N/A"}`);
      if (status.credentials) {
        console.log(`   Credentials:   ${JSON.stringify(status.credentials)}`);
      }

      // Export the agent private key
      try {
        const exportRes = await fetch(`${API_BASE}/api/agent/register/export`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (exportRes.ok) {
          const keyData = await exportRes.json();
          console.log(`\n   ⚠️  SAVE THIS — Agent private key:`);
          console.log(`   SELF_AGENT_PRIVATE_KEY=${keyData.privateKey}`);
        }
      } catch {}
      return;
    }

    if (status.stage === "failed") {
      console.error("\n❌ Registration failed on-chain.");
      process.exit(1);
    }

    if (status.stage === "expired") {
      console.error("\n❌ Session expired. Run this script again.");
      process.exit(1);
    }
  }

  console.error("\n❌ Timed out. You can also register at: https://app.ai.self.xyz/agents/register");
  process.exit(1);
}

main().catch(err => {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
});
