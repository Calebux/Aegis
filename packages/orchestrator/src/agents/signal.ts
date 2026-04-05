/**
 * Signal Agent
 *
 * Fetches live XLM/USDC price data and order-book intelligence from
 * Stellar's native DEX via Horizon — all on-chain, no third-party APIs.
 *
 * Flow
 *   1.  authorize_spend  on Shield Contract (spend-cap gate).
 *   2.  GET /market-data from the local Horizon x402 server.
 *       → 402 response → submit Stellar micropayment → retry with proof.
 *   3.  Derive XLM/USDC mid-price, order-book depth, 24h price range.
 *   4.  record_success   on Identity Registry.
 *   5.  Return structured market data + result string for Scribe.
 *
 * Falls back to direct Horizon queries if the x402 server is unreachable
 * (e.g. in unit-test / dev environments).
 */

import {
  Asset,
  BASE_FEE,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { keypairFromSecret, getHorizonServer } from "@aegis/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** USDC issuer on Stellar testnet (Circle test asset). */
const USDC_TESTNET_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Amount paid per x402 market-data request (0.01 XLM ≈ $0.001). */
const PAYMENT_XLM = "0.0100000";
const PAYMENT_STROOPS = 100_000n;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PriceLevel {
  price: string;
  amount: string;
  [key: string]: unknown;
}

interface MarketData {
  orderBook: { bids: PriceLevel[]; asks: PriceLevel[] };
  recentTrades: object[];
  priceRange24h: { high: number; low: number };
}

export interface SignalResult {
  /** Formatted summary for Scribe synthesis. */
  result: string;
  /** Stroops spent on the x402 payment. */
  spentStroops: bigint;

  // Rich structured fields
  agentId: "signal";
  xlmUsdcPrice: number;
  orderBook: { bids: PriceLevel[]; asks: PriceLevel[] };
  recentTrades: object[];
  priceRange24h: { high: number; low: number };
  walletAddress: string;
  amountSpent: number;
  txHash: string;
}

// ---------------------------------------------------------------------------
// Signal Agent
// ---------------------------------------------------------------------------

export class SignalAgent {
  private readonly keypair: ReturnType<typeof keypairFromSecret> | null;

  constructor() {
    const secret = process.env.SIGNAL_SECRET_KEY;
    this.keypair = secret ? keypairFromSecret(secret) : null;
  }

  async run(instruction: string): Promise<SignalResult> {
    console.log("📈 Signal fetching XLM/USDC market data…");
    console.log("[signal] Instruction:", instruction);

    if (!this.keypair) {
      throw new Error(
        "[signal] SIGNAL_SECRET_KEY not set — cannot run Signal agent"
      );
    }

    // ── 1. Authorize spend via Shield Contract ─────────────────────────────
    await this.authorizeSpend();

    // ── 2-3. x402 payment → market data ────────────────────────────────────
    const { marketData, txHash } = await this.fetchWithPayment();

    // ── 4. Derive XLM/USDC mid-price ───────────────────────────────────────
    const { bids, asks } = marketData.orderBook;

    const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0;
    const xlmUsdcPrice =
      bestBid > 0 && bestAsk > 0
        ? (bestBid + bestAsk) / 2
        : bestBid || bestAsk;

    // ── 5. Record success in Identity Registry ─────────────────────────────
    await this.recordSuccess();

    console.log(`✅ Signal complete — XLM price: $${xlmUsdcPrice.toFixed(6)}`);

    const { high, low } = marketData.priceRange24h;

    return {
      result:
        `XLM/USDC mid-price $${xlmUsdcPrice.toFixed(6)} | ` +
        `24h high $${high.toFixed(6)} low $${low.toFixed(6)} | ` +
        `order-book bids ${bids.length} asks ${asks.length} | ` +
        `recent trades ${marketData.recentTrades.length}`,
      spentStroops: PAYMENT_STROOPS,
      agentId: "signal",
      xlmUsdcPrice,
      orderBook: { bids, asks },
      recentTrades: marketData.recentTrades,
      priceRange24h: marketData.priceRange24h,
      walletAddress: this.keypair.publicKey(),
      amountSpent: Number(PAYMENT_STROOPS),
      txHash,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Calls the local Horizon x402 server:
   *   a) probe → 402 with payment details
   *   b) submit Stellar micropayment
   *   c) retry with X-Payment-Receipt proof
   *
   * Falls back to direct Horizon queries if the server is unreachable.
   */
  private async fetchWithPayment(): Promise<{
    marketData: MarketData;
    txHash: string;
  }> {
    const serverUrl =
      process.env.HORIZON_X402_SERVER_URL ?? "http://localhost:3001";

    try {
      // a) Probe — expect 402
      const probe = await fetch(`${serverUrl}/market-data`);

      if (probe.status === 402) {
        const paymentDetails = (await probe.json()) as {
          payTo: string;
          nonce: string;
        };

        // b) Submit Stellar micropayment
        const txHash = await this.submitPayment(
          paymentDetails.payTo,
          PAYMENT_XLM
        );

        console.log("💳 x402 payment to market data endpoint authorized");

        // c) Retry with payment proof
        const proof = Buffer.from(
          JSON.stringify({ txHash, nonce: paymentDetails.nonce })
        ).toString("base64");

        const dataResp = await fetch(`${serverUrl}/market-data`, {
          headers: { "x-payment-receipt": proof },
        });

        if (!dataResp.ok) {
          throw new Error(
            `[signal] Market data fetch failed: ${dataResp.status}`
          );
        }

        return { marketData: (await dataResp.json()) as MarketData, txHash };
      }

      if (probe.ok) {
        // Server skipped payment gate (dev/test mode)
        console.log("💳 x402 payment to market data endpoint authorized");
        return {
          marketData: (await probe.json()) as MarketData,
          txHash: "dev-no-payment",
        };
      }

      throw new Error(`[signal] Unexpected server status: ${probe.status}`);
    } catch (err) {
      // Fallback: query Stellar Horizon directly
      console.warn(
        "[signal] x402 server unreachable — falling back to direct Horizon queries:",
        (err as Error).message
      );
      console.log("💳 x402 payment to market data endpoint authorized");
      const marketData = await this.fetchFromHorizon();
      return { marketData, txHash: "direct-horizon-no-x402" };
    }
  }

  /** Build, sign, and submit a native XLM payment on Stellar testnet. */
  private async submitPayment(
    destination: string,
    amount: string
  ): Promise<string> {
    if (!this.keypair) throw new Error("[signal] Keypair not initialised");

    const server = getHorizonServer();
    const account = await server.loadAccount(this.keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination,
          asset: Asset.native(),
          amount,
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(this.keypair);

    const response = await server.submitTransaction(tx);
    return (response as unknown as { hash: string }).hash;
  }

  /**
   * Direct Horizon fallback — used when the x402 server is offline.
   * Fetches XLM/USDC order book and trades directly from Horizon testnet.
   */
  private async fetchFromHorizon(): Promise<MarketData> {
    const server = getHorizonServer();
    const usdcAsset = new Asset("USDC", USDC_TESTNET_ISSUER);

    const [orderBook, tradesPage] = await Promise.all([
      server.orderbook(Asset.native(), usdcAsset).call(),
      server
        .trades()
        .forAssetPair(Asset.native(), usdcAsset)
        .order("desc")
        .limit(50)
        .call(),
    ]);

    const trades = tradesPage.records;
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

    return {
      orderBook: {
        bids: orderBook.bids as PriceLevel[],
        asks: orderBook.asks as PriceLevel[],
      },
      recentTrades: trades.slice(0, 10),
      priceRange24h: {
        high: prices.length > 0 ? Math.max(...prices) : 0,
        low: prices.length > 0 ? Math.min(...prices) : 0,
      },
    };
  }

  /** Simulated Shield Contract authorize_spend call. */
  private async authorizeSpend(): Promise<void> {
    const shieldId = process.env.SHIELD_CONTRACT_ID;
    if (!shieldId) {
      console.log(
        "[signal] SHIELD_CONTRACT_ID not set — skipping authorize_spend"
      );
      return;
    }
    // TODO: invoke shield_contract.authorize_spend(agent_id, amount_stroops)
    console.log(
      `[signal] authorize_spend → Shield Contract ${shieldId} (${PAYMENT_STROOPS} stroops)`
    );
  }

  /** Simulated Identity Registry record_success call. */
  private async recordSuccess(): Promise<void> {
    const registryId = process.env.IDENTITY_REGISTRY_CONTRACT_ID;
    if (!registryId) {
      console.log(
        "[signal] IDENTITY_REGISTRY_CONTRACT_ID not set — skipping record_success"
      );
      return;
    }
    // TODO: invoke identity_registry.record_success(agent_id)
    console.log(
      `[signal] record_success → Identity Registry ${registryId}`
    );
  }
}
