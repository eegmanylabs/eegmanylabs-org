// Fixtures are synthetic: fictitious accounts on the example.org domain.
import type { CallableContract } from "@eegml/shared";
import { PUBLIC_ERROR_DETAILS, z } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { describe, expect, it, vi } from "vitest";
import {
  type CallableDependencies,
  type CallerAccess,
  type IncomingCall,
  runCallable,
  runningInEmulator,
} from "./callable";
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  AppError,
  INTERNAL_ERROR_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  SESSION_ENDED_MESSAGE,
  SIGN_IN_REQUIRED_MESSAGE,
} from "./errors";

const echoContract = {
  name: "echo",
  input: z.strictObject({ text: z.string().min(1) }),
  output: z.strictObject({ text: z.string(), uid: z.string().nullable() }),
} as const satisfies CallableContract;

/** The pipeline's dependencies, with the caller's access document as the test wants it. */
function dependencies(
  access: CallerAccess | null | Error = null,
): CallableDependencies & { logged: { level: string; message: string; fields: unknown }[] } {
  const logged: { level: string; message: string; fields: unknown }[] = [];
  const log = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    logged.push({ level, message, fields });
  };
  return {
    // The pipeline hands the Firestore handle to the handler and never uses it itself.
    db: {} as Firestore,
    clock: { now: () => new Date("2026-01-02T03:04:05Z") },
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
    readAccess: async () => {
      if (access instanceof Error) throw access;
      return access;
    },
    logged,
  };
}

const SIGNED_IN_AT = Date.parse("2026-01-01T00:00:00Z") / 1000;

const signedIn: IncomingCall["auth"] = {
  uid: "uid-caller",
  token: { email: "Caller.Account@example.org", email_verified: true, auth_time: SIGNED_IN_AT },
};

const echo = {
  handler: async (input: { text: string }, context: { uid: string | null }) => ({ text: input.text, uid: context.uid }),
};

