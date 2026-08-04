/**
 * Retry policy shared by every platform HTTP client. Kept as small decisions
 * rather than a wrapper function so each client keeps its own request loop
 * (LinkedIn's restli encoding and Google's error unwrapping have nothing else
 * in common) while agreeing on when and how long to back off.
 */

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Attempts after the first. 4 retries covers a rate-limit burst without stalling a CLI run. */
export const DEFAULT_MAX_RETRIES = 4;

/** Rate limited or a server fault: worth retrying. Client errors never are. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * How long to wait before the next attempt. Honors a `Retry-After` header when
 * the server sends a sane one, else exponential backoff from 1s.
 */
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return 2 ** attempt * 1000;
}

/** Backoff for a transport-level failure (no response at all), which starts faster. */
export function transportRetryDelayMs(attempt: number): number {
  return 2 ** attempt * 500;
}
