/**
 * Cloudflare Worker — Celo agent runner.
 *
 * Handles both HTTP triggers and scheduled (cron) triggers.
 *
 * Note: This is a reference implementation. In practice you'd bundle
 * the agent code with wrangler. viem works in Workers runtime.
 */

export interface Env {
  CELO_RPC_URL: string;
}

// Inline a minimal gas-tracker for the Worker example.
// For production, import from the agents directory after bundling.
async function runGasTracker(rpcUrl: string): Promise<object> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_gasPrice",
      params: [],
    }),
  });

  const data = (await res.json()) as { result: string };
  const gasPriceWei = BigInt(data.result);
  const gasPriceGwei = Number(gasPriceWei) / 1e9;

  return {
    status: "ok",
    gasPrice: `${gasPriceGwei.toFixed(4)} gwei`,
    gasPriceWei: gasPriceWei.toString(),
    timestamp: new Date().toISOString(),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const agent = url.searchParams.get("agent") ?? "gas-tracker";
    const rpcUrl = env.CELO_RPC_URL || "https://forno.celo.org";

    if (agent === "gas-tracker") {
      const result = await runGasTracker(rpcUrl);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Agent "${agent}" not bundled in this worker` }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const rpcUrl = env.CELO_RPC_URL || "https://forno.celo.org";
    ctx.waitUntil(
      runGasTracker(rpcUrl).then((result) => {
        console.log("[cron] gas-tracker:", JSON.stringify(result));
      })
    );
  },
};
