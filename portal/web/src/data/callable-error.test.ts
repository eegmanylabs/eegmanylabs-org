import { PUBLIC_ERROR_DETAILS } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { CallableError, GENERAL_MESSAGES, NO_ANSWER_MESSAGE, toCallableError } from "./callable-error";

/** An error in the shape the Functions SDK rejects with. */
function sdkError(code: string, message: string, details?: unknown): Error {
  return Object.assign(new Error(message), { code, details });
}

describe("toCallableError", () => {
  it("shows the server's message when the portal's own functions marked it as written for the person", () => {
    const error = toCallableError(
      sdkError(
        "functions/permission-denied",
        "This account has been suspended. Contact a programme administrator. [403]",
        PUBLIC_ERROR_DETAILS,
      ),
    );
    expect(error).toBeInstanceOf(CallableError);
    expect(error.code).toBe("permission-denied");
    expect(error.message).toBe("This account has been suspended. Contact a programme administrator.");
  });

  it("keeps the reason a public error states, so that the interface can offer the next step", () => {
    const error = toCallableError(
      sdkError("functions/failed-precondition", "Sign in again with your second factor. [400]", {
        public: true,
        reason: "secondFactorRequired",
      }),
    );
    expect(error.reason).toBe("secondFactorRequired");
    // A reason the registry does not know, or one on an error that is not public, is dropped.
    expect(
      toCallableError(sdkError("functions/failed-precondition", "x", { public: true, reason: "other" })).reason,
    ).toBe(null);
    expect(toCallableError(sdkError("functions/failed-precondition", "x", { reason: "notLinked" })).reason).toBe(null);
  });

  it.each([
    ["functions/permission-denied", "Forbidden", "permission-denied"],
    ["functions/not-found", "Not Found", "not-found"],
    ["functions/invalid-argument", "Bad Request", "invalid-argument"],
    ["functions/resource-exhausted", "Too Many Requests", "resource-exhausted"],
    ["functions/failed-precondition", "Precondition Failed", "failed-precondition"],
    ["functions/already-exists", "Conflict", "already-exists"],
  ] as const)("never shows the text of %s when the platform produced it by itself", (sdkCode, platformText, code) => {
    for (const details of [undefined, null, {}, { public: false }, "public"]) {
      const error = toCallableError(sdkError(sdkCode, platformText, details));
      expect(error.code).toBe(code);
      expect(error.message).toBe(GENERAL_MESSAGES[code]);
      expect(error.message).not.toContain(platformText);
    }
  });

  it("says that a call the server did not answer in time may or may not have changed something", () => {
    const error = toCallableError(sdkError("functions/deadline-exceeded", "deadline-exceeded"));
    expect(error.code).toBe("unavailable");
    expect(error.message).toBe(NO_ANSWER_MESSAGE);
  });

  it("uses the general text when a marked error carries no message", () => {
    const error = toCallableError(sdkError("functions/not-found", " [404]", PUBLIC_ERROR_DETAILS));
    expect(error.message).toBe(GENERAL_MESSAGES["not-found"]);
  });

  it.each([
    ["functions/unavailable", "unavailable"],
    ["functions/deadline-exceeded", "unavailable"],
    ["functions/unauthenticated", "unauthenticated"],
    ["functions/internal", "internal"],
    ["functions/data-loss", "internal"],
    ["something/else", "internal"],
  ] as const)("maps %s to %s", (sdkCode, code) => {
    expect(toCallableError(sdkError(sdkCode, "detail from somewhere")).code).toBe(code);
  });

  it.each([undefined, null, "a string", new Error("no code"), { code: 42 }])(
    "treats %j, which is no SDK error, as an internal fault",
    (thrown) => {
      const error = toCallableError(thrown);
      expect(error.code).toBe("internal");
      expect(error.message).toBe(GENERAL_MESSAGES.internal);
    },
  );
});
