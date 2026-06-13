#!/usr/bin/env node

const baseUrl = (process.env.CALAGENT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const chain = process.env.CALAGENT_AGENT_CHAIN ?? process.argv[2] ?? "celo";
const agentId =
  process.env.CALAGENT_AGENT_ID ?? (chain === "stellar" ? "ledger" : "celo-ledger");
const task =
  process.argv.slice(3).join(" ").trim() ||
  `Run a verifiable ${chain} ledger read`;

async function getJson(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const body = await res.json().catch(() => null);
  return { res, body };
}

console.log(`Cal-AgentKit x402 agent client`);
console.log(`Base URL: ${baseUrl}`);
console.log(`Chain: ${chain}`);
console.log(`Agent: ${agentId}`);
console.log("");

const discovery = await getJson(`/api/agents?chain=${encodeURIComponent(chain)}`);
if (!discovery.res.ok) {
  throw new Error(`Discovery failed: ${discovery.res.status}`);
}

console.log(`Discovered ${discovery.body.agents.length} ${chain} agent(s)`);
const agent = discovery.body.agents.find((candidate) => candidate.id === agentId);
if (!agent) {
  throw new Error(`Agent ${agentId} was not found for chain ${chain}`);
}

const headers = { "Content-Type": "application/json" };
if (process.env.PAYMENT_SIGNATURE) {
  headers["PAYMENT-SIGNATURE"] = process.env.PAYMENT_SIGNATURE;
}

const run = await getJson(`/api/agents/${encodeURIComponent(agentId)}/run`, {
  method: "POST",
  headers,
  body: JSON.stringify({ task }),
});

if (run.res.status === 402) {
  const challenge =
    run.res.headers.get("PAYMENT-REQUIRED") ??
    run.res.headers.get("X-Payment") ??
    run.res.headers.get("X-PAYMENT-REQUIRED");
  console.log("Payment required.");
  console.log(`PAYMENT-REQUIRED=${challenge}`);
  console.log("");
  console.log("Create a payment with an x402-compatible wallet/client, then rerun:");
  console.log("PAYMENT_SIGNATURE=... npm run example:x402-agent -- " + chain);
  process.exit(0);
}

if (!run.res.ok) {
  throw new Error(`Agent call failed: ${run.res.status} ${JSON.stringify(run.body)}`);
}

const receipt = run.body.receipt;
console.log(`Receipt: ${receipt.receiptHash}`);
console.log(`Verification URL: ${run.body.verificationUrl}`);
console.log(`Payment mode: ${run.body.payment.verificationMode}`);

const verification = await getJson(`/api/receipts/${receipt.runId}/verify`);
if (!verification.res.ok) {
  throw new Error(`Receipt verification failed: ${verification.res.status}`);
}

console.log(`Verified: ${verification.body.valid}`);
console.log(`Output checked: ${verification.body.outputChecked}`);
