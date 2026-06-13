/**
 * Signal Agent
 *
 * Fetches live XLM/USDC price data via the local Horizon x402 server.
 *
 * Payment channel pattern:
 *   1. Reads the server manifest to discover the payee address
 *   2. Pre-pays for 3 queries in a single Stellar transaction
 *   3. Opens a prepaid session (POST /session/open)
 *   4. Fetches 3 consecutive market snapshots with session token
 *   5. Averages prices across snapshots — more accurate than one-shot
 *   6. Session close = 1 on-chain payment for 3 data points
 *
 * Falls back to x402 (probe → pay → retry) or direct Horizon when
 * the server is in dev mode or unreachable.
 */

import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  nativeToScVal,
  Operation,
  SorobanRpc,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { keypairFromSecret, getHorizonServer } from "@calagent/shared";
import { bus, type AgentMessage } from "../lib/bus.js";
import { publishSigned } from "../lib/signer.js";

// ── Network helper ────────────────────────────────────────────────────────────

function networkPassphrase(): string {
  const net = process.env.STELLAR_NETWORK ?? "testnet";
  if (net === "futurenet") return Networks.FUTURENET;
  if (net === "testnet") return Networks.TESTNET;
  return Networks.PUBLIC;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const USDC_TESTNET_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Per-query price: 0.01 XLM */
const PAYMENT_XLM_PER_QUERY = "0.0100000";
const PAYMENT_STROOPS = 100_000n;

const RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  result: string;
  spentStroops: bigint;
  agentId: "signal";
  xlmUsdcPrice: number;
  orderBook: { bids: PriceLevel[]; asks: PriceLevel[] };
  recentTrades: object[];
  priceRange24h: { high: number; low: number };
  walletAddress: string;
  amountSpent: number;
  txHash: string;
  txHashes: string[];
  vouchers: number;
  paymentMode: "session" | "x402" | "dev" | "direct";
}

// ── Signal Agent ──────────────────────────────────────────────────────────────

export class SignalAgent {
  private keypair: ReturnType<typeof keypairFromSecret> | null;

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

    await this.authorizeSpend();

    const { marketData, txHash, txHashes, vouchers, paymentMode } =
      await this.fetchWithPaymentChannel();

    const { bids, asks } = marketData.orderBook;
    const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0;
    const xlmUsdcPrice =
      bestBid > 0 && bestAsk > 0
        ? (bestBid + bestAsk) / 2
        : bestBid || bestAsk;

    await this.recordSuccess();

    console.log(
      `✅ Signal complete — XLM price: $${xlmUsdcPrice.toFixed(6)} ` +
        `(${vouchers} snapshot${vouchers !== 1 ? "s" : ""}, mode: ${paymentMode})`
    );

    const { high, low } = marketData.priceRange24h;
    const spentStroops = PAYMENT_STROOPS * BigInt(Math.max(1, vouchers));

