/**
 * Celo x402 Facilitator Server
 *
 * Express server on port 3002.
 * Mirrors horizon-x402-server.ts exactly in structure but serves
 * Celo market data (block, gasPrice, chainId, celoUsdRate, cUsdSupply)
 * behind a cUSD x402 payment gate.
 *
 * Dev mode: CALAGENT_CELO_X402_RECEIVER not set → all routes return 200 free.
 *
 * Doubles as the x402 facilitator for /verify and /settle.
 * Set CALAGENT_CELO_X402_FACILITATOR_URL=http://localhost:3002 to activate.
 */

import * as dotenv from "dotenv";
import * as nodePath from "path";
dotenv.config({ path: nodePath.resolve(__dirname, "../../../.env") });
dotenv.config();

import express, { type Request, type Response } from "express";
import { randomUUID } from "crypto";

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.CELO_X402_SERVER_PORT ?? "3002");
const RECEIVER = process.env.CALAGENT_CELO_X402_RECEIVER ?? "";
const DEV_MODE = !RECEIVER;

const CELO_NETWORK = process.env.CALAGENT_CELO_NETWORK ?? "alfajores";
const CELO_RPC_URL =
  process.env.CELO_RPC_URL ??
  (CELO_NETWORK === "mainnet"
    ? "https://forno.celo.org"
    : "https://alfajores-forno.celo-testnet.org");

const CHAIN_ID = CELO_NETWORK === "mainnet" ? 42220 : 44787;
const CUSD_CONTRACT =
  CELO_NETWORK === "mainnet"
    ? "0x765DE816845861e75A25fCA122bb6898B8B1282a"
    : "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1";

/** 0.001 cUSD per market-data query */
const AMOUNT_CUSD = process.env.CELO_X402_AMOUNT_CUSD ?? "0.001";
const AMOUNT_WEI = BigInt(Math.round(Number(AMOUNT_CUSD) * 10 ** 18)).toString();

// ── Nonce / session tracking ──────────────────────────────────────────────────

/** Used nonces (nonce → timestamp). Cleaned after 5 min. */
const usedNonces = new Map<string, number>();
/** Active sessions (sessionToken → { queriesLeft, createdAt, txHash }) */
const sessions = new Map<
  string,
  { queriesLeft: number; createdAt: number; txHash: string }
>();

function cleanupOldNonces() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [n, ts] of usedNonces) if (ts < cutoff) usedNonces.delete(n);
}

// ── RPC helpers ───────────────────────────────────────────────────────────────

async function celoRpc<T>(
  method: string,
  params: unknown[] = []
): Promise<T | null> {
  try {
    const res = await fetch(CELO_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as { result?: T };
    return body.result ?? null;
  } catch {
    return null;
  }
}

/** Fetch CELO/USD rate from CoinGecko free tier */
async function getCeloUsdRate(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd",
      { signal: AbortSignal.timeout(4_000) }
    );
    const json = (await res.json()) as { celo?: { usd?: number } };
    return json.celo?.usd ?? 0;
  } catch {
    return 0;
  }
}

/** Fetch cUSD total supply via ERC-20 totalSupply() eth_call */
async function getCusdSupply(): Promise<string> {
  const totalSupplySelector = "0x18160ddd"; // keccak256("totalSupply()")
  const result = await celoRpc<string>("eth_call", [
    { to: CUSD_CONTRACT, data: totalSupplySelector },
    "latest",
  ]);
  if (!result) return "unavailable";
  try {
    const wei = BigInt(result);
    const cUSD = Number(wei) / 10 ** 18;
    return `${cUSD.toLocaleString("en-US", { maximumFractionDigits: 2 })} cUSD`;
  } catch {
    return "unavailable";
  }
}

/** Fetch all market data from Celo RPC */
async function fetchMarketData() {
  const [blockNumberHex, gasPriceHex, chainIdHex, celoUsdRate, cUsdSupply] =
    await Promise.all([
      celoRpc<string>("eth_blockNumber"),
      celoRpc<string>("eth_gasPrice"),
      celoRpc<string>("eth_chainId"),
      getCeloUsdRate(),
      getCusdSupply(),
    ]);

  return {
    block: blockNumberHex ? Number.parseInt(blockNumberHex, 16) : null,
    gasPrice: gasPriceHex ? BigInt(gasPriceHex).toString() : null,
    chainId: chainIdHex ? Number.parseInt(chainIdHex, 16) : CHAIN_ID,
    celoUsdRate,
    cUsdSupply,
    network: `eip155:${CHAIN_ID}`,
    rpcUrl: CELO_RPC_URL,
    timestamp: new Date().toISOString(),
  };
}

