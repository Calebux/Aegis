/**
 * Horizon x402 Server — v2 with real payment enforcement
 *
 * Three payment modes:
 *   x402    — pay per request (402 challenge → Stellar payment → receipt)
 *   session — pay for N queries upfront (payment channel pattern)
 *   dev     — no payment required (HORIZON_PAYMENT_RECEIVER not set)
 *
 * Discovery: GET /.well-known/calagent.json
 * Endpoints:  GET /network-stats  GET /account/:id  GET /market-data
 *             POST /session/open  GET /health
 */

import express, { Request, Response, NextFunction } from "express";
import * as http from "http";
import { getHorizonServer } from "@calagent/shared";
import { Asset } from "@stellar/stellar-sdk";

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.HORIZON_X402_PORT ?? "3001", 10);
const PAYMENT_AMOUNT_XLM = process.env.HORIZON_PAYMENT_AMOUNT ?? "0.01";
const PAYMENT_RECEIVER = (process.env.HORIZON_PAYMENT_RECEIVER ?? "").trim();
const PAYMENT_NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const USDC_TESTNET_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** True if payment enforcement is active */
const PAYMENT_ENABLED = PAYMENT_RECEIVER.length > 0;

// ── In-memory stores ──────────────────────────────────────────────────────────

interface NonceEntry { issuedAt: number }
interface SessionEntry { usesRemaining: number; txHash: string; createdAt: number }

/** Nonces issued via 402 response — single-use, expire 5 min */
const pendingNonces = new Map<string, NonceEntry>();

/** Nonces that have been redeemed (prevent replay) */
const usedNonces = new Set<string>();

/** Prepaid sessions for payment channel mode, expire 10 min */
const sessions = new Map<string, SessionEntry>();

// Clean up expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingNonces) {
    if (now - v.issuedAt > 5 * 60 * 1_000) pendingNonces.delete(k);
  }
  for (const [k, v] of sessions) {
    if (now - v.createdAt > 10 * 60 * 1_000) sessions.delete(k);
  }
}, 60_000).unref();

// ── Payment verification ──────────────────────────────────────────────────────

interface HorizonOperation {
  type: string;
  to: string;
  amount: string;
  asset_type: string;
}

interface HorizonOpsResponse {
  _embedded: { records: HorizonOperation[] };
}

async function verifyPaymentOnChain(
  txHash: string,
  expectedReceiver: string,
  minAmountXlm: string
): Promise<boolean> {
  if (!PAYMENT_ENABLED) return true;
  try {
    const txResp = await fetch(`${HORIZON_URL}/transactions/${txHash}`);
    if (!txResp.ok) return false;
    const tx = (await txResp.json()) as { successful: boolean };
    if (!tx.successful) return false;

    const opsResp = await fetch(
      `${HORIZON_URL}/transactions/${txHash}/operations`
    );
    if (!opsResp.ok) return false;
    const ops = (await opsResp.json()) as HorizonOpsResponse;

    return ops._embedded.records.some(
      (op) =>
        op.type === "payment" &&
        op.to === expectedReceiver &&
        op.asset_type === "native" &&
        parseFloat(op.amount) >= parseFloat(minAmountXlm)
    );
  } catch {
    return false;
  }
}

// ── 402 helper ────────────────────────────────────────────────────────────────

function send402(res: Response): void {
  const nonce = crypto.randomUUID();
  pendingNonces.set(nonce, { issuedAt: Date.now() });
  res.status(402).json({
    payTo: PAYMENT_RECEIVER,
    amount: PAYMENT_AMOUNT_XLM,
    asset: "XLM",
    nonce,
    network: PAYMENT_NETWORK,
    message: "Payment required — Cal-AgentKit Horizon Gateway",
    gateway: "calagent-horizon-v2",
  });
}

// ── Payment guard middleware ───────────────────────────────────────────────────

