/**
 * Celo Ledger Agent
 *
 * Fetches live Celo blockchain data from the Celo x402 server (port 3002).
 * Optionally performs a non-fatal policy authorization check via CeloPolicyManager.
 * On-chain success recorded via CeloIdentityRegistry.
 * Publishes ledger:complete to the shared bus.
 */

import type { Account } from "viem";
import { payAndFetchCelo, CeloIdentityRegistry, CeloPolicyManager } from "@calebux/agent-kit";
import { bus } from "../lib/bus.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CeloMarketData {
  block: number | null;
  gasPrice: string | null;
  chainId: number | null;
  celoUsdRate: number;
  cUsdSupply: string;
  network: string;
  rpcUrl?: string;
  timestamp: string;
  paymentMode?: string;
}

// ── CeloLedgerAgent ───────────────────────────────────────────────────────────

export class CeloLedgerAgent {
  private account: Account | null = null;
  private registry: CeloIdentityRegistry | null = null;
  private policy: CeloPolicyManager | null = null;

  private buildRegistry(): CeloIdentityRegistry | null {
    const addr = process.env.CELO_REGISTRY_ADDRESS;
    const key = process.env.CELO_DEPLOYER_PRIVATE_KEY;
    if (!addr || !key) return null;
    return new CeloIdentityRegistry(addr, key, process.env.CELO_RPC_URL, process.env.AEGIS_CELO_NETWORK);
  }

  private buildPolicy(): CeloPolicyManager | null {
    const addr = process.env.CELO_POLICY_ADDRESS;
    const key = process.env.CELO_DEPLOYER_PRIVATE_KEY;
    if (!addr || !key) return null;
    return new CeloPolicyManager(addr, key, process.env.CELO_RPC_URL, process.env.AEGIS_CELO_NETWORK);
  }

  private async fetchCeloData(account: Account): Promise<{
    data: CeloMarketData;
    txHashes: string[];
    paymentMode: "x402" | "dev";
  }> {
    const serverUrl =
      process.env.CELO_X402_SERVER_URL ?? "http://localhost:3002";
    const txHashes: string[] = [];

    try {
      const { data, paymentMode } = await payAndFetchCelo<CeloMarketData>(
        `${serverUrl}/market-data`,
        account,
        txHashes,
        process.env.CELO_RPC_URL
      );
      return { data, txHashes, paymentMode };
    } catch (err) {
      console.warn(
        "[celo-ledger] x402 server unreachable — direct RPC fallback:",
        (err as Error).message
      );
      // Direct RPC fallback
      return this.fetchDirectRpc(txHashes);
    }
  }

  private async fetchDirectRpc(txHashes: string[]): Promise<{
    data: CeloMarketData;
    txHashes: string[];
    paymentMode: "dev";
  }> {
    const rpcUrl =
      process.env.CELO_RPC_URL ??
      "https://alfajores-forno.celo-testnet.org";

    async function rpc<T>(method: string, params: unknown[] = []): Promise<T | null> {
      try {
        const res = await fetch(rpcUrl, {
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

    const [blockHex, gasPriceHex, chainIdHex] = await Promise.all([
      rpc<string>("eth_blockNumber"),
      rpc<string>("eth_gasPrice"),
      rpc<string>("eth_chainId"),
    ]);

    const data: CeloMarketData = {
      block: blockHex ? Number.parseInt(blockHex, 16) : null,
      gasPrice: gasPriceHex ? BigInt(gasPriceHex).toString() : null,
      chainId: chainIdHex ? Number.parseInt(chainIdHex, 16) : null,
      celoUsdRate: 0,
      cUsdSupply: "unavailable",
      network: `eip155:${chainIdHex ? Number.parseInt(chainIdHex, 16) : "?"}`,
      timestamp: new Date().toISOString(),
      paymentMode: "direct",
    };

    return { data, txHashes, paymentMode: "dev" };
  }

  async runBus(params: {
    task: string;
    runId: string;
    account?: Account;
  }): Promise<void> {
    const { task, runId, account } = params;
    if (account) this.account = account;
    if (!this.registry) this.registry = this.buildRegistry();
    if (!this.policy) this.policy = this.buildPolicy();

    const activeAccount = this.account;
    if (!activeAccount) {
      bus.publish({
        topic: "task:error",
        agentId: "ledger",
        runId,
        payload: { agentId: "ledger", error: "CELO_LEDGER_PRIVATE_KEY not set", fatal: false },
        confidence: 0,
        timestamp: Date.now(),
      });
      // Publish stub so pipeline can continue
      bus.publish({
        topic: "ledger:complete",
        agentId: "ledger",
        runId,
        payload: { summary: "Celo ledger data unavailable — no wallet configured", txHashes: [], paymentMode: "dev" },
        confidence: 0.3,
        timestamp: Date.now(),
      });
      return;
    }

    console.log("[celo-ledger] Fetching Celo market data…");

    // Non-fatal spend authorization pre-check
    await this.policy?.authorizeSpend(
      "celo-ledger",
      BigInt(1_000_000_000_000_000), // 0.001 cUSD in wei
      process.env.AEGIS_CELO_STABLE_ASSET_CONTRACT ?? "cUSD"
    ).catch(() => {});

    const { data, txHashes, paymentMode } = await this.fetchCeloData(activeAccount);

    const summary = [
      `Celo network data retrieved via ${paymentMode} payment mode.`,
      `Task: ${task}`,
      `Block: ${data.block ?? "unavailable"}`,
      `Gas price: ${data.gasPrice ?? "unavailable"} wei`,
      `Chain ID: ${data.chainId ?? "unavailable"}`,
      `CELO/USD: ${data.celoUsdRate > 0 ? `$${data.celoUsdRate}` : "unavailable"}`,
      `cUSD supply: ${data.cUsdSupply}`,
      `Network: ${data.network}`,
    ].join("\n");

    console.log(`[celo-ledger] ✅ Data fetched — block ${data.block ?? "?"} (mode: ${paymentMode})`);

    // Record success (fire-and-forget)
    void this.registry?.recordSuccess("celo-ledger").catch(() => {});

    bus.publish({
      topic: "ledger:complete",
      agentId: "ledger",
      runId,
      payload: {
        summary,
        data,
        walletAddress: activeAccount.address,
        amountSpent: 0,
        txHashes,
        paymentMode,
        chain: "celo",
      },
      confidence: data.block != null ? 0.9 : 0.4,
      timestamp: Date.now(),
    });
  }
}
