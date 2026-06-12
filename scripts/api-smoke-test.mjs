#!/usr/bin/env node

const baseUrl = (process.env.AEGIS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function request(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const body = await res.json().catch(() => null);
  return { res, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`Aegis API smoke test: ${baseUrl}`);

const health = await request("/api/health");
assert(health.res.ok, `/api/health returned ${health.res.status}`);
assert(health.body?.ok === true, "/api/health did not return ok=true");
console.log("ok /api/health");

const openapi = await request("/api/openapi.json");
assert(openapi.res.ok, `/api/openapi.json returned ${openapi.res.status}`);
assert(openapi.body?.openapi === "3.1.0", "/api/openapi.json missing OpenAPI version");
console.log("ok /api/openapi.json");

const agents = await request("/api/agents?asset=USDC");
assert(agents.res.ok, `/api/agents returned ${agents.res.status}`);
assert(Array.isArray(agents.body?.agents), "/api/agents missing agents array");
assert(agents.body.agents.length > 0, "/api/agents returned no agents");
assert(
  agents.body.agents.every((agent) => typeof agent.manifestHash === "string"),
  "/api/agents missing manifestHash on at least one agent"
);
console.log(`ok /api/agents (${agents.body.agents.length} agents)`);

const celoAgents = await request("/api/agents?chain=celo");
assert(celoAgents.res.ok, `/api/agents?chain=celo returned ${celoAgents.res.status}`);
assert(celoAgents.body?.agents?.length > 0, "/api/agents?chain=celo returned no agents");
assert(
  celoAgents.body.agents.every((agent) => agent.chain === "celo"),
  "/api/agents?chain=celo returned a non-Celo agent"
);
console.log(`ok /api/agents?chain=celo (${celoAgents.body.agents.length} agents)`);

const run = await request("/api/agents/ledger/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ task: "Smoke-test Stellar Ledger external agent" }),
});

if (run.res.status === 402) {
  assert(
    run.res.headers.get("PAYMENT-REQUIRED") ??
      run.res.headers.get("X-Payment") ??
      run.res.headers.get("X-PAYMENT-REQUIRED"),
    "402 response missing x402 payment-required header"
  );
  console.log("ok /api/agents/ledger/run returned x402 402 challenge");
  process.exit(0);
}

assert(run.res.ok, `/api/agents/ledger/run returned ${run.res.status}`);
assert(run.body?.receipt?.runId, "Ledger run missing receipt.runId");
assert(run.body?.receipt?.payments?.[0]?.asset === "USDC", "Receipt missing USDC payment metadata");
console.log(`ok /api/agents/ledger/run receipt ${run.body.receipt.receiptHash}`);

const verify = await request(`/api/receipts/${run.body.receipt.runId}/verify`);
assert(verify.res.ok, `/api/receipts/:id/verify returned ${verify.res.status}`);
assert(verify.body?.valid === true, "Receipt verification not valid");
assert(verify.body?.outputChecked === true, "Receipt verification did not check stored output");
console.log("ok /api/receipts/:id/verify");

const celoRun = await request("/api/agents/celo-ledger/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ task: "Smoke-test Celo Ledger external agent" }),
});
assert(celoRun.res.ok || celoRun.res.status === 402, `/api/agents/celo-ledger/run returned ${celoRun.res.status}`);
if (celoRun.res.ok) {
  assert(celoRun.body?.receipt?.runId, "Celo Ledger run missing receipt.runId");
  assert(celoRun.body?.agent?.chain === "celo", "Celo Ledger run did not return a Celo agent");
  console.log(`ok /api/agents/celo-ledger/run receipt ${celoRun.body.receipt.receiptHash}`);
} else {
  console.log("ok /api/agents/celo-ledger/run returned x402 402 challenge");
}

console.log("Aegis API smoke test passed");
