/**
 * In-memory task store for the Aegis dashboard, with file-based persistence.
 *
 * Tasks are serialized to .aegis-tasks.json in the project root on each state
 * change and reloaded automatically when the module is first imported.
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import type { Task } from "@aegis/shared";

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

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const PERSIST_PATH = path.join(process.cwd(), ".aegis-tasks.json");

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

/** Write completed/failed tasks to disk. */
export function persistTasks(): void {
  try {
    const toSave = Array.from(tasks.values()).filter(
      (t) => t.status === "completed" || t.status === "failed"
    );
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(toSave, replacer), "utf8");
  } catch (err) {
    console.warn("[taskStore] Failed to persist tasks:", err);
  }
}

// Load persisted tasks on startup (runs once when module is first imported).
(function loadTasks(): void {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return;
    const raw = fs.readFileSync(PERSIST_PATH, "utf8");
    const arr = JSON.parse(raw, reviver) as Task[];
    for (const t of arr) {
      tasks.set(t.id, t);
    }
    console.log(`[taskStore] Loaded ${arr.length} persisted task(s)`);
  } catch (err) {
    console.warn("[taskStore] Could not load persisted tasks:", err);
  }
})();
