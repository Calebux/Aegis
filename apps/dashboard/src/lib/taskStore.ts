/**
 * In-memory task store for the Cal-AgentKit dashboard, with file-based persistence.
 *
 * Tasks are serialized to .calagent-tasks.json in the project root on each state
 * change and reloaded automatically when the module is first imported.
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import type { Task } from "@calagent/shared";
import type { RunReceipt } from "@calagent/agent-kit";

/** Active tasks keyed by taskId */
export const tasks = new Map<string, Task>();

/** EventEmitter per running task — deleted when the task completes */
export const emitters = new Map<string, EventEmitter>();

/** Wallet public keys from the most recent completed run: agent → publicKey */
export const lastWallets = new Map<string, string>();

/** Spend in stroops from the most recent completed run: agent → stroops */
export const lastSpent = new Map<string, number>();

/** Reputation bps from the most recent completed run: agent → bps */
export const lastReputation = new Map<string, number>();

/** Tx hashes from the most recent completed run: agent → txHashes */
export const lastTxHashes = new Map<string, string[]>();

/** Verifiable run receipts keyed by taskId/runId */
export const receipts = new Map<string, RunReceipt>();

/** Exact output text keyed by taskId/runId for outputHash verification */
export const receiptOutputs = new Map<string, string>();

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const STORAGE_DIR = process.env.CALAGENT_STORAGE_DIR ?? process.cwd();
const PERSIST_PATH = path.join(STORAGE_DIR, ".calagent-tasks.json");
const RECEIPTS_PATH = path.join(STORAGE_DIR, ".calagent-receipts.json");
const RECEIPT_OUTPUTS_PATH = path.join(STORAGE_DIR, ".calagent-receipt-outputs.json");

export function storageInfo(): {
  mode: "file";
  directory: string;
  productionReady: boolean;
} {
  return {
    mode: "file",
    directory: STORAGE_DIR,
    productionReady: Boolean(process.env.CALAGENT_STORAGE_DIR),
  };
}

function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return { __date: value.toISOString() };
  if (typeof value === "bigint") return { __bigint: String(value) };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("__date" in v) return new Date(v.__date as string);
    if ("__bigint" in v) return BigInt(v.__bigint as string);
  }
  return value;
}

/** Write completed/failed/running tasks to disk. */
export function persistTasks(): void {
  try {
    ensureStorageDir();
    const toSave = Array.from(tasks.values()).filter(
      (t) => t.status === "completed" || t.status === "failed" || t.status === "running"
    );
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(toSave, replacer), "utf8");
  } catch (err) {
    console.warn("[taskStore] Failed to persist tasks:", err);
  }
}

export function persistReceipts(): void {
  try {
    ensureStorageDir();
    fs.writeFileSync(
      RECEIPTS_PATH,
      JSON.stringify(Array.from(receipts.values()), replacer),
      "utf8"
    );
  } catch (err) {
    console.warn("[taskStore] Failed to persist receipts:", err);
  }
}

export function persistReceiptOutputs(): void {
  try {
    ensureStorageDir();
    fs.writeFileSync(
      RECEIPT_OUTPUTS_PATH,
      JSON.stringify(Array.from(receiptOutputs.entries()), replacer),
      "utf8"
    );
  } catch (err) {
    console.warn("[taskStore] Failed to persist receipt outputs:", err);
  }
}

// Load persisted tasks on startup (runs once when module is first imported).
// Mark stale "running" tasks as "failed" — the pipeline was interrupted.
(function loadTasks(): void {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return;
    const raw = fs.readFileSync(PERSIST_PATH, "utf8");
    const arr = JSON.parse(raw, reviver) as Task[];
    let staleCount = 0;
    for (const t of arr) {
      if (t.status === "running") {
        t.status = "failed";
        t.completedAt = new Date();
        staleCount++;
      }
      tasks.set(t.id, t);
    }
    console.log(`[taskStore] Loaded ${arr.length} persisted task(s)${staleCount > 0 ? ` (${staleCount} stale running → failed)` : ""}`);
  } catch (err) {
    console.warn("[taskStore] Could not load persisted tasks:", err);
  }
})();

(function loadReceipts(): void {
  try {
    if (!fs.existsSync(RECEIPTS_PATH)) return;
    const raw = fs.readFileSync(RECEIPTS_PATH, "utf8");
    const arr = JSON.parse(raw, reviver) as RunReceipt[];
    for (const receipt of arr) {
      receipts.set(receipt.runId, receipt);
      if (receipt.taskId) receipts.set(receipt.taskId, receipt);
    }
    console.log(`[taskStore] Loaded ${arr.length} persisted receipt(s)`);
  } catch (err) {
    console.warn("[taskStore] Could not load persisted receipts:", err);
  }
})();

(function loadReceiptOutputs(): void {
  try {
    if (!fs.existsSync(RECEIPT_OUTPUTS_PATH)) return;
    const raw = fs.readFileSync(RECEIPT_OUTPUTS_PATH, "utf8");
    const arr = JSON.parse(raw, reviver) as Array<[string, string]>;
    for (const [id, output] of arr) {
      receiptOutputs.set(id, output);
    }
    console.log(`[taskStore] Loaded ${arr.length} persisted receipt output(s)`);
  } catch (err) {
    console.warn("[taskStore] Could not load persisted receipt outputs:", err);
  }
})();
