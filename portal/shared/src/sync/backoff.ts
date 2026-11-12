// Retry with backoff (docs/INTEGRATIONS.md, sections 1 and 3.3). Sheets, Docs and Drive answer
// an exceeded quota with 429, Drive also with 403 and a rate-limit reason, and all three ask for
// the same wait: two to the power of the attempt in seconds, plus up to a second of random
// jitter, capped. A request is tried a bounded number of times inside a job, and when those
// attempts are spent the job itself is tried again later, with the same rule on a longer scale.

/** The answers of a Google interface that are worth trying again. */
export const RETRYABLE_STATUSES = [429, 500, 502, 503, 504] as const;

/** The reasons with which Drive marks a 403 as a rate limit rather than a refusal. */
export const RATE_LIMIT_REASONS = ["rateLimitExceeded", "userRateLimitExceeded"] as const;

export function isRetryable(status: number, reason: string | null): boolean {
  if ((RETRYABLE_STATUSES as readonly number[]).includes(status)) return true;
  return status === 403 && reason !== null && (RATE_LIMIT_REASONS as readonly string[]).includes(reason);
}

export interface BackoffPolicy {
  /** The wait before the first retry, without jitter. The vendor pages use one second. */
  readonly baseMs: number;
  /** The longest wait, without jitter. The vendor pages cap it at 32 or 64 seconds. */
  readonly capMs: number;
  /** The most random jitter added to a wait. The vendor pages use one second. */
  readonly jitterMs: number;
  /** The most attempts, the first included. */
  readonly maxAttempts: number;
}

/** The policy of a request inside a job, as the vendor pages prescribe it. */
export const REQUEST_BACKOFF: BackoffPolicy = { baseMs: 1_000, capMs: 32_000, jitterMs: 1_000, maxAttempts: 5 };

/** The policy of a whole job that failed: retried by the queue, then dead-lettered. */
export const JOB_BACKOFF: BackoffPolicy = { baseMs: 60_000, capMs: 3_600_000, jitterMs: 30_000, maxAttempts: 6 };

/**
 * The wait before the retry that follows attempt `attempt` (1 for the first attempt), in
 * milliseconds. `random` is a number from 0 inclusive to 1 exclusive, injected so that tests
 * are exact. A server that names its own wait (Retry-After) is respected when it asks for more.
 */
export function backoffDelayMs(
  policy: BackoffPolicy,
  attempt: number,
  random: number,
  retryAfterMs: number | null = null,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError("An attempt is counted from 1.");
  const exponential = Math.min(policy.capMs, policy.baseMs * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.min(Math.max(random, 0), 0.999_999) * policy.jitterMs);
  return Math.max(exponential + jitter, retryAfterMs ?? 0);
}

/** Whether another attempt follows attempt `attempt`. */
export function hasAttemptLeft(policy: BackoffPolicy, attempt: number): boolean {
  return attempt < policy.maxAttempts;
}
