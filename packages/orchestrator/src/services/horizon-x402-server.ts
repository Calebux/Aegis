/**
 * Horizon x402 Server
 *
 * A lightweight HTTP server that wraps the Stellar Horizon API on port 3001.
 * In a production build this layer would gate each request behind an x402
 * micropayment; for now it acts as a transparent local proxy so the rest of
 * Aegis can make Horizon calls through a single, swap-able endpoint.
 */

import * as http from "http";
import { getHorizonServer } from "@aegis/shared";

const PORT = 3001;

export async function startHorizonX402Server(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");

      const url = req.url ?? "/";

      try {
        const horizon = getHorizonServer();

        // GET /ledgers — latest ledger info
        if (url === "/ledgers" || url === "/ledgers/latest") {
          const page = await horizon.ledgers().order("desc").limit(1).call();
          res.writeHead(200);
          res.end(JSON.stringify(page.records[0] ?? {}));
          return;
        }

        // GET /accounts/:id
        const accountMatch = url.match(/^\/accounts\/([A-Z0-9]+)$/);
        if (accountMatch) {
          const account = await horizon
            .accounts()
            .accountId(accountMatch[1])
            .call();
          res.writeHead(200);
          res.end(JSON.stringify(account));
          return;
        }

        // GET /assets?asset_code=XLM
        if (url.startsWith("/assets")) {
          const params = new URLSearchParams(url.split("?")[1] ?? "");
          const code = params.get("asset_code") ?? "XLM";
          const issuer = params.get("asset_issuer");
          let builder = horizon.assets().forCode(code);
          if (issuer) builder = builder.forIssuer(issuer);
          const page = await builder.limit(10).call();
          res.writeHead(200);
          res.end(JSON.stringify(page.records));
          return;
        }

        // GET /health
        if (url === "/health") {
          res.writeHead(200);
          res.end(JSON.stringify({ status: "ok", port: PORT }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: `Unknown route: ${url}` }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });

    server.once("error", reject);

    server.listen(PORT, () => {
      console.log(`[horizon-x402] Server listening on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

// Allow running directly: tsx horizon-x402-server.ts
if (require.main === module) {
  startHorizonX402Server().catch((err) => {
    console.error("[horizon-x402] Fatal:", err);
    process.exit(1);
  });
}
