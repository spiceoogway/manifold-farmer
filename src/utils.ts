/**
 * Retry an async operation with exponential backoff.
 * Retries on any thrown error. Does not retry on HTTP 4xx (client errors)
 * since those are permanent failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry 4xx errors (auth failures, bad requests, etc.)
      const msg = err instanceof Error ? err.message : String(err);
      if (/\b4\d\d\b/.test(msg)) throw err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
