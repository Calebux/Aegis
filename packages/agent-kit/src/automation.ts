/**
 * createAutomation() — Single-agent task automation with cron scheduling,
 * webhook handling, retries, and optional receipt generation.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { fundTestnetAccount } from "./stellar-helpers.js";
import { payAndFetch } from "./payments.js";
import { createRunReceipt, signRunReceipt, sha256Hex } from "./receipts.js";
import type {
  AgentDefinition,
  AgentContext,
  OrchestratorReport,
  RunReceipt,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AutomationOptions {
  /** Fixed task string passed to the agent on each run */
  task: string;
  /** 5-field cron expression (minute hour dom month dow). Optional. */
  schedule?: string;
  /** Number of retries on failure (default: 0) */
  retries?: number;
  /** Delay in ms between retries (default: 1000) */
  retryDelayMs?: number;
  /** Generate a RunReceipt per run (default: false) */
  generateReceipt?: boolean;
  /** Auto-fund wallet on testnet (default: true) */
  provisionWallet?: boolean;
  /** Bring your own Stellar Keypair — skips provisioning */
  keypair?: Keypair;
  /** Shield Contract ID for on-chain registration */
  shieldContractId?: string;
  /** Identity Registry Contract ID */
  registryContractId?: string;
  /** Callback after each successful run */
  onResult?: (result: AutomationRunResult) => void;
  /** Callback on failure (after retries exhausted) */
  onError?: (error: Error) => void;
}

export interface AutomationRunResult {
  runId: string;
  task: string;
  result: string;
  success: boolean;
  spentStroops: number;
  txHashes: string[];
  receipt?: RunReceipt;
  timestamp: string;
  durationMs: number;
  /** Which retry attempt succeeded (1-based) */
  attempt: number;
}

export interface Automation {
  /** Start the cron schedule (requires options.schedule) */
  start(): void;
  /** Stop the cron schedule */
  stop(): void;
  /** Execute a single run, optionally overriding the task string */
  runOnce(taskOverride?: string): Promise<AutomationRunResult>;
  /** Webhook handler — accepts POST with optional { task } body */
  handler: (req: Request) => Promise<Response>;
  /** Whether the cron schedule is currently running */
  readonly running: boolean;
}

/* ------------------------------------------------------------------ */
/*  Cron parser (5-field: minute hour dom month dow)                    */
/* ------------------------------------------------------------------ */

interface CronSchedule {
  matches(date: Date): boolean;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    if (range === "*") {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (range.includes("-")) {
      const [lo, hi] = range.split("-").map(Number);
      for (let i = lo; i <= hi; i += step) values.add(i);
    } else {
      values.add(parseInt(range, 10));
    }
  }
  return values;
}

