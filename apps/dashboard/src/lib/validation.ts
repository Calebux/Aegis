/**
 * Input validation and rate limiting for Cal-AgentKit API routes.
 */

import { NextRequest } from "next/server";

// ── Input validation ──────────────────────────────────────────────────────────

const MAX_TASK_LENGTH = 4000;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function validateTaskInput(task: string): { valid: true } | { valid: false; error: string } {
  if (task.length > MAX_TASK_LENGTH) {
    return { valid: false, error: `Task exceeds maximum length of ${MAX_TASK_LENGTH} characters` };
  }
  if (CONTROL_CHAR_RE.test(task)) {
    return { valid: false, error: "Task contains invalid control characters" };
  }
  return { valid: true };
}

// ── Rate limiting (in-memory, per-IP) ─────────────────────────────────────────

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent memory leak from accumulated IPs
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, entry] of rateLimitMap) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) rateLimitMap.delete(ip);
  }
}, 60_000).unref?.();

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function checkRateLimit(ip: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let entry = rateLimitMap.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(ip, entry);
  }

  // Prune old timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= MAX_REQUESTS) {
    const oldest = entry.timestamps[0]!;
    const retryAfterMs = oldest + WINDOW_MS - now;
    return { allowed: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}