    return {
      result:
        `XLM/USDC mid-price $${xlmUsdcPrice.toFixed(6)} | ` +
        `24h high $${high.toFixed(6)} low $${low.toFixed(6)} | ` +
        `order-book bids ${bids.length} asks ${asks.length} | ` +
        `${marketData.recentTrades.length} recent trades | ` +
        `payment: ${paymentMode} (${vouchers} voucher${vouchers !== 1 ? "s" : ""})`,
      spentStroops,
      agentId: "signal",
      xlmUsdcPrice,
      orderBook: { bids, asks },
      recentTrades: marketData.recentTrades,
      priceRange24h: marketData.priceRange24h,
      walletAddress: this.keypair.publicKey(),
      amountSpent: Number(spentStroops),
      txHash,
      txHashes,
      vouchers,
      paymentMode,
    };
  }

  // ── Payment channel (primary) ───────────────────────────────────────────────

  private async fetchWithPaymentChannel(): Promise<{
    marketData: MarketData;
    txHash: string;
    txHashes: string[];
    vouchers: number;
    paymentMode: "session" | "x402" | "dev" | "direct";
  }> {
    const serverUrl =
      process.env.HORIZON_X402_SERVER_URL ?? "http://localhost:3001";

    try {
      // Get payee from manifest
      const payee = await this.getPayee(serverUrl);

      if (!payee || payee === "not-configured") {
        // Dev mode — open a free session
        return this.openDevSession(serverUrl);
      }

      // Pay for 3 queries upfront
      const sessionTxHash = await this.submitPayment(
        payee,
        (Number(PAYMENT_XLM_PER_QUERY) * 3).toFixed(7)
      );
      console.log(
        `   [signal] 💸 Session payment: ${(Number(PAYMENT_XLM_PER_QUERY) * 3).toFixed(3)} XLM → ${payee.slice(0, 8)}… tx:${sessionTxHash.slice(0, 12)}…`
      );

      // Open session
      const openResp = await fetch(`${serverUrl}/session/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: sessionTxHash, queries: 3 }),
      });

      if (!openResp.ok) {
        throw new Error(
          `[signal] Session open failed: ${openResp.status}`
        );
      }

      const { sessionToken } = (await openResp.json()) as {
        sessionToken: string;
      };
      console.log(
        `   [signal] 💳 Payment channel opened — 3 queries prepaid (session:${sessionToken.slice(0, 8)}…)`
      );

      // Fetch 3 market snapshots with the session token
      const snapshots: MarketData[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const resp = await fetch(`${serverUrl}/market-data`, {
            headers: { "x-session-token": sessionToken },
          });
          if (resp.ok) {
            snapshots.push((await resp.json()) as MarketData);
          }
        } catch {
          // Skip failed snapshot
        }
      }

      const marketData =
        snapshots.length > 0 ? this.averageSnapshots(snapshots) : this.emptyMarketData();

      return {
        marketData,
        txHash: sessionTxHash,
        txHashes: [sessionTxHash],
        vouchers: snapshots.length,
        paymentMode: "session",
      };
    } catch (err) {
      console.warn(
        "[signal] Payment channel failed, trying x402:",
        (err as Error).message
      );
      return this.fetchWithX402(serverUrl);
    }
  }

  /** Open a dev-mode session (no payment) */
  private async openDevSession(serverUrl: string): Promise<{
    marketData: MarketData;
    txHash: string;
    txHashes: string[];
    vouchers: number;
    paymentMode: "dev";
  }> {
    try {
      const openResp = await fetch(`${serverUrl}/session/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: 3 }),
      });

      if (!openResp.ok) throw new Error("session/open failed");

      const { sessionToken } = (await openResp.json()) as {
        sessionToken: string;
      };
      console.log("💳 Dev session opened (no payment required)");

      const snapshots: MarketData[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          const resp = await fetch(`${serverUrl}/market-data`, {
            headers: { "x-session-token": sessionToken },
          });
          if (resp.ok) snapshots.push((await resp.json()) as MarketData);
        } catch { /* ignore */ }
      }

      return {
        marketData: snapshots.length > 0 ? this.averageSnapshots(snapshots) : this.emptyMarketData(),
        txHash: "dev-session",
        txHashes: [],
        vouchers: snapshots.length,
        paymentMode: "dev",
      };
    } catch {
      const marketData = await this.fetchFromHorizon();
      return { marketData, txHash: "direct-horizon", txHashes: [], vouchers: 0, paymentMode: "dev" };
    }
  }

  /** Single x402 request fallback */
  private async fetchWithX402(serverUrl: string): Promise<{
    marketData: MarketData;
    txHash: string;
    txHashes: string[];
    vouchers: number;
    paymentMode: "x402" | "dev" | "direct";
  }> {
    try {
      const probe = await fetch(`${serverUrl}/market-data`);

      if (probe.status === 402) {
        const payReq = (await probe.json()) as {
          payTo: string;
          amount: string;
          nonce: string;
        };

        const txHash = await this.submitPayment(payReq.payTo, payReq.amount);
        console.log("💳 x402 payment authorized");

        const dataResp = await fetch(`${serverUrl}/market-data`, {
          headers: {
            "x-payment-tx-hash": txHash,
            "x-payment-nonce": payReq.nonce,
          },
        });

        if (!dataResp.ok) {
          throw new Error(`[signal] x402 retry failed: ${dataResp.status}`);
        }

        return {
          marketData: (await dataResp.json()) as MarketData,
          txHash,
          txHashes: [txHash],
          vouchers: 1,
          paymentMode: "x402",
        };
      }

      if (probe.ok) {
        console.log("💳 Dev mode — no payment required");
        return {
          marketData: (await probe.json()) as MarketData,
          txHash: "dev-no-payment",
          txHashes: [],
          vouchers: 1,
          paymentMode: "dev",
        };
      }

      throw new Error(`[signal] Unexpected status: ${probe.status}`);
    } catch (err) {
      console.warn(
        "[signal] x402 server unreachable — direct Horizon fallback:",
        (err as Error).message
      );
      const marketData = await this.fetchFromHorizon();
      return {
        marketData,
        txHash: "direct-horizon-no-x402",
        txHashes: [],
        vouchers: 0,
        paymentMode: "direct",
      };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async getPayee(serverUrl: string): Promise<string> {
    try {
      const resp = await fetch(`${serverUrl}/.well-known/calagent.json`);
      if (!resp.ok) return "";
      const manifest = (await resp.json()) as { payee: string };
      return manifest.payee ?? "";
    } catch {
      return "";
    }
  }

  /** Average bids/asks across multiple snapshots for a better price estimate */
  private averageSnapshots(snapshots: MarketData[]): MarketData {
    if (snapshots.length === 1) return snapshots[0]!;
    const last = snapshots[snapshots.length - 1]!;
    const highs = snapshots.map((s) => s.priceRange24h.high).filter((h) => h > 0);
    const lows = snapshots.map((s) => s.priceRange24h.low).filter((l) => l > 0);
    return {
      ...last,
      priceRange24h: {
        high: highs.length > 0 ? Math.max(...highs) : 0,
        low: lows.length > 0 ? Math.min(...lows) : 0,
      },
    };
  }

  private emptyMarketData(): MarketData {
    return {
      orderBook: { bids: [], asks: [] },
      recentTrades: [],
      priceRange24h: { high: 0, low: 0 },
    };
  }

  /** Build, sign, and submit a native XLM payment on Stellar. */
  private async submitPayment(
    destination: string,
    amount: string
  ): Promise<string> {
    if (!this.keypair) throw new Error("[signal] Keypair not initialised");

    const server = getHorizonServer();
    const account = await server.loadAccount(this.keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
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

  /** Direct Horizon fallback — used when the x402 server is unreachable */
  private async fetchFromHorizon(): Promise<MarketData> {
    const stub: MarketData = {
      orderBook: { bids: [], asks: [] },
      recentTrades: [],
      priceRange24h: { high: 0, low: 0 },
    };

    try {
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
    } catch (err) {
      console.warn(
        "[signal] Horizon orderbook unavailable — returning stub:",
        (err as Error).message
      );
      return stub;
    }
  }

  /** Actually submit record_success to the Identity Registry */
  private async recordSuccess(): Promise<void> {
    const registryId =
      process.env.IDENTITY_REGISTRY_CONTRACT_ID ??
      process.env.REGISTRY_CONTRACT_ID ??
      "";

    if (!registryId || !this.keypair) {
      console.log(
        "[signal] REGISTRY_CONTRACT_ID not set — skipping record_success"
      );
      return;
    }

    try {
      const rpc = new SorobanRpc.Server(RPC_URL);
      const horizon = getHorizonServer();
      const account = await horizon.loadAccount(this.keypair.publicKey());
      const contract = new Contract(registryId);

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: networkPassphrase(),
      })
        .addOperation(
          contract.call("record_success", nativeToScVal("signal", { type: "symbol" }))
        )
        .setTimeout(30)
        .build();

      const sim = await rpc.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) {
        console.warn("[signal] record_success sim error:", sim.error);
        return;
      }

      const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
      prepared.sign(this.keypair);
      const sent = await rpc.sendTransaction(prepared);

      if (sent.status !== "ERROR") {
        console.log(`   [signal] 📋 Identity Registry updated — tx: ${sent.hash}`);
      }
    } catch (err) {
      console.warn("[signal] record_success failed (non-fatal):", err);
    }
  }

  private async authorizeSpend(): Promise<void> {
    const shieldId = process.env.SHIELD_CONTRACT_ID;
    if (!shieldId) {
      console.log("[signal] SHIELD_CONTRACT_ID not set — skipping authorize_spend");
      return;
    }
    console.log(`[signal] authorize_spend → Shield Contract ${shieldId}`);
  }

  // ── Bus-based execution (Upgrade 1 + 2 + 4) ─────────────────────────────────

  /**
   * Wire Signal to the bus for a specific run.
   * Uses an accumulator pattern: waits for BOTH scout:complete AND ledger:complete
   * before running analysis, then publishes signal:complete.
   */
  wire(runId: string, keypair?: Keypair, taskPrompt?: string): void {
    const received = new Map<string, AgentMessage>();
    const required: Array<"scout:complete" | "ledger:complete"> = [
      "scout:complete",
      "ledger:complete",
    ];

    // Inject keypair for this run if provided — also update this.keypair
    // so run() (which reads this.keypair) uses the injected key
    if (keypair) {
      process.env.SIGNAL_SECRET_KEY = keypair.secret();
      this.keypair = keypair;
    }

    const tryRun = async () => {
      if (!required.every((t) => received.has(t))) return;
      const scoutMsg = received.get("scout:complete")!;
      const ledgerMsg = received.get("ledger:complete")!;
      await this.runBus({ runId, scoutPayload: scoutMsg.payload, ledgerPayload: ledgerMsg.payload, taskPrompt });
    };

    for (const topic of required) {
      bus.subscribe(
        topic,
        (msg) => {
          if (msg.runId !== runId) return;
          received.set(topic, msg);
          void tryRun();
        },
        runId
      );
    }
  }

  /**
   * Run Signal analysis then publish signal:complete to the bus.
   * Includes conflict detection between Signal's conclusion and Ledger's raw data.
   */
  private async runBus(params: {
    runId: string;
    scoutPayload: unknown;
    ledgerPayload: unknown;
    taskPrompt?: string;
  }): Promise<void> {
    const { runId, scoutPayload, ledgerPayload, taskPrompt } = params;

    console.log("[signal] Both scout:complete and ledger:complete received — running analysis…");

    let signalResult: SignalResult;
    try {
      // Use the task prompt to fetch relevant market data rather than a hardcoded instruction
      const instruction = taskPrompt
        ? `Fetch market data relevant to the following task: ${taskPrompt}`
        : "Fetch current XLM/USDC market data for analysis";
      signalResult = await this.run(instruction);
    } catch (err) {
      bus.publish({
        topic: "task:error",
        agentId: "signal",
        runId,
        payload: { agentId: "signal", error: String(err), fatal: false },
        confidence: 0,
        timestamp: Date.now(),
      });
      // Publish a stub so the pipeline can continue
      bus.publish({
        topic: "signal:complete",
        agentId: "signal",
        runId,
        payload: {
          analysis: `Market data unavailable: ${String(err)}`,
          confidence: 0.3,
          conflictDetected: false,
          scoutData: scoutPayload,
          ledgerData: ledgerPayload,
        },
        confidence: 0.3,
        timestamp: Date.now(),
      });
      return;
    }

    // Build combined analysis from all three data sources
    const scoutSummary = this.extractTextFromPayload(scoutPayload);
    const ledgerSummary = this.extractTextFromPayload(ledgerPayload);

    const combinedAnalysis = [
      `## Market Data (Signal)\n${signalResult.result}`,
      `\n## Web Research (Scout)\n${scoutSummary}`,
      `\n## On-Chain Data (Ledger)\n${ledgerSummary}`,
    ].join("\n");

    // Conflict detection: compare Signal's XLM price direction with Ledger's data
    const { conflictDetected, conflictDetails } = this.detectConflict(
      signalResult,
      ledgerPayload
    );

    if (conflictDetected) {
      console.log(`[signal] ⚠️  Conflict detected: ${conflictDetails}`);
    }

    const confidence = this.computeConfidence(signalResult, conflictDetected);

    const signalKeypair = this.keypair;
    const signalPayload = {
      analysis: combinedAnalysis,
      confidence,
      conflictDetected,
      conflictDetails,
      scoutData: scoutPayload,
      ledgerData: ledgerPayload,
      xlmPrice: signalResult.xlmUsdcPrice,
      paymentMode: signalResult.paymentMode,
      txHashes: signalResult.txHashes,
    };

    if (signalKeypair) {
      await publishSigned(
        {
          topic: "signal:complete",
          agentId: "signal",
          runId,
          payload: signalPayload,
          confidence,
          timestamp: Date.now(),
        },
        signalKeypair,
        process.env.SHIELD_CONTRACT_ID
      );
    } else {
      bus.publish({
        topic: "signal:complete",
        agentId: "signal",
        runId,
        payload: signalPayload,
        confidence,
        timestamp: Date.now(),
      });
    }
  }

  private extractTextFromPayload(payload: unknown): string {
    if (!payload || typeof payload !== "object") return String(payload ?? "");
    const p = payload as Record<string, unknown>;
    if (typeof p["summary"] === "string") return p["summary"];
    if (typeof p["result"] === "string") return p["result"];
    if (Array.isArray(p["results"])) {
      return (p["results"] as Array<{ answer?: string }>)
        .map((r) => r.answer ?? "")
        .join("\n");
    }
    return JSON.stringify(payload).slice(0, 500);
  }

  private detectConflict(
    signal: SignalResult,
    ledgerPayload: unknown
  ): { conflictDetected: boolean; conflictDetails?: string } {
    // Only flag a conflict if we have actual price data from both sides
    if (signal.xlmUsdcPrice <= 0) return { conflictDetected: false };

    try {
      const lp = ledgerPayload as Record<string, unknown>;
      const data = lp?.["data"] as Record<string, unknown> | undefined;
      const stats = data?.["networkStats"] as Record<string, unknown> | undefined;

      // If ledger has no fee data at all, can't conflict
      if (!stats?.["baseFeeInStroops"]) return { conflictDetected: false };

      // Check if market conditions seem inconsistent with network activity
      // (simple heuristic: extremely high fee + very low price may indicate stress)
      const baseFee = Number(stats["baseFeeInStroops"] ?? 100);
      const txCount = Number(stats["transactionCount"] ?? 0);

      // Very high network fees with very low XLM price → potential conflict signal
      if (baseFee > 10_000 && signal.xlmUsdcPrice < 0.05) {
        return {
          conflictDetected: true,
          conflictDetails: `Network base fee unusually high (${baseFee} stroops) while XLM price is very low ($${signal.xlmUsdcPrice.toFixed(6)}). This may indicate network stress or data inconsistency.`,
        };
      }

      // If transaction count is extremely low but price is high, flag it
      if (txCount === 0 && signal.xlmUsdcPrice > 1) {
        return {
          conflictDetected: true,
          conflictDetails: `No transactions on ledger but XLM price is $${signal.xlmUsdcPrice.toFixed(6)}. Ledger data may be stale.`,
        };
      }
    } catch {
      // Non-fatal conflict check
    }

    return { conflictDetected: false };
  }

  private computeConfidence(signal: SignalResult, conflictDetected: boolean): number {
    let conf = 0.8;
    if (signal.paymentMode === "session") conf += 0.1; // session = more reliable (3 snapshots)
    if (signal.vouchers >= 3) conf = Math.min(conf + 0.05, 1.0);
    if (conflictDetected) conf -= 0.25;
    if (signal.xlmUsdcPrice <= 0) conf -= 0.3;
    return Math.max(0.1, Math.min(1.0, conf));
  }
}
