/**
 * Express server exposing each Celo agent as a webhook endpoint.
 *
 * POST /agents/:id  → runs the agent once and returns the result
 * GET  /health      → basic health check
 */
import express from "express";
import { gasTrackerAutomation } from "./agents/gas-tracker.js";
import { usdmYieldMonitorAutomation } from "./agents/cusd-yield-monitor.js";
import { whaleWatcherAutomation } from "./agents/whale-watcher.js";
import { governanceVoterAutomation } from "./agents/governance-voter.js";
import { balanceSentinelAutomation } from "./agents/balance-sentinel.js";
import type { Automation } from "@calebux/agent-kit";

const agents: Record<string, Automation> = {
  "gas-tracker": gasTrackerAutomation,
  "usdm-yield-monitor": usdmYieldMonitorAutomation,
  "whale-watcher": whaleWatcherAutomation,
  "governance-voter": governanceVoterAutomation,
  "balance-sentinel": balanceSentinelAutomation,
};

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    agents: Object.keys(agents),
    timestamp: new Date().toISOString(),
  });
});

// List available agents
app.get("/agents", (_req, res) => {
  res.json({
    agents: Object.keys(agents).map((id) => ({
      id,
      endpoint: `/agents/${id}`,
      running: agents[id].running,
    })),
  });
});

// Run a specific agent
app.post("/agents/:id", async (req, res) => {
  const automation = agents[req.params.id];
  if (!automation) {
    res.status(404).json({ error: `Unknown agent: ${req.params.id}` });
    return;
  }

  // Delegate to the automation's built-in handler
  const webReq = new Request(`http://localhost/agents/${req.params.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body),
  });

  const webRes = await automation.handler(webReq);
  const body = await webRes.json();
  res.status(webRes.status).json(body);
});

// Start/stop cron for an agent
app.post("/agents/:id/cron/start", (req, res) => {
  const automation = agents[req.params.id];
  if (!automation) {
    res.status(404).json({ error: `Unknown agent: ${req.params.id}` });
    return;
  }
  try {
    automation.start();
    res.json({ status: "started", agent: req.params.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.post("/agents/:id/cron/stop", (req, res) => {
  const automation = agents[req.params.id];
  if (!automation) {
    res.status(404).json({ error: `Unknown agent: ${req.params.id}` });
    return;
  }
  automation.stop();
  res.json({ status: "stopped", agent: req.params.id });
});

const PORT = parseInt(process.env.PORT ?? "4000", 10);

app.listen(PORT, () => {
  console.log(`Celo agents server running on http://localhost:${PORT}`);
  console.log(`Available agents: ${Object.keys(agents).join(", ")}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health`);
  console.log(`  GET  /agents`);
  console.log(`  POST /agents/:id`);
  console.log(`  POST /agents/:id/cron/start`);
  console.log(`  POST /agents/:id/cron/stop`);
});
