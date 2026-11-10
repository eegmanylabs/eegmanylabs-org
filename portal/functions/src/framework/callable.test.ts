import type { CallableContract } from "@eegml/shared";
import { z } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { describe, expect, it, vi } from "vitest";
import { type CallableDependencies, type IncomingCall, runCallable, runningInEmulator } from "./callable";
import { AppError, INTERNAL_ERROR_MESSAGE, INVALID_REQUEST_MESSAGE, SIGN_IN_REQUIRED_MESSAGE } from "./errors";

const echoContract = {
  name: "echo",
  input: z.strictObject({ text: z.string().min(1) }),
  output: z.strictObject({ text: z.string(), uid: z.string().nullable() }),
} as const satisfies CallableContract;

function dependencies(): CallableDependencies & { logged: { level: string; message: string; fields: unknown }[] } {
  const logged: { level: string; message: string; fields: unknown }[] = [];
  const log = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    logged.push({ level, message, fields });
  };
  return {
    // The pipeline hands the Firestore handle to the handler and never uses it itself.
    db: {} as Firestore,
    clock: { now: () => new Date("2026-01-02T03:04:05Z") },
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
    logged,
  };
}

const signedIn: IncomingCall["auth"] = {
  uid: "uid-caller",
  token: { email: "Caller.Account@example.org", email_verified: true },
};

async function rejection(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpsError) return error;
    throw error;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("runCallable", () => {
  it("runs the handler with the validated input and returns the validated output", async () => {
    const result = await runCallable(
      echoContract,
      { handler: async (input, context) => ({ text: input.text, uid: context.uid }) },
      { data: { text: "hello" }, auth: signedIn },
      dependencies(),
    );
    expect(result).toEqual({ text: "hello", uid: "uid-caller" });
  });

  it("refuses a signed-out caller by default and does not run the handler", async () => {
    const handler = vi.fn();
    const error = await rejection(runCallable(echoContract, { handler }, { data: { text: "hello" } }, dependencies()));
    expect(error.code).toBe("unauthenticated");
    expect(error.message).toBe(SIGN_IN_REQUIRED_MESSAGE);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets a signed-out caller through when the function says authentication is optional", async () => {
    const result = await runCallable(
      echoContract,
      { auth: "optional", handler: async (input, context) => ({ text: input.text, uid: context.uid }) },
      { data: { text: "hello" } },
      dependencies(),
    );
    expect(result).toEqual({ text: "hello", uid: null });
  });

  it("rejects input that does not match the contract, without logging its content", async () => {
    const handler = vi.fn();
    const deps = dependencies();
    const error = await rejection(
      runCallable(echoContract, { handler }, { data: { text: "", secret: "do-not-log-me" }, auth: signedIn }, deps),
    );
    expect(error.code).toBe("invalid-argument");
    expect(error.message).toBe(INVALID_REQUEST_MESSAGE);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.logged)).not.toContain("do-not-log-me");
  });

  it("gives the handler the email address only when the provider has verified it", async () => {
    const seen: (string | null)[] = [];
    const definition = {
      handler: async (input: { text: string }, context: { verifiedEmail: string | null; uid: string }) => {
        seen.push(context.verifiedEmail);
        return { text: input.text, uid: context.uid };
      },
    };
    await runCallable(echoContract, definition, { data: { text: "a" }, auth: signedIn }, dependencies());
    await runCallable(
      echoContract,
      definition,
      {
        data: { text: "a" },
        auth: { uid: "uid-caller", token: { email: "unverified@example.org", email_verified: false } },
      },
      dependencies(),
    );
    expect(seen).toEqual(["Caller.Account@example.org", null]);
  });

  it("gives the handler the clock and the logger it was started with", async () => {
    const deps = dependencies();
    let now: Date | undefined;
    await runCallable(
      echoContract,
      {
        handler: async (input, context) => {
          now = context.clock.now();
          context.logger.info("handled");
          return { text: input.text, uid: context.uid };
        },
      },
      { data: { text: "a" }, auth: signedIn },
      deps,
    );
    expect(now?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(deps.logged).toContainEqual({ level: "info", message: "handled", fields: undefined });
  });

  it("passes on an error the handler raised on purpose, with its code and message", async () => {
    const error = await rejection(
      runCallable(
        echoContract,
        {
          handler: async () => {
            throw new AppError("failed-precondition", "A verified email address is needed.");
          },
        },
        { data: { text: "a" }, auth: signedIn },
        dependencies(),
      ),
    );
    expect(error.code).toBe("failed-precondition");
    expect(error.message).toBe("A verified email address is needed.");
  });

  it("hides the detail of an unexpected error from the caller and logs it", async () => {
    const deps = dependencies();
    const error = await rejection(
      runCallable(
        echoContract,
        {
          handler: async () => {
            throw new Error("connection to 10.0.0.7 refused: password=hunter2");
          },
        },
        { data: { text: "a" }, auth: signedIn },
        deps,
      ),
    );
    expect(error.code).toBe("internal");
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(error.details).toBeUndefined();
    expect(deps.logged.filter((entry) => entry.level === "error")).toHaveLength(1);
    expect(JSON.stringify(deps.logged)).toContain("hunter2");
  });

  it("treats a result that does not match the contract as an internal error", async () => {
    const deps = dependencies();
    const error = await rejection(
      runCallable(
        echoContract,
        // A handler that returns more than the contract allows.
        { handler: async () => ({ text: "a", uid: null, extra: "leak" }) as never },
        { data: { text: "a" }, auth: signedIn },
        deps,
      ),
    );
    expect(error.code).toBe("internal");
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(deps.logged)).not.toContain("leak");
  });
});

describe("runningInEmulator", () => {
  it("is true only when the Functions emulator says so", () => {
    expect(runningInEmulator({ FUNCTIONS_EMULATOR: "true" })).toBe(true);
    expect(runningInEmulator({})).toBe(false);
    expect(runningInEmulator({ FUNCTIONS_EMULATOR: "false" })).toBe(false);
  });
});
