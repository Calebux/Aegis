/**
 * Horizon x402 Server
 *
 * A local HTTP server that gates Stellar Horizon market data behind
 * x402 micropayments. Agents pay per request to receive live XLM/USDC
 * order-book depth, recent trades, and a 24h price range derived
 * entirely from on-chain Stellar DEX data — no third-party APIs needed.
 *
 * x402 flow
 *   1.  Client GETs /market-data  →  server returns 402 + payment details.
 *   2.  Client submits a Stellar payment to HORIZON_WALLET_ADDRESS.
 *   3.  Client retries with X-Payment-Receipt: <base64 proof>.
 *   4.  Server returns the market data JSON.
 *
 * Endpoints
 *   GET /market-data  — price: "$0.001", network: "stellar:testnet"
 *   GET /health       — liveness probe
 */

import "dotenv/config";
import express, { type Request, type Response } from "express";
import { Asset } from "@stellar/stellar-sdk";
import {
  keypairFromSecret,
  generateKeypair,
  fundTestnetAccount,
  getHorizonServer,
} from "@aegis/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** USDC issuer on Stellar testnet (Circle test asset). */
const USDC_TESTNET_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const USDC_ASSET = new Asset("USDC", USDC_TESTNET_ISSUER);

const PORT = parseInt(process.env.HORIZON_X402_PORT ?? "3001", 10);
const PRICE_USD = "$0.001";
const PRICE_STROOPS = "100000"; // 0.01 XLM ≈ $0.001

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// GET /market-data
// ---------------------------------------------------------------------------

/**
 * x402-gated XLM/USDC market data endpoint.
 *
 * Returns 402 with:
 *   { price, network, payTo, description, amountStroops, nonce }
 *
 * After payment, returns:
 *   { orderBook, recentTrades, priceRange24h }
 */
app.get("/market-data", async (req: Request, res: Response) => {
  const paymentReceipt = req.headers["x-payment-receipt"];

  if (!paymentReceipt) {
    // Step 1: return 402 with payment details
    const nonce =
      Math.random().toString(36).slice(2) + Date.now().toString(36);

    res.status(402).json({
      price: PRICE_USD,
      network: "stellar:testnet",
      payTo: process.env.HORIZON_WALLET_ADDRESS ?? "",
      description: "XLM/USDC order book and price data",
      amountStroops: PRICE_STROOPS,
      nonce,
    });
    return;
  }

  // Step 4: payment proof received — fetch live data from Stellar Horizon
  try {
    const server = getHorizonServer();

    const [orderBook, tradesPage] = await Promise.all([
      // XLM/USDC order book (selling native XLM, buying USDC)
      server.orderbook(Asset.native(), USDC_ASSET).call(),

      // Recent XLM/USDC trades (newest first)
      server
        .trades()
        .forAssetPair(Asset.native(), USDC_ASSET)
        .order("desc")
        .limit(50)
        .call(),
    ]);

    const trades = tradesPage.records;

    // Derive 24h price range from on-chain trade history
    const dayAgo = Date.now() - 24 * 60 * 60 * 1_000;

    const recentTrades = trades.filter(
      (t) => new Date(t.ledger_close_time).getTime() > dayAgo
    );

    const prices = recentTrades
      .map((t) => {
        const n = parseFloat(String(t.price.n));
        const d = parseFloat(String(t.price.d));
        return d !== 0 ? n / d : 0;
      })
      .filter((p) => p > 0);

    const priceRange24h = {
      high: prices.length > 0 ? Math.max(...prices) : 0,
      low: prices.length > 0 ? Math.min(...prices) : 0,
    };

    res.json({
      orderBook: {
        bids: orderBook.bids,
        asks: orderBook.asks,
      },
      recentTrades: trades.slice(0, 10),
      priceRange24h,
    });
  } catch (err) {
    console.error("[horizon-x402-server] Error fetching market data:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "horizon-x402-server",
    wallet: process.env.HORIZON_WALLET_ADDRESS ?? "not-configured",
  });
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("[horizon-x402-server] Starting…");

  let secretKey = process.env.HORIZON_WALLET_SECRET;

  if (!secretKey) {
    console.log("[horizon-x402-server] No wallet found — generating keypair…");
    const kp = generateKeypair();
    secretKey = kp.secretKey;

    console.log("[horizon-x402-server] Public key:", kp.publicKey);
    await fundTestnetAccount(kp.publicKey);
    console.log(
      "[horizon-x402-server] Funded via Friendbot. Add to .env:\n" +
        `  HORIZON_WALLET_SECRET=${kp.secretKey}\n` +
        `  HORIZON_WALLET_ADDRESS=${kp.publicKey}`
    );

    process.env.HORIZON_WALLET_ADDRESS = kp.publicKey;
  } else {
    const keypair = keypairFromSecret(secretKey);
    process.env.HORIZON_WALLET_ADDRESS ??= keypair.publicKey();
  }

  console.log(
    "[horizon-x402-server] Payment wallet:",
    process.env.HORIZON_WALLET_ADDRESS
  );

  app.listen(PORT, () => {
    console.log(
      `[horizon-x402-server] Listening on http://localhost:${PORT}`
    );
    console.log(
      `[horizon-x402-server] GET /market-data — price: ${PRICE_USD} | network: stellar:testnet`
    );
  });
}

main().catch((err) => {
  console.error("[horizon-x402-server] Fatal:", err);
  process.exit(1);
});