async function requirePayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!PAYMENT_ENABLED) {
    next();
    return;
  }

  // ── Session token (payment channel) ──────────────────────────────────────
  const sessionToken = req.headers["x-session-token"] as string | undefined;
  if (sessionToken) {
    const session = sessions.get(sessionToken);
    if (session && session.usesRemaining > 0) {
      session.usesRemaining--;
      res.setHeader("x-session-uses-remaining", String(session.usesRemaining));
      res.setHeader("x-session-tx-hash", session.txHash);
      res.setHeader("x-payment-mode", "session");
      if (session.usesRemaining === 0) sessions.delete(sessionToken);
      next();
      return;
    }
    res.status(402).json({ error: "Session expired or invalid" });
    return;
  }

  // ── x402 receipt ─────────────────────────────────────────────────────────
  const txHash = req.headers["x-payment-tx-hash"] as string | undefined;
  const nonce = req.headers["x-payment-nonce"] as string | undefined;

  if (txHash && nonce) {
    if (!pendingNonces.has(nonce)) {
      res.status(402).json({ error: "Invalid or expired nonce" });
      return;
    }
    if (usedNonces.has(nonce)) {
      res.status(402).json({ error: "Nonce already used" });
      return;
    }
    const valid = await verifyPaymentOnChain(
      txHash,
      PAYMENT_RECEIVER,
      PAYMENT_AMOUNT_XLM
    );
    if (!valid) {
      res.status(402).json({ error: "Payment verification failed" });
      return;
    }
    usedNonces.add(nonce);
    pendingNonces.delete(nonce);
    res.setHeader("x-payment-tx-hash", txHash);
    res.setHeader("x-payment-verified", "true");
    res.setHeader("x-payment-mode", "x402");
    next();
    return;
  }

  // ── No payment provided — issue 402 ──────────────────────────────────────
  send402(res);
}

// ── Market data ───────────────────────────────────────────────────────────────

async function fetchMarketData() {
  const server = getHorizonServer();
  const usdcAsset = new Asset("USDC", USDC_TESTNET_ISSUER);

  const [orderBook, tradesPage] = await Promise.all([
    server.orderbook(Asset.native(), usdcAsset).call(),
    server.trades().forAssetPair(Asset.native(), usdcAsset).order("desc").limit(50).call(),
  ]);

  type TradeRec = { ledger_close_time: string; price?: { n?: unknown; d?: unknown } };
  const trades = tradesPage.records as TradeRec[];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1_000;
  const recentTrades = trades.filter(
    (t: TradeRec) => new Date(t.ledger_close_time).getTime() > dayAgo
  );

  const prices = recentTrades
    .map((t: TradeRec) => {
      const n = parseFloat(String(t.price?.n ?? 0));
      const d = parseFloat(String(t.price?.d ?? 1));
      return d !== 0 ? n / d : 0;
    })
    .filter((p: number) => p > 0);

  return {
    orderBook: { bids: orderBook.bids, asks: orderBook.asks },
    recentTrades: trades.slice(0, 10),
    priceRange24h: {
      high: prices.length > 0 ? Math.max(...prices) : 0,
      low: prices.length > 0 ? Math.min(...prices) : 0,
    },
    fetchedAt: new Date().toISOString(),
  };
}

// ── Manifest ──────────────────────────────────────────────────────────────────

function buildManifest() {
  return {
    calagent: "1.0",
    name: "Cal-AgentKit Horizon Gateway",
    description:
      "Stellar network intelligence — pay per query or open a prepaid session",
    modes: PAYMENT_ENABLED ? ["x402", "session"] : ["dev"],
    network: PAYMENT_NETWORK,
    asset: "XLM",
    payee: PAYMENT_RECEIVER || "not-configured",
    pricing: {
      x402: { amount: PAYMENT_AMOUNT_XLM, per: "request", asset: "XLM" },
      session: {
        deposit: (Number(PAYMENT_AMOUNT_XLM) * 3).toFixed(7),
        queries: 3,
        asset: "XLM",
      },
    },
    endpoints: {
      "network-stats": "GET /network-stats",
      account: "GET /account/:id",
      "market-data": "GET /market-data",
      "session-open": "POST /session/open",
    },
    tags: ["stellar", "horizon", "calagent", "multi-agent"],
  };
}

// ── Server factory ────────────────────────────────────────────────────────────