/** A stand-in with the part of a Firestore timestamp the pipeline reads. */
function boundary(iso: string): NonNullable<CallerAccess["sessionsValidAfter"]> {
  const date = new Date(iso);
  return { seconds: date.getTime() / 1000, nanoseconds: 0, toDate: () => date, toMillis: () => date.getTime() };
}

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
    expect(error.details).toEqual(PUBLIC_ERROR_DETAILS);
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

  it("gives the handler the name from the token as cleaned, self-asserted text", async () => {
    const seen: (string | null)[] = [];
    const definition = {
      handler: async (input: { text: string }, context: { selfAssertedName: string | null; uid: string }) => {
        seen.push(context.selfAssertedName);
        return { text: input.text, uid: context.uid };
      },
    };
    const callWithName = (name: unknown) =>
      runCallable(
        echoContract,
        definition,
        { data: { text: "a" }, auth: { uid: "uid-caller", token: { ...signedIn.token, name } } },
        dependencies(),
      );
    await callWithName("  Synthetic \n Person\u0000 ");
    await callWithName("x".repeat(5000));
    await callWithName("   ");
    await callWithName({ injected: true });
    await callWithName(undefined);
    expect(seen[0]).toBe("Synthetic Person");
    expect(seen[1]).toHaveLength(200);
    expect(seen.slice(2)).toEqual([null, null, null]);
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
    // The mark that tells the web client this message was written for the person.
    expect(error.details).toEqual(PUBLIC_ERROR_DETAILS);
  });

  it("treats an HttpsError that the handler did not raise through AppError as a fault", async () => {
    const deps = dependencies();
    const error = await rejection(
      runCallable(
        echoContract,
        {
          handler: async () => {
            // What a library or a nested call might throw: a client-facing code with its own text.
            throw new HttpsError("permission-denied", "Forbidden: caller lacks roles/datastore.user", { table: "x" });
          },
        },
        { data: { text: "a" }, auth: signedIn },
        deps,
      ),
    );
    expect(error.code).toBe("internal");
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(error.details).toEqual(PUBLIC_ERROR_DETAILS);
    expect(JSON.stringify(deps.logged)).toContain("roles/datastore.user");
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
    expect(error.details).toEqual(PUBLIC_ERROR_DETAILS);
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

describe("the caller's standing", () => {
  const call = { data: { text: "hello" }, auth: signedIn };

  it("lets an account through that has no access document yet", async () => {
    expect(await runCallable(echoContract, echo, call, dependencies(null))).toEqual({
      text: "hello",
      uid: "uid-caller",
    });
  });

  it("lets an account through that is not suspended and has no session boundary", async () => {
    const access = { suspended: false, sessionsValidAfter: null };
    expect(await runCallable(echoContract, echo, call, dependencies(access))).toMatchObject({ uid: "uid-caller" });
  });

  it("refuses a suspended account before the handler runs, with a message that names the next step", async () => {
    const handler = vi.fn();
    const deps = dependencies({ suspended: true, sessionsValidAfter: null });
    const error = await rejection(runCallable(echoContract, { handler }, call, deps));
    expect(error.code).toBe("permission-denied");
    expect(error.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
    expect(error.message).toContain("Contact a programme administrator");
    expect(error.details).toEqual(PUBLIC_ERROR_DETAILS);
    expect(handler).not.toHaveBeenCalled();
    expect(deps.logged).toContainEqual({
      level: "warn",
      message: "callable refused",
      fields: { function: "echo", uid: "uid-caller", standing: "suspended" },
    });
  });

  it("refuses a suspended account even when its input is invalid, so nothing about the function leaks", async () => {
    const error = await rejection(
      runCallable(
        echoContract,
        echo,
        { data: { text: "" }, auth: signedIn },
        dependencies({ suspended: true, sessionsValidAfter: null }),
      ),
    );
    expect(error.code).toBe("permission-denied");
  });

  it("refuses a session that began before the account's sessions were ended", async () => {
    const handler = vi.fn();
    const access = { suspended: false, sessionsValidAfter: boundary("2026-01-01T00:00:01Z") };
    const error = await rejection(runCallable(echoContract, { handler }, call, dependencies(access)));
    expect(error.code).toBe("unauthenticated");
    expect(error.message).toBe(SESSION_ENDED_MESSAGE);
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts a session that began after the account's sessions were ended", async () => {
    const access = { suspended: false, sessionsValidAfter: boundary("2025-12-31T23:59:59Z") };
    expect(await runCallable(echoContract, echo, call, dependencies(access))).toMatchObject({ uid: "uid-caller" });
  });

  it("refuses when the access document cannot be read, and does not run the handler", async () => {
    const handler = vi.fn();
    const deps = dependencies(new Error("deadline exceeded reading access/uid-caller"));
    const error = await rejection(runCallable(echoContract, { handler }, call, deps));
    expect(error.code).toBe("internal");
    expect(error.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(handler).not.toHaveBeenCalled();
    expect(deps.logged.filter((entry) => entry.level === "error")).toHaveLength(1);
  });

  it("lets a suspended account through only where the definition says any standing will do", async () => {
    const result = await runCallable(
      echoContract,
      { ...echo, callerStanding: "any" },
      call,
      dependencies({ suspended: true, sessionsValidAfter: null }),
    );
    expect(result).toEqual({ text: "hello", uid: "uid-caller" });
  });

  it("does not look for an access document when nobody is signed in", async () => {
    const deps = dependencies(new Error("must not be read"));
    const result = await runCallable(echoContract, { ...echo, auth: "optional" }, { data: { text: "hello" } }, deps);
    expect(result).toEqual({ text: "hello", uid: null });
  });
});

describe("runningInEmulator", () => {
  it("is true only when the Functions emulator says so", () => {
    expect(runningInEmulator({ FUNCTIONS_EMULATOR: "true" })).toBe(true);
    expect(runningInEmulator({})).toBe(false);
    expect(runningInEmulator({ FUNCTIONS_EMULATOR: "false" })).toBe(false);
  });
});

describe("defineCallable and the origins that may call", () => {
  /** A fresh copy of the modules, as a newly started functions process has. */
  async function defined(emulator: boolean) {
    vi.resetModules();
    vi.stubEnv("FUNCTIONS_EMULATOR", emulator ? "true" : "");
    try {
      const { defineCallable, PORTAL_ORIGINS_PARAMETER } = await import("./callable");
      const { declaredParams } = await import("firebase-functions/params");
      // The Firebase package is loaded once for the whole file, so its list outlives a test.
      declaredParams.length = 0;
      const callable = defineCallable(echoContract, { handler: async (input) => ({ text: input.text, uid: null }) });
      const declared = declaredParams.map((parameter) => parameter.name);
      return { callable, declared, PORTAL_ORIGINS_PARAMETER };
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it("declares the parameters of the origins and of App Check for a deployment, in London, as its own account", async () => {
    const { callable, declared, PORTAL_ORIGINS_PARAMETER } = await defined(false);
    expect(PORTAL_ORIGINS_PARAMETER).toBe("PORTAL_ORIGINS");
    expect(declared).toEqual(["ENFORCE_APP_CHECK", "PORTAL_ORIGINS"]);
    expect(callable.__endpoint.region).toEqual(["europe-west2"]);
    expect(callable.__endpoint.serviceAccountEmail).toBe("eegml-functions@");
  });

  it("refuses a request without an App Check token once the parameter says so, before the handler runs", async () => {
    const { callable } = await defined(false);
    vi.stubEnv("ENFORCE_APP_CHECK", "true");
    try {
      const refused = await Promise.resolve()
        .then(() => callable.run({ data: { text: "hello" }, rawRequest: {} as never, acceptsStreaming: false }))
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refused).toMatchObject({ code: "failed-precondition" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("declares it once, however many functions are defined", async () => {
    vi.resetModules();
    vi.stubEnv("FUNCTIONS_EMULATOR", "");
    try {
      const { defineCallable } = await import("./callable");
      const { declaredParams } = await import("firebase-functions/params");
      declaredParams.length = 0;
      const handler = async () => ({ text: "", uid: null });
      defineCallable(echoContract, { handler });
      defineCallable({ ...echoContract, name: "echoAgain" }, { handler });
      expect(declaredParams.map((parameter) => parameter.name)).toEqual(["ENFORCE_APP_CHECK", "PORTAL_ORIGINS"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("declares no parameter in the emulator, which accepts every local origin", async () => {
    const { declared } = await defined(true);
    expect(declared).toEqual([]);
  });
});
