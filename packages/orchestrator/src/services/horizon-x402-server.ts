/**
 * Horizon x402 Server
 *
 * Wraps the Stellar Horizon API behind an x402 paywall on Stellar testnet.
 * This makes Aegis a *provider* of x402 services — not just a consumer.
 *
 * The Ledger sub-agent pays per request using @x402/axios; this server
 * validates each micro-payment before proxying the Horizon call.
 *
 * Protected endpoints:
 *   GET /network-stats    — latest ledger, base fee, tx count    ($0.001)
 *   GET /account/:address — account balances + recent txns       ($0.001)
 *
 * Port: 3001
 *
 * Env vars:
 *   HORIZON_WALLET_ADDRESS   — Stellar address that receives payments
 *   X402_FACILITATOR_URL     — x402 facilitator (default: Coinbase)
 *   STELLAR_HORIZON_URL      — Horizon endpoint (default: testnet)
 */

import "dotenv/config";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { paymentMiddleware } from "@x402/express";
import { getHorizonServer } from "@aegis/shared";

// ── Config ────────────────────────────────────────────────────────────────────

const app = express();
const PORT = 3001;

const HORIZON_WALLET = process.env.HORIZON_WALLET_ADDRESS ?? "";
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? "https://facilitator.coinbase.com";

if (!HORIZON_WALLET) {
  console.warn(
    "[horizon-x402] ⚠  HORIZON_WALLET_ADDRESS not set — set it in .env"
  );
}

// ── x402 Payment Middleware ───────────────────────────────────────────────────
//
// Intercepts every request and returns 402 Payment Required if no valid
// x402 payment header is present. On valid payment, forwards the request.

app.use(
  paymentMiddleware(
    HORIZON_WALLET,
    {
      "/network-stats": {
        price: "$0.001",
        network: "stellar:testnet" as string,
        description: "Stellar network stats and fee data",
      },
      "/account/:address": {
        price: "$0.001",
        network: "stellar:testnet" as string,
        description: "Stellar account balances and history",
      },
    },
    { url: FACILITATOR_URL }
  )
);

// ── Payment Logging Middleware ────────────────────────────────────────────────
//
// Runs after the x402 middleware has validated the payment. Parses the
// x-payment header to extract amount and payer address for structured logging.

app.use((req: Request, _res: Response, next: NextFunction) => {
  const paymentHeader = req.headers["x-payment"] as string | undefined;
  if (paymentHeader) {
    try {
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf8");
      const payment = JSON.parse(decoded) as {
        amount?: string;
        from?: string;
        sender?: string;
        value?: string;
      };
      const amount = payment.amount ?? payment.value ?? "0.001 XLM";
      const from = payment.from ?? payment.sender ?? "unknown";
      console.log(`💰 Payment received: ${amount} from ${from}`);
    } catch {
      // Header present but not base64-JSON — still log the path
      console.log(`💰 Payment received on ${req.path}`);
    }
  }
  next();
});

// ── GET /network-stats ────────────────────────────────────────────────────────
//
// Returns the latest ledger sequence, close time, base fee, transaction count,
// operation count, and fee percentiles from Stellar Horizon testnet.

app.get("/network-stats", async (_req: Request, res: Response) => {
  try {
    const server = getHorizonServer();

    const [latestLedgers, feeStats] = await Promise.all([
      server.ledgers().order("desc").limit(1).call(),
      server.feeStats(),
    ]);

    const latestLedger = latestLedgers.records[0];

    const stats = {
      latestLedgerSequence: latestLedger?.sequence ?? null,
      latestLedgerHash: latestLedger?.hash ?? null,
      closedAt: latestLedger?.closed_at ?? null,
      baseFeeInStroops: latestLedger?.base_fee_in_stroops ?? null,
      transactionCount: latestLedger?.transaction_count ?? null,
      operationCount: latestLedger?.operation_count ?? null,
      totalCoins: latestLedger?.total_coins ?? null,
      feePool: latestLedger?.fee_pool ?? null,
      feePercentiles: {
        p10: feeStats.fee_charged.p10,
        p25: feeStats.fee_charged.p25,
        p50: feeStats.fee_charged.p50,
        p75: feeStats.fee_charged.p75,
        p99: feeStats.fee_charged.p99,
      },
      maxFeePercentiles: {
        p10: feeStats.max_fee.p10,
        p50: feeStats.max_fee.p50,
        p99: feeStats.max_fee.p99,
      },
      network: "stellar:testnet",
      fetchedAt: new Date().toISOString(),
    };

    console.log(
      `[horizon-x402] /network-stats → ledger #${stats.latestLedgerSequence}`
    );
    res.json(stats);
  } catch (err) {
    console.error("[horizon-x402] /network-stats error:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch network stats from Horizon" });
  }
});

// ── GET /account/:address ─────────────────────────────────────────────────────
//
// Returns account balances (all assets) and the 10 most recent transactions
// for the given Stellar public key.

app.get("/account/:address", async (req: Request, res: Response) => {
  const { address } = req.params;

  try {
    const server = getHorizonServer();

    const [account, txPage] = await Promise.all([
      server.loadAccount(address),
      server.transactions().forAccount(address).order("desc").limit(10).call(),
    ]);

    // Normalise balance entries across native XLM and issued assets
    const balances = account.balances.map((b) => {
      if (b.asset_type === "native") {
        return {
          assetType: "native",
          asset: "XLM",
          balance: b.balance,
          buyingLiabilities: b.buying_liabilities,
          sellingLiabilities: b.selling_liabilities,
        };
      }
      // Credit asset (asset_code + asset_issuer always present here)
      const credit = b as Extract<typeof b, { asset_type: "credit_alphanum4" | "credit_alphanum12" }>;
      return {
        assetType: b.asset_type,
        asset: `${credit.asset_code}:${credit.asset_issuer}`,
        balance: b.balance,
        buyingLiabilities: b.buying_liabilities,
        sellingLiabilities: b.selling_liabilities,
      };
    });

    const recentTransactions = txPage.records.map((tx) => ({
      hash: tx.hash,
      createdAt: tx.created_at,
      operationCount: tx.operation_count,
      successful: tx.successful,
      feeCharged: tx.fee_charged,
      memo: (tx as Record<string, unknown>)["memo"] ?? null,
    }));

    const accountData = {
      address,
      accountId: account.account_id,
      sequence: account.sequence,
      subentryCount: account.subentry_count,
      balances,
      recentTransactions,
      fetchedAt: new Date().toISOString(),
    };

    console.log(
      `[horizon-x402] /account/${address.slice(0, 8)}… → ` +
        `${balances.length} balances, ${recentTransactions.length} txns`
    );
    res.json(accountData);
  } catch (err: unknown) {
    const status =
      err &&
      typeof err === "object" &&
      "response" in err &&
      (err as { response?: { status?: number } }).response?.status === 404
        ? 404
        : 500;
    if (status === 404) {
      res
        .status(404)
        .json({ error: `Account ${address} not found on Stellar testnet` });
    } else {
      console.error(`[horizon-x402] /account/${address} error:`, err);
      res
        .status(500)
        .json({ error: "Failed to fetch account data from Horizon" });
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[horizon-x402] ✅ Server running on port ${PORT}`);
  console.log(
    `[horizon-x402] 💳 Payment address: ${HORIZON_WALLET || "(not configured)"}`
  );
  console.log(`[horizon-x402] 🔗 Facilitator: ${FACILITATOR_URL}`);
  console.log("[horizon-x402] Protected routes:");
  console.log("   GET /network-stats    → $0.001 per request");
  console.log("   GET /account/:address → $0.001 per request");
});

export { app };