// ── Payment verification ──────────────────────────────────────────────────────

async function verifyCusdPayment(
  txHash: string,
  expectedPayTo: string,
  minAmountWei: string
): Promise<{ valid: boolean; error?: string; payer?: string }> {
  try {
    // Get transaction
    const tx = await celoRpc<{
      to: string;
      input: string;
      from: string;
      blockNumber: string;
    }>("eth_getTransactionByHash", [txHash]);

    if (!tx || !tx.blockNumber) {
      return { valid: false, error: "Transaction not found or not yet mined" };
    }

    // Check `to` = cUSD contract
    if (tx.to?.toLowerCase() !== CUSD_CONTRACT.toLowerCase()) {
      return { valid: false, error: "Transaction is not a cUSD transfer" };
    }

    // Decode `transfer(address,uint256)` call
    // selector: 0xa9059cbb
    const input = tx.input ?? "";
    if (!input.startsWith("0xa9059cbb")) {
      return { valid: false, error: "Transaction is not a transfer() call" };
    }

    // Decode recipient (32 bytes after selector = 4 bytes + 32 bytes)
    const recipientPadded = input.slice(10, 74); // 32 bytes
    const recipient = "0x" + recipientPadded.slice(24); // last 20 bytes

    if (recipient.toLowerCase() !== expectedPayTo.toLowerCase()) {
      return { valid: false, error: `Payment sent to ${recipient}, expected ${expectedPayTo}` };
    }

    // Decode amount
    const amountHex = input.slice(74, 138); // next 32 bytes
    const amount = BigInt("0x" + amountHex);
    const minAmount = BigInt(minAmountWei);

    if (amount < minAmount) {
      return {
        valid: false,
        error: `Payment amount ${amount} < required ${minAmount}`,
      };
    }

    return { valid: true, payer: tx.from };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

function extractPaymentTxHash(paymentPayload: unknown): string | undefined {
  if (!paymentPayload || typeof paymentPayload !== "object") return undefined;
  const payload = paymentPayload as Record<string, unknown>;
  if (typeof payload["txHash"] === "string") return payload["txHash"];
  if (payload["payload"] && typeof payload["payload"] === "object") {
    const nested = payload["payload"] as Record<string, unknown>;
    if (typeof nested["txHash"] === "string") return nested["txHash"];
    if (typeof nested["transaction"] === "string") return nested["transaction"];
  }
  if (typeof payload["transaction"] === "string") return payload["transaction"];
  return undefined;
}

function extractPaymentRequirement(body: unknown): {
  payTo?: string;
  amountWei?: string;
} {
  if (!body || typeof body !== "object") return {};
  const root = body as Record<string, unknown>;
  const direct = root["paymentRequirements"] as Record<string, unknown> | undefined;
  const accepted = (root["paymentPayload"] as Record<string, unknown> | undefined)?.[
    "accepted"
  ] as Record<string, unknown> | undefined;
  const source = direct ?? accepted;
  return {
    payTo: typeof source?.["payTo"] === "string" ? source["payTo"] : undefined,
    amountWei: typeof source?.["amount"] === "string" ? source["amount"] : undefined,
  };
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    chain: `eip155:${CHAIN_ID}`,
    network: CELO_NETWORK,
    devMode: DEV_MODE,
    receiver: DEV_MODE ? "not-configured" : RECEIVER.slice(0, 10) + "…",
    activeSessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
});

// ── Manifest ──────────────────────────────────────────────────────────────────

app.get("/.well-known/calagent-celo.json", (_req: Request, res: Response) => {
  res.json({
    name: "Cal-AgentKit Celo x402 Facilitator",
    chain: `eip155:${CHAIN_ID}`,
    asset: "cUSD",
    contract: CUSD_CONTRACT,
    payee: DEV_MODE ? "not-configured" : RECEIVER,
    amountCusd: AMOUNT_CUSD,
    amountWei: AMOUNT_WEI,
  });
});

// ── Market data endpoint ──────────────────────────────────────────────────────

app.get("/market-data", async (req: Request, res: Response) => {
  // Dev mode: pass through free
  if (DEV_MODE) {
    const data = await fetchMarketData();
    res.json({ ...data, paymentMode: "dev" });
    return;
  }

  // Check session token
  const sessionToken = req.headers["x-session-token"] as string | undefined;
  if (sessionToken) {
    const session = sessions.get(sessionToken);
    if (session && session.queriesLeft > 0) {
      session.queriesLeft -= 1;
      if (session.queriesLeft === 0) sessions.delete(sessionToken);
      const data = await fetchMarketData();
      res.json({ ...data, paymentMode: "session" });
      return;
    }
  }

  // Check payment header
  const paymentTxHash = req.headers["x-payment-tx-hash"] as string | undefined;
  const paymentNonce = req.headers["x-payment-nonce"] as string | undefined;

  if (paymentTxHash && paymentTxHash !== "dev-no-payment") {
    cleanupOldNonces();
    if (paymentNonce && usedNonces.has(paymentNonce)) {
      res.status(402).json({ error: "Nonce already used" });
      return;
    }

    const verification = await verifyCusdPayment(paymentTxHash, RECEIVER, AMOUNT_WEI);
    if (!verification.valid) {
      res.status(402).json({ error: verification.error });
      return;
    }

    if (paymentNonce) usedNonces.set(paymentNonce, Date.now());
    const data = await fetchMarketData();
    res.json({ ...data, paymentMode: "x402", payer: verification.payer });
    return;
  }

  // Issue 402 challenge
  const nonce = randomUUID();
  res.status(402).json({
    price: AMOUNT_CUSD,
    amountWei: AMOUNT_WEI,
    network: `eip155:${CHAIN_ID}`,
    payTo: RECEIVER,
    contract: CUSD_CONTRACT,
    asset: "cUSD",
    nonce,
    description: "Celo market data access — cUSD payment required",
  });
});

// ── Session endpoint ──────────────────────────────────────────────────────────

app.post("/session/open", async (req: Request, res: Response) => {
  const { txHash, queries = 3 } = req.body as { txHash?: string; queries?: number };

  // Dev mode
  if (DEV_MODE) {
    const sessionToken = randomUUID();
    sessions.set(sessionToken, { queriesLeft: queries, createdAt: Date.now(), txHash: "" });
    res.json({ sessionToken, queries, paymentMode: "dev" });
    return;
  }

  if (!txHash) {
    res.status(400).json({ error: "txHash required" });
    return;
  }

  const required = BigInt(AMOUNT_WEI) * BigInt(queries);
  const verification = await verifyCusdPayment(txHash, RECEIVER, required.toString());
  if (!verification.valid) {
    res.status(402).json({ error: verification.error });
    return;
  }

  const sessionToken = randomUUID();
  sessions.set(sessionToken, { queriesLeft: queries, createdAt: Date.now(), txHash });
  res.json({ sessionToken, queries, payer: verification.payer, paymentMode: "x402" });
});

// ── Facilitator: verify ───────────────────────────────────────────────────────

app.post("/verify", async (req: Request, res: Response) => {
  const { paymentPayload } = req.body as { paymentPayload?: unknown };
  const txHash = extractPaymentTxHash(paymentPayload);

  if (!txHash) {
    res.status(400).json({
      valid: false,
      isValid: false,
      error: "paymentPayload txHash required",
    });
    return;
  }

  const requirement = extractPaymentRequirement(req.body);
  const payTo = requirement.payTo ?? RECEIVER;
  const minAmount = requirement.amountWei ?? AMOUNT_WEI;

  const result = await verifyCusdPayment(txHash, payTo, minAmount);
  res.json({ ...result, isValid: result.valid });
});

// ── Facilitator: settle ───────────────────────────────────────────────────────

app.post("/settle", (req: Request, res: Response) => {
  const { paymentPayload } = req.body as { paymentPayload?: unknown };
  const txHash = extractPaymentTxHash(paymentPayload) ?? (req.body as { txHash?: string }).txHash;
  if (!txHash) {
    res.status(400).json({ error: "txHash required" });
    return;
  }

  // Mark nonce used (simple idempotency)
  if (!usedNonces.has(txHash)) {
    usedNonces.set(txHash, Date.now());
  }

  res.json({
    settled: true,
    success: true,
    txHash,
    transaction: txHash,
    settlementTimestamp: new Date().toISOString(),
    network: `eip155:${CHAIN_ID}`,
    asset: "cUSD",
    contract: CUSD_CONTRACT,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

export function startCeloX402Server(port = PORT): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(
        `[celo-x402] Server running on :${port} (${DEV_MODE ? "DEV mode — no payment required" : `PROD — receiver: ${RECEIVER.slice(0, 10)}…`})`
      );
      resolve();
    });
    server.on("error", reject);
  });
}

// CLI entry
const argv1 = process.argv[1] ?? "";
if (
  argv1.endsWith("celo-x402-server.ts") ||
  argv1.endsWith("celo-x402-server.js")
) {
  void startCeloX402Server().catch((err) => {
    console.error("[celo-x402] Failed to start:", err);
    process.exit(1);
  });
}
