/**
 * Celo Scout Agent
 *
 * Mirrors scout.ts but uses a viem EVM Account instead of Stellar Keypair.
 * Web search via Linkup SDK (chain-agnostic). On-chain registration via
 * CeloIdentityRegistry. Publishes scout:complete to the shared bus.
 */

import { LinkupClient } from "linkup-sdk";
import Anthropic from "@anthropic-ai/sdk";
import type { Account } from "viem";
import { CeloIdentityRegistry } from "@calebux/agent-kit";
import type { LLMProvider } from "@calebux/agent-kit";
import { bus } from "../lib/bus.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchResult {
  query: string;
  answer: string;
  sources: { name: string; url: string }[];
}

// ── CeloScoutAgent ────────────────────────────────────────────────────────────

export class CeloScoutAgent {
  private account: Account | null = null;
  private registry: CeloIdentityRegistry | null = null;
  private readonly anthropic: Anthropic;
  private readonly linkup: LinkupClient;
  private readonly llm?: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.linkup = new LinkupClient({ apiKey: process.env.LINKUP_API_KEY ?? "" });
    this.llm = llm;
  }

  private async search(query: string): Promise<SearchResult> {
    try {
      const result = await this.linkup.search({
        query,
        depth: "standard",
        outputType: "searchResults",
      });
      const sources = (result.results ?? []).map((r) => ({
        name: String(r.name ?? r.url ?? ""),
        url: String(r.url ?? ""),
      }));
      const answer = (result.results ?? [])
        .map((r) => {
          const item = r as { content?: unknown; snippet?: unknown };
          return String(item.content ?? item.snippet ?? "");
        })
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000);
      return { query, answer, sources };
    } catch (err) {
      console.warn(`[celo-scout] Search failed for "${query}":`, err);
      return { query, answer: `Search unavailable: ${String(err)}`, sources: [] };
    }
  }

  private async decompose(task: string): Promise<string[]> {
    try {
      const decomposePrompt = `Decompose this task into 2-4 specific web search queries.\nOutput ONLY the queries, one per line — no labels or JSON.\n\nTask: ${task}`;
      let text: string;

      if (this.llm) {
        const result = await this.llm.chat(
          [{ role: "user", content: decomposePrompt }],
          { model: "claude-haiku-4-5-20251001", maxTokens: 256 }
        );
        text = result.text;
      } else {
        const resp = await this.anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 256,
          messages: [{ role: "user", content: decomposePrompt }],
        });
        text = resp.content[0].type === "text" ? resp.content[0].text : task;
      }

      return text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .slice(0, 4);
    } catch {
      return [task];
    }
  }

  private buildRegistry(): CeloIdentityRegistry | null {
    const addr = process.env.CELO_REGISTRY_ADDRESS;
    const key = process.env.CELO_DEPLOYER_PRIVATE_KEY;
    if (!addr || !key) return null;
    return new CeloIdentityRegistry(
      addr,
      key,
      process.env.CELO_RPC_URL,
      process.env.CALAGENT_CELO_NETWORK
    );
  }

  async runBus(params: {
    task: string;
    runId: string;
    account?: Account;
  }): Promise<void> {
    const { task, runId, account } = params;
    if (account) this.account = account;
    if (!this.registry) this.registry = this.buildRegistry();

    console.log("[celo-scout] Starting web research…");

    const queries = await this.decompose(task);
    console.log(`[celo-scout] Searching: ${queries.join(", ")}`);

    const results = await Promise.all(queries.map((q) => this.search(q)));
    const summary = results
      .map((r) => `**${r.query}**\n${r.answer}`)
      .join("\n\n");
    const allSources = results.flatMap((r) => r.sources);

    const totalSources = allSources.length;
    const walletAddress = account?.address ?? "0x";

    console.log(
      `[celo-scout] ✅ Research complete — ${totalSources} sources across ${results.length} queries`
    );

    // Record success on Celo registry (fire-and-forget)
    void this.registry?.recordSuccess("celo-scout").catch(() => {});

    bus.publish({
      topic: "scout:complete",
      agentId: "scout",
      runId,
      payload: {
        summary,
        results: results.map((r) => ({
          query: r.query,
          answer: r.answer,
          sources: r.sources,
        })),
        sources: allSources,
        walletAddress,
        amountSpent: 0,
        txHashes: [],
        paymentMode: "celo",
        chain: "celo",
      },
      confidence: 0.85,
      timestamp: Date.now(),
    });
  }
}
