#!/usr/bin/env node

const baseUrl = (process.env.CALAGENT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const task =
  process.argv.slice(2).join(" ").trim() ||
  "Show me the current Stellar network state and prove the agent output.";

async function json(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const paymentHeader =
      res.headers.get("PAYMENT-REQUIRED") ??
      res.headers.get("X-Payment") ??
      res.headers.get("X-PAYMENT-REQUIRED");
    return { status: res.status, body, paymentHeader };
  }
  return { status: res.status, body };
}

console.log(`Cal-AgentKit Stellar agent infrastructure demo`);
console.log(`Base URL: ${baseUrl}`);
console.log("");

const agents = await json("/api/agents");
if (agents.status !== 200) {
  throw new Error(`Could not discover agents: ${agents.status}`);
}

console.log(`1. Discovered ${agents.body.count} agents from /api/agents`);
for (const agent of agents.body.agents) {
  console.log(
    `   - ${agent.id}: ${agent.payments?.[0]?.asset ?? "asset"} ${agent.payments?.[0]?.protocol ?? "payment"} ${agent.payments?.[0]?.network ?? "network"} hash:${agent.manifestHash?.slice(0, 12)}...`
  );
}

console.log("");
console.log(`2. Calling Ledger external agent`);
const run = await json("/api/agents/ledger/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ task }),
});

if (run.status === 402) {
  console.log("   Payment required before execution.");
  console.log(`   PAYMENT-REQUIRED: ${run.paymentHeader}`);
  console.log("   Re-run with a PAYMENT-SIGNATURE header from an x402 client.");
  process.exit(0);
}

if (run.status !== 200) {
  throw new Error(`Ledger call failed: ${run.status} ${JSON.stringify(run.body)}`);
}

console.log(`   Receipt hash: ${run.body.receipt.receiptHash}`);
console.log(`   Verification URL: ${run.body.verificationUrl}`);
console.log(`   Payment mode: ${run.body.payment.verificationMode}`);

console.log("");
console.log("3. Verifying receipt");
const verify = await json(`/api/receipts/${run.body.receipt.runId}/verify`);
if (verify.status !== 200) {
  throw new Error(`Receipt verification failed: ${verify.status}`);
}
console.log(`   Valid: ${verify.body.valid}`);
console.log(`   Signature valid: ${verify.body.signatureValid ?? "unsigned"}`);
