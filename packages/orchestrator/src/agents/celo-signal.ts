/**
 * Celo Signal Agent
 *
 * Accumulator: waits for BOTH scout:complete AND ledger:complete before running.
 * Fetches 3 data snapshots from the Celo x402 server (port 3002) and averages them.
 * Mirrors signal.ts but uses cUSD payments and Celo-specific data.
 * Publishes signal:complete to the shared bus.
 */

import type { Account } from "viem";
import { payAndFetchCelo } from "@calagent/agent-kit";
import { bus, type AgentMessage } from "../lib/bus.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CeloSnapshot {
  block: number | null;
  gasPrice: string | null;
  chainId: number | null;
  celoUsdRate: number;
  cUsdSupply: string;
  timestamp: string;
}

// ── CeloSignalAgent ───────────────────────────────────────────────────────────

export class CeloSignalAgent {
  private account: Account | null = null;

  private async fetchSnapshot(account: Account, serverUrl: string): Promise<CeloSnapshot | null> {
    const txHashes: string[] = [];
    try {
      const { data } = await payAndFetchCelo<CeloSnapshot>(
        `${serverUrl}/market-data`,
        account,
        txHashes,
        process.env.CELO_RPC_URL
      );
      return data;
    } catch {
      return null;
    }
  }

  private averageSnapshots(snapshots: CeloSnapshot[]): CeloSnapshot {
    if (snapshots.length === 0) {
      return { block: null, gasPrice: null, chainId: null, celoUsdRate: 0, cUsdSupply: "unavailable", timestamp: new Date().toISOString() };
    }
    if (snapshots.length === 1) return snapshots[0]!;

    const last = snapshots[snapshots.length - 1]!;
    const rates = snapshots.map((s) => s.celoUsdRate).filter((r) => r > 0);
    const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

    return { ...last, celoUsdRate: avgRate };
  }

  private extractText(payload: unknown): string {
    if (!payload || typeof payload !== "object") return String(payload ?? "");
    const p = payload as Record<string, unknown>;
    if (typeof p["summary"] === "string") return p["summary"];
    if (typeof p["result"] === "string") return p["result"];
    return JSON.stringify(payload).slice(0, 500);
  }

  private async runBusInternal(params: {
    runId: string;
    scoutPayload: unknown;
    ledgerPayload: unknown;
    taskPrompt?: string;
  }): Promise<void> {
    const { runId, scoutPayload, ledgerPayload, taskPrompt } = params;
    const account = this.account;

    console.log("[celo-signal] Both scout:complete + ledger:complete received — running analysis…");

    const serverUrl = process.env.CELO_X402_SERVER_URL ?? "http://localhost:3002";
    const txHashes: string[] = [];

    let snapshots: CeloSnapshot[] = [];
    if (account) {
      // Fetch 3 snapshots
      const results = await Promise.allSettled([
        this.fetchSnapshot(account, serverUrl),
        this.fetchSnapshot(account, serverUrl),
        this.fetchSnapshot(account, serverUrl),
      ]);
      snapshots = results
        .filter((r) => r.status === "fulfilled" && r.value != null)
        .map((r) => (r as PromiseFulfilledResult<CeloSnapshot>).value);
    }

    const averaged = this.averageSnapshots(snapshots);
    const celoRate = averaged.celoUsdRate;
    const scoutSummary = this.extractText(scoutPayload);
    const ledgerSummary = this.extractText(ledgerPayload);

    const analysis = [
      `## Celo Market Data (Signal — ${snapshots.length} snapshots)`,
      `CELO/USD: ${celoRate > 0 ? `$${celoRate.toFixed(4)}` : "unavailable"}`,
      `Latest block: ${averaged.block ?? "unavailable"}`,
      `Gas price: ${averaged.gasPrice ?? "unavailable"} wei`,
      `cUSD supply: ${averaged.cUsdSupply}`,
      taskPrompt ? `\n*Task context: ${taskPrompt}*` : "",
      `\n## Web Research (Scout)\n${scoutSummary}`,
      `\n## On-Chain Data (Ledger)\n${ledgerSummary}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Simple conflict detection: ledger's chain ID vs expected network
    const ldgData = (ledgerPayload as Record<string, unknown>)?.["data"] as Record<string, unknown> | undefined;
    const ledgerBlock = Number(ldgData?.["block"] ?? 0);
    const signalBlock = averaged.block ?? 0;
    const conflictDetected = ledgerBlock > 0 && signalBlock > 0 && Math.abs(signalBlock - ledgerBlock) > 100;

    const confidence = conflictDetected ? 0.65 : snapshots.length >= 2 ? 0.85 : 0.7;

    bus.publish({
      topic: "signal:complete",
      agentId: "signal",
      runId,
      payload: {
        analysis,
        confidence,
        conflictDetected,
        scoutData: scoutPayload,
        ledgerData: ledgerPayload,
        celoRate,
        snapshots: snapshots.length,
        txHashes,
        paymentMode: "celo",
        chain: "celo",
      },
      confidence,
      timestamp: Date.now(),
    });
  }

  wire(runId: string, account?: Account, taskPrompt?: string): void {
    if (account) this.account = account;

    const received = new Map<string, AgentMessage>();
    const required: Array<"scout:complete" | "ledger:complete"> = [
      "scout:complete",
      "ledger:complete",
    ];

    const tryRun = async () => {
      if (!required.every((t) => received.has(t))) return;
      const scoutMsg = received.get("scout:complete")!;
      const ledgerMsg = received.get("ledger:complete")!;
      await this.runBusInternal({
        runId,
        scoutPayload: scoutMsg.payload,
        ledgerPayload: ledgerMsg.payload,
        taskPrompt,
      });
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
}
