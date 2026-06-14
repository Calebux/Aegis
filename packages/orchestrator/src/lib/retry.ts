/**
 * Retry utility with exponential backoff.
 *
 * Retries on 5xx, 429, and network errors. Never retries Stellar
 * submitTransaction() calls (not idempotent — double-spend risk).
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Label for log messages */
  label?: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function isRetryableError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network errors
  const msg = String(err);
  return (
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("UND_ERR_CONNECT_TIMEOUT") ||
    msg.includes("fetch failed")
  );
}

/**
 * Wrapper around global `fetch` that retries on transient failures.
 * Uses exponential backoff with jitter.
 */
export async function fetchWithRetry(
  url: string | URL | Request,
  init?: RequestInit,
  opts?: RetryOptions
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 200;
  const label = opts?.label ?? "fetch";

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, init);

      if (resp.ok || !RETRYABLE_STATUS.has(resp.status) || attempt === maxAttempts) {
        return resp;
      }

      console.warn(
        `[${label}] Attempt ${attempt}/${maxAttempts} got ${resp.status} — retrying…`
      );
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      if (!isRetryableError(err) || attempt === maxAttempts) {
        throw err;
      }
      console.warn(
        `[${label}] Attempt ${attempt}/${maxAttempts} failed: ${String(err)} — retrying…`
      );
      lastError = err;
    }

    // Exponential backoff with jitter
    const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError;
}

/**
 * Retry any async operation (not just fetch). Useful for wrapping SDK calls
 * like Linkup's client.search().
 *
 * IMPORTANT: Do NOT use this for Stellar submitTransaction() — it is not
 * idempotent and retrying risks double-spend.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 200;
  const label = opts?.label ?? "operation";

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) throw err;
      console.warn(
        `[${label}] Attempt ${attempt}/${maxAttempts} failed: ${String(err)} — retrying…`
      );
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
