/**
 * Per-agent timeout utility.
 *
 * Wraps any async operation in an AbortSignal-based timeout so a single
 * hung Linkup/Horizon/Soroban call cannot block the entire pipeline.
 */

export class AgentTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`[${label}] timed out after ${timeoutMs}ms`);
    this.name = "AgentTimeoutError";
  }
}

/**
 * Run `fn` with a timeout. If the operation exceeds `timeoutMs`, the
 * returned promise rejects with `AgentTimeoutError`.
 *
 * The AbortSignal is passed to `fn` so it can forward it to fetch() or
 * other signal-aware APIs.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await fn(controller.signal);
    return result;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AgentTimeoutError(label, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
