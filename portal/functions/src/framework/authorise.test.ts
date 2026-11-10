// Fixtures are synthetic: fictitious accounts on the example.org domain.
import type { CallableContract } from "@eegml/shared";
import { emptyAccess, publicErrorReason, resolveAccess, z } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { requireCapability, requireSecondFactor, requireVerifiedEmail, secondFactorSatisfied } from "./authorise";
import { type IncomingCall, runCallable, secondFactorVerifiedIn } from "./callable";
import type { AuthenticatedContext } from "./context";
import { AppError } from "./errors";

const administratorAccess = resolveAccess({
  uid: "uid-admin",
  now: new Date("2026-01-02T03:04:05Z"),
  user: { status: "active", mfaEnrolled: true },
  personId: null,
  sessionsValidAfter: null,
  roleAssignments: [
    {
      uid: "uid-admin",
      role: "programme_admin",
      scopeType: "programme",
      scopeId: "eegmanylabs",
      status: "active",
      expiresAt: null,
    },
  ],
  capabilityGrants: [],
  roleCapabilities: [],
  recordGrants: [],
  groupKeys: [],
  confirmedReplicationIds: [],
});
const coordinatorAccess = resolveAccess({
  uid: "uid-coordinator",
  now: new Date("2026-01-02T03:04:05Z"),
  user: { status: "active", mfaEnrolled: false },
  personId: null,
  sessionsValidAfter: null,
  roleAssignments: [
    {
      uid: "uid-coordinator",
      role: "lab_coordinator",
      scopeType: "laboratory",
      scopeId: "lab-a",
      status: "active",
      expiresAt: null,
    },
  ],
  capabilityGrants: [],
  roleCapabilities: [],
  recordGrants: [],
  groupKeys: [],
  confirmedReplicationIds: [],
});

const thrownBy = (act: () => void): AppError => {
  try {
    act();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Nothing was thrown.");
};

describe("the second factor of a call", () => {
  it("is read from the claim that Firebase Authentication sets once a factor was verified", () => {
    expect(secondFactorVerifiedIn({ firebase: { sign_in_second_factor: "totp" } })).toBe(true);
    expect(secondFactorVerifiedIn({ firebase: { sign_in_second_factor: "phone" } })).toBe(true);
    for (const token of [
      undefined,
      {},
      { firebase: {} },
      { firebase: { sign_in_second_factor: "" } },
      { firebase: { sign_in_second_factor: true } },
    ]) {
      expect(secondFactorVerifiedIn(token)).toBe(false);
    }
  });

  it("reaches the handler in the context", async () => {
    const contract = {
      name: "probe",
      input: z.strictObject({}),
      output: z.strictObject({ factor: z.boolean() }),
    } as const satisfies CallableContract;
    const definition = {
      handler: async (_input: object, context: AuthenticatedContext) => ({ factor: context.secondFactorVerified }),
    };
    const dependencies = {
      db: {} as Firestore,
      clock: { now: () => new Date() },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      readAccess: async () => null,
    };
    const call = (firebase?: { sign_in_second_factor?: unknown }): IncomingCall => ({
      data: {},
      auth: {
        uid: "uid-caller",
        token: { email: "caller.account@example.org", email_verified: true, ...(firebase ? { firebase } : {}) },
      },
    });
    expect(await runCallable(contract, definition, call({ sign_in_second_factor: "totp" }), dependencies)).toEqual({
      factor: true,
    });
    expect(await runCallable(contract, definition, call({}), dependencies)).toEqual({ factor: false });
    expect(await runCallable(contract, definition, call(), dependencies)).toEqual({ factor: false });
  });

  it("is satisfied where the access document requires none, and where the session presents it", () => {
    expect(secondFactorSatisfied({ secondFactorVerified: false }, coordinatorAccess)).toBe(true);
    expect(secondFactorSatisfied({ secondFactorVerified: false }, administratorAccess)).toBe(false);
    expect(secondFactorSatisfied({ secondFactorVerified: true }, administratorAccess)).toBe(true);
  });

  it("is asked for with a message that says what to do, and a reason the interface can act on", () => {
    const refused = thrownBy(() => requireSecondFactor({ secondFactorVerified: false }, administratorAccess));
    expect(refused.code).toBe("failed-precondition");
    expect(refused.publicMessage).toBe(
      "This action needs your second factor. Sign out, sign in again and complete the second step.",
    );
    expect(refused.reason).toBe("secondFactorRequired");
    expect(() => requireSecondFactor({ secondFactorVerified: true }, administratorAccess)).not.toThrow();
  });

  it("travels to the browser in the details of the error, beside the mark of a public message", async () => {
    const contract = {
      name: "probe",
      input: z.strictObject({}),
      output: z.strictObject({}),
    } as const satisfies CallableContract;
    const definition = {
      handler: async () => {
        throw new AppError("failed-precondition", "A message for the person.", "secondFactorRequired");
      },
    };
    const dependencies = {
      db: {} as Firestore,
      clock: { now: () => new Date() },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      readAccess: async () => null,
    };
    const call: IncomingCall = { data: {}, auth: { uid: "uid-caller", token: {} } };
    const failure = await runCallable(contract, definition, call, dependencies).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "failed-precondition",
      message: "A message for the person.",
      details: { public: true, reason: "secondFactorRequired" },
    });
    expect(publicErrorReason((failure as { details: unknown }).details)).toBe("secondFactorRequired");
    expect(publicErrorReason({ public: true })).toBeNull();
    expect(publicErrorReason({ reason: "secondFactorRequired" })).toBeNull();
    expect(publicErrorReason({ public: true, reason: "somethingElse" })).toBeNull();
  });
});

