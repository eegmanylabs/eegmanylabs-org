// Retry inside a job (docs/INTEGRATIONS.md, sections 1 and 3.3): a throttled or failing request
// is tried again with exponential backoff and random jitter, a bounded number of times. When the
// attempts are spent the error goes up, the job fails, and the queue tries the whole job again
// later. The clock and the randomness are injected so that tests wait for nothing.
import { type BackoffPolicy, backoffDelayMs, hasAttemptLeft, isRetryable, REQUEST_BACKOFF } from "@eegml/shared";
import { ExternalServiceError } from "./types";

export interface RetryDependencies {
  sleep(milliseconds: number): Promise<void>;
  /** A number from 0 inclusive to 1 exclusive. */
  random(): number;
  readonly policy?: BackoffPolicy;
  /** Told of each retry, for the run's statistics. */
  onRetry?(attempt: number, error: ExternalServiceError, delayMs: number): void;
}

/** Whether an error is an answer of a Google interface that a retry may clear. */
export function isRetryableError(error: unknown): error is ExternalServiceError {
  return error instanceof ExternalServiceError && isRetryable(error.status, error.reason);
}

export async function withRetry<T>(call: () => Promise<T>, dependencies: RetryDependencies): Promise<T> {
  const policy = dependencies.policy ?? REQUEST_BACKOFF;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (!isRetryableError(error) || !hasAttemptLeft(policy, attempt)) throw error;
      const delay = backoffDelayMs(policy, attempt, dependencies.random(), error.retryAfterMs);
      dependencies.onRetry?.(attempt, error, delay);
      await dependencies.sleep(delay);
    }
  }
}

/** Wraps every method of an adapter in `withRetry`. */
export function retrying<T extends object>(adapter: T, dependencies: RetryDependencies): T {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        withRetry(() => (value as (...inner: unknown[]) => Promise<unknown>).apply(target, args), dependencies);
    },
  });
}