export async function startHorizonX402Server(): Promise<http.Server> {
  const app = express();
  app.use(express.json());

  // ── Discovery + health (no payment) ──────────────────────────────────────
  app.get("/.well-known/calagent.json", (_req, res) => res.json(buildManifest()));

  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      port: PORT,
      paymentRequired: PAYMENT_ENABLED,
      mode: PAYMENT_ENABLED ? "x402+session" : "dev",
    })
  );

  // ── Session open (payment channel) ────────────────────────────────────────
  app.post("/session/open", async (req, res) => {
    const { txHash, queries = 3 } = req.body as {
      txHash?: string;
      queries?: number;
    };

    if (!PAYMENT_ENABLED) {
      const token = crypto.randomUUID();
      sessions.set(token, {
        usesRemaining: queries,
        txHash: "dev-no-payment",
        createdAt: Date.now(),
      });
      res.json({
        sessionToken: token,
        usesRemaining: queries,
        txHash: "dev-no-payment",
        mode: "dev",
      });
      return;
    }

    if (!txHash) {
      res.status(400).json({ error: "txHash required" });
      return;
    }

    const expectedAmount = (Number(PAYMENT_AMOUNT_XLM) * queries).toFixed(7);
    const valid = await verifyPaymentOnChain(
      txHash,
      PAYMENT_RECEIVER,
      expectedAmount
    );
    if (!valid) {
      res.status(402).json({
        error: "Payment verification failed",
        expected: `${expectedAmount} XLM to ${PAYMENT_RECEIVER}`,
      });
      return;
    }

    const token = crypto.randomUUID();
    sessions.set(token, { usesRemaining: queries, txHash, createdAt: Date.now() });
    res.json({ sessionToken: token, usesRemaining: queries, txHash, mode: "session" });
  });

  // ── Protected data routes ─────────────────────────────────────────────────

  app.get("/network-stats", requirePayment, async (_req, res) => {
    try {
      const horizon = getHorizonServer();
      const page = await horizon.ledgers().order("desc").limit(1).call();
      const r = page.records[0];
      res.json({
        latestLedgerSequence: r ? Number(r.sequence) : null,
        latestLedgerHash: r?.hash ?? null,
        closedAt: r?.closed_at ?? null,
        baseFeeInStroops: r ? Number(r.base_fee_in_stroops) : null,
        transactionCount: r?.successful_transaction_count ?? null,
        operationCount: r?.operation_count ?? null,
        feePercentiles: { p10: "100", p50: "100", p99: "100" },
        network: PAYMENT_NETWORK,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/account/:id", requirePayment, async (req, res) => {
    try {
      const horizon = getHorizonServer();
      const { id } = req.params;
      const account = await horizon.accounts().accountId(id).call();
      const txPage = await horizon.transactions().forAccount(id).limit(5).call();
      res.json({
        address: account.id,
        sequence: account.sequence,
        balances: account.balances.map((b: { asset_type: string; balance: string; asset_code?: string; asset_issuer?: string }) => ({
          assetType: b.asset_type,
          asset:
            b.asset_type === "native"
              ? "XLM"
              : `${b.asset_code ?? ""}:${b.asset_issuer ?? ""}`,
          balance: b.balance,
        })),
        recentTransactions: txPage.records.map((tx: { hash: string; created_at: string; successful: boolean; fee_charged: string | number }) => ({
          hash: tx.hash,
          createdAt: tx.created_at,
          successful: tx.successful,
          feeCharged: tx.fee_charged,
        })),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/market-data", requirePayment, async (_req, res) => {
    try {
      const data = await fetchMarketData();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Legacy unprotected routes (lower-value raw Horizon data) ─────────────

  app.get("/ledgers", async (_req, res) => {
    try {
      const horizon = getHorizonServer();
      const page = await horizon.ledgers().order("desc").limit(1).call();
      res.json(page.records[0] ?? {});
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/ledgers/latest", async (_req, res) => {
    try {
      const horizon = getHorizonServer();
      const page = await horizon.ledgers().order("desc").limit(1).call();
      res.json(page.records[0] ?? {});
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/accounts/:id", async (req, res) => {
    try {
      const horizon = getHorizonServer();
      const account = await horizon.accounts().accountId(req.params.id).call();
      res.json(account);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/assets", async (req, res) => {
    try {
      const horizon = getHorizonServer();
      const params = new URLSearchParams(
        (req.url.split("?")[1] as string | undefined) ?? ""
      );
      const code = params.get("asset_code") ?? "XLM";
      const issuer = params.get("asset_issuer");
      let builder = horizon.assets().forCode(code);
      if (issuer) builder = builder.forIssuer(issuer);
      const page = await builder.limit(10).call();
      res.json(page.records);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return new Promise<http.Server>((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(
        `[horizon-x402] Listening on http://localhost:${PORT}  ` +
          `[${PAYMENT_ENABLED ? "payment enforced" : "DEV — no payment"}]`
      );
      console.log(
        `[horizon-x402] Manifest: http://localhost:${PORT}/.well-known/calagent.json`
      );
      resolve(server as unknown as http.Server);
    });
    server.once("error", reject);
  });
}

// Allow running directly: tsx horizon-x402-server.ts
if (require.main === module) {
  startHorizonX402Server().catch((err) => {
    console.error("[horizon-x402] Fatal:", err);
    process.exit(1);
  });
}
