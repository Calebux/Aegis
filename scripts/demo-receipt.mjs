#!/usr/bin/env node

const baseUrl = (process.env.CALAGENT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const task =
  process.argv.slice(2).join(" ").trim() ||
  "Analyze Stellar agent infrastructure and explain why governed AI agents need receipts";

function parseSseFrames(buffer) {
  const frames = buffer.split("\n\n");
  return {
    completeFrames: frames.slice(0, -1),
    rest: frames.at(-1) ?? "",
  };
}

async function main() {
  console.log(`Cal-AgentKit demo task: ${task}`);
  console.log(`Dashboard: ${baseUrl}`);

  const res = await fetch(`${baseUrl}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Cal-AgentKit run failed to start: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receipt;
  let complete;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseFrames(buffer);
    buffer = parsed.rest;

    for (const frame of parsed.completeFrames) {
      if (!frame.startsWith("data: ")) continue;
      const event = JSON.parse(frame.slice(6));

      if (event.type === "log") {
        const message = event.payload?.message;
        if (message) console.log(message);
      }
      if (event.type === "complete") complete = event.payload;
      if (event.type === "receipt") receipt = event.payload;
      if (event.type === "error") {
        throw new Error(event.payload?.message ?? "Cal-AgentKit run failed");
      }
    }
  }

  if (!receipt) {
    throw new Error("Run completed without a receipt. Check dashboard logs.");
  }

  const verifyRes = await fetch(`${baseUrl}/api/receipts/${receipt.runId}/verify`);
  const verification = verifyRes.ok ? await verifyRes.json() : null;

  console.log("\n--- Cal-AgentKit Receipt ---");
  console.log(`Receipt URL: ${baseUrl}/receipts/${receipt.runId}`);
  console.log(`Receipt hash: ${receipt.receiptHash}`);
  console.log(`Task hash: ${receipt.taskHash}`);
  console.log(`Output hash: ${receipt.outputHash}`);
  console.log(`Signer: ${receipt.signature?.signer ?? "unsigned"}`);
  console.log(`Total spend: ${(receipt.totalSpentStroops / 1e7).toFixed(4)} XLM`);
  console.log(`Verification: ${verification?.valid ? "valid" : "not valid"}`);
  if (verification?.errors?.length) {
    console.log(`Errors: ${verification.errors.join("; ")}`);
  }
  if (complete?.report) {
    console.log(`Report preview: ${String(complete.report).slice(0, 240)}...`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
