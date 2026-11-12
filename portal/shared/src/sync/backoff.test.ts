// Backoff as the vendor pages prescribe it, with injected randomness so that every wait is exact.
import { describe, expect, it } from "vitest";
import { backoffDelayMs, hasAttemptLeft, isRetryable, JOB_BACKOFF, REQUEST_BACKOFF } from "./backoff";

describe("backoff", () => {
  it("doubles from one second, adds up to a second of jitter, and stops at the cap", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => backoffDelayMs(REQUEST_BACKOFF, attempt, 0))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 32_000,
    ]);
    expect(backoffDelayMs(REQUEST_BACKOFF, 1, 0.5)).toBe(1_500);
    expect(backoffDelayMs(REQUEST_BACKOFF, 1, 1)).toBe(1_999);
    expect(backoffDelayMs(REQUEST_BACKOFF, 1, -1)).toBe(1_000);
  });

  it("waits as long as the server asks when it asks for more", () => {
    expect(backoffDelayMs(REQUEST_BACKOFF, 1, 0, 30_000)).toBe(30_000);
    expect(backoffDelayMs(REQUEST_BACKOFF, 3, 0, 10)).toBe(4_000);
  });

  it("counts attempts from one and bounds them", () => {
    expect(() => backoffDelayMs(REQUEST_BACKOFF, 0, 0)).toThrow(RangeError);
    expect(hasAttemptLeft(REQUEST_BACKOFF, 4)).toBe(true);
    expect(hasAttemptLeft(REQUEST_BACKOFF, 5)).toBe(false);
    expect(backoffDelayMs(JOB_BACKOFF, 10, 0)).toBe(JOB_BACKOFF.capMs);
  });

  it("retries quotas and server errors, and never a refusal or a missing file", () => {
    expect([429, 500, 502, 503, 504].every((status) => isRetryable(status, null))).toBe(true);
    expect(isRetryable(403, "userRateLimitExceeded")).toBe(true);
    expect(isRetryable(403, "rateLimitExceeded")).toBe(true);
    expect(isRetryable(403, "forbidden")).toBe(false);
    expect(isRetryable(403, null)).toBe(false);
    expect(isRetryable(404, null)).toBe(false);
    expect(isRetryable(400, null)).toBe(false);
  });
});