describe("a capability in a call", () => {
  it("is held in the scope of the role, and nowhere else", () => {
    const context = { secondFactorVerified: false };
    expect(() => requireCapability(context, coordinatorAccess, "labs.manage", { laboratoryId: "lab-a" })).not.toThrow();
    for (const scope of [{ laboratoryId: "lab-b" }, "programme"] as const) {
      const refused = thrownBy(() => requireCapability(context, coordinatorAccess, "labs.manage", scope));
      expect(refused.code).toBe("permission-denied");
      expect(refused.publicMessage).toBe("Your account is not allowed to do this.");
    }
    expect(thrownBy(() => requireCapability(context, coordinatorAccess, "roles.manage", "programme")).code).toBe(
      "permission-denied",
    );
    expect(thrownBy(() => requireCapability(context, emptyAccess(), "directory.read", "programme")).code).toBe(
      "permission-denied",
    );
  });

  it("needs the second factor of an account whose access document requires one, before anything else", () => {
    expect(() =>
      requireCapability({ secondFactorVerified: true }, administratorAccess, "roles.manage", "programme"),
    ).not.toThrow();
    const refused = thrownBy(() =>
      requireCapability({ secondFactorVerified: false }, administratorAccess, "roles.manage", "programme"),
    );
    expect(refused.reason).toBe("secondFactorRequired");
  });

  it("is refused to a suspended account whatever its document still lists", () => {
    const suspended = { ...administratorAccess, suspended: true, secondFactorRequired: false };
    expect(
      thrownBy(() => requireCapability({ secondFactorVerified: true }, suspended, "roles.manage", "programme")).code,
    ).toBe("permission-denied");
  });
});

describe("the verified address of a caller", () => {
  const context = (verifiedEmail: string | null) => ({ verifiedEmail }) as AuthenticatedContext;

  it("is given in canonical form, and its absence is refused with a reason", () => {
    expect(requireVerifiedEmail(context("  Caller.Account@Example.ORG "))).toBe("caller.account@example.org");
    const refused = thrownBy(() => requireVerifiedEmail(context(null)));
    expect(refused.code).toBe("failed-precondition");
    expect(refused.reason).toBe("emailNotVerified");
    expect(refused.publicMessage).toBe("A verified email address is needed to use the portal.");
  });
});
