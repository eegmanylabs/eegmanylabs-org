import { describe, expect, it } from "vitest";
import {
  factorOf,
  normaliseCode,
  SECOND_FACTOR_MESSAGES,
  SecondFactorError,
  secondFactorFailureOf,
} from "./second-factor-model";

describe("secondFactorFailureOf", () => {
  it.each([
    ["auth/invalid-verification-code", "invalid-code"],
    ["auth/totp-challenge-timeout", "expired"],
    ["auth/requires-recent-login", "requires-recent-login"],
    ["auth/operation-not-allowed", "unavailable"],
    ["auth/network-request-failed", "network"],
    ["auth/something-new", "unknown"],
  ] as const)("reads %s as %s", (code, reason) => {
    expect(secondFactorFailureOf(Object.assign(new Error("x"), { code }))).toBe(reason);
  });

  it("keeps the reason of a failure that has one already, and knows nothing of other values", () => {
    expect(secondFactorFailureOf(new SecondFactorError("expired"))).toBe("expired");
    expect(secondFactorFailureOf(null)).toBe("unknown");
    expect(secondFactorFailureOf("auth/invalid-verification-code")).toBe("unknown");
  });

  it("has a message for every reason that says what to do next", () => {
    for (const message of Object.values(SECOND_FACTOR_MESSAGES)) {
      expect(message).toMatch(/\.$/);
      expect(message).not.toContain("\u2014");
    }
  });
});

describe("normaliseCode", () => {
  it("accepts the digits an authenticator app shows, with the space some apps put in the middle", () => {
    expect(normaliseCode("123456")).toBe("123456");
    expect(normaliseCode(" 123 456 ")).toBe("123456");
    expect(normaliseCode("12345678", 8)).toBe("12345678");
  });

  it("refuses anything else", () => {
    for (const code of ["", "12345", "1234567", "12345a", "١٢٣٤٥٦"]) expect(normaliseCode(code)).toBeNull();
  });
});

describe("factorOf", () => {
  it("describes an enrolled factor without Firebase types", () => {
    expect(
      factorOf({ uid: "f1", displayName: "Phone", factorId: "totp", enrollmentTime: "Tue, 10 Nov 2026 10:00:00 GMT" }),
    ).toEqual({ uid: "f1", displayName: "Phone", factorId: "totp", enrolledAt: "2026-11-10T10:00:00.000Z" });
    expect(factorOf({ uid: "f2", factorId: "phone", enrollmentTime: "not a time" })).toEqual({
      uid: "f2",
      displayName: null,
      factorId: "phone",
      enrolledAt: null,
    });
  });
});