function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expr}": expected 5 fields (minute hour dom month dow)`
    );
  }
  const minutes = parseField(parts[0], 0, 59);
  const hours = parseField(parts[1], 0, 23);
  const doms = parseField(parts[2], 1, 31);
  const months = parseField(parts[3], 1, 12);
  const dows = parseField(parts[4], 0, 6);

  return {
    matches(date: Date): boolean {
      return (
        minutes.has(date.getMinutes()) &&
        hours.has(date.getHours()) &&
        doms.has(date.getDate()) &&
        months.has(date.getMonth() + 1) &&
        dows.has(date.getDay())
      );
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  createAutomation                                                   */
/* ------------------------------------------------------------------ */

export function createAutomation(
  agent: AgentDefinition,
  options: AutomationOptions
): Automation {
  const {
    task: defaultTask,
    schedule,
    retries = 0,
    retryDelayMs = 1000,
    generateReceipt = false,
    provisionWallet = true,
    shieldContractId,
    registryContractId,
    onResult,
    onError,
  } = options;

  let cachedKeypair: Keypair | null = options.keypair ?? null;
  let walletReady = !!options.keypair;
  let walletInitPromise: Promise<void> | null = null;
  let cronTimer: ReturnType<typeof setInterval> | null = null;
  let _running = false;
  let cronSchedule: CronSchedule | null = null;

  if (schedule) {
    cronSchedule = parseCron(schedule);
  }

  /* ---- wallet provisioning (lazy, once) ---- */

  async function ensureWallet(): Promise<Keypair> {
    if (cachedKeypair && walletReady) return cachedKeypair;

    if (!walletInitPromise) {
      walletInitPromise = (async () => {
        if (!cachedKeypair) {
          cachedKeypair = Keypair.random();
        }
        if (provisionWallet) {
          try {
            await fundTestnetAccount(cachedKeypair.publicKey());
          } catch {
            // Friendbot may fail if already funded or on mainnet — continue
          }
        }
        walletReady = true;
      })();
    }
    await walletInitPromise;
    return cachedKeypair!;
  }

  /* ---- single execution ---- */

  async function executeOnce(task: string): Promise<AutomationRunResult> {
    const runId = generateRunId();
    const startTime = Date.now();
    const keypair = await ensureWallet();

    const txHashes: string[] = [];
    const ctx: AgentContext = {
      wallet: keypair,
      txHashes,
      pay: async <T = unknown>(url: string): Promise<T> => {
        const { data } = await payAndFetch<T>(url, keypair, txHashes);
        return data;
      },
    };

    const res = await agent.run(task, ctx);
    const allTxHashes = [...txHashes, ...(res.txHashes ?? [])];
    const spentStroops = Number(res.spentStroops ?? 0);

    let receipt: RunReceipt | undefined;
    if (generateReceipt) {
      const report: OrchestratorReport = {
        task,
        subtasks: { [agent.id]: task },
        results: { [agent.id]: res.result },
        report: res.result,
        wallets: { [agent.id]: keypair.publicKey() },
        spent: { [agent.id]: spentStroops },
        reputation: { [agent.id]: 5000 },
        txHashes: { [agent.id]: allTxHashes },
        timestamp: new Date().toISOString(),
      };
      receipt = createRunReceipt({
        report,
        runId,
        shieldContractId,
        registryContractId,
      });
      receipt = signRunReceipt(receipt, keypair);
    }

    return {
      runId,
      task,
      result: res.result,
      success: true,
      spentStroops,
      txHashes: allTxHashes,
      receipt,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      attempt: 1, // set by caller for retries
    };
  }

  /* ---- runOnce with retries ---- */

  async function runOnce(taskOverride?: string): Promise<AutomationRunResult> {
    const task = taskOverride ?? defaultTask;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const result = await executeOnce(task);
        result.attempt = attempt;
        onResult?.(result);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt <= retries) {
          await delay(retryDelayMs);
        }
      }
    }

    // All retries exhausted
    const error = lastError ?? new Error("Unknown automation error");
    onError?.(error);

    return {
      runId: generateRunId(),
      task,
      result: error.message,
      success: false,
      spentStroops: 0,
      txHashes: [],
      timestamp: new Date().toISOString(),
      durationMs: 0,
      attempt: retries + 1,
    };
  }

  /* ---- cron scheduling ---- */

  function start(): void {
    if (!cronSchedule) {
      throw new Error(
        "Cannot start(): no schedule provided in AutomationOptions"
      );
    }
    if (_running) return;
    _running = true;

    // Check every 60 seconds if current minute matches
    let lastFiredMinute = -1;
    cronTimer = setInterval(() => {
      const now = new Date();
      const currentMinute =
        now.getFullYear() * 1_000_000 +
        (now.getMonth() + 1) * 10_000 +
        now.getDate() * 100 +
        now.getHours() * 60 +
        now.getMinutes();

      if (currentMinute !== lastFiredMinute && cronSchedule!.matches(now)) {
        lastFiredMinute = currentMinute;
        runOnce().catch(() => {
          // errors are reported via onError callback
        });
      }
    }, 60_000);
  }

  function stop(): void {
    if (cronTimer) {
      clearInterval(cronTimer);
      cronTimer = null;
    }
    _running = false;
  }

  /* ---- webhook handler ---- */

  async function handler(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    let taskOverride: string | undefined;
    try {
      const body = await req.json();
      if (body && typeof body.task === "string") {
        taskOverride = body.task;
      }
    } catch {
      // No body or invalid JSON — use default task
    }

    const result = await runOnce(taskOverride);
    const status = result.success ? 200 : 500;
    return new Response(JSON.stringify(result), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /* ---- public interface ---- */

  return {
    start,
    stop,
    runOnce,
    handler,
    get running() {
      return _running;
    },
  };
}
