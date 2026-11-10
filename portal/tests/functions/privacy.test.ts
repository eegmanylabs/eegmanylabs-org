// A test of what the functions leave behind: no email address and no special-category value
// in the audit trail, in a notification or in a log line.
//
// The functions run inside this process here, through the `run` method that firebase-functions
// gives a callable function, against the emulated database. That way the test holds the
// logger: every line that a function or the request pipeline logs is captured and scanned,
// beside every audit entry and every notification that was written.
// Fixtures are synthetic: fictitious accounts and people on the example.org domain, and
// placeholder terms for the special categories.
import {
  type CallableContract,
  type CallableInput,
  COLLECTIONS,
  claimProfileContract,
  DEMO_IDENTITY_HASH_KEY,
  getPersonDemographicsContract,
  IDENTITY_HASH_KEY_NAME,
  listAccountClaimsContract,
  requestAccessContract,
  requestLabClaimContract,
  resolveCorrectionRequestContract,
  reviewAccountClaimContract,
  reviewLabClaimContract,
  sessionStartContract,
  setCapabilityGrantContract,
  setPersonOrcidContract,
  setRoleAssignmentContract,
  setUserStatusContract,
  unlinkAccountClaimContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/https";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  type Caller,
  grantCapability,
  institution,
  laboratory,
  leaveNoTrace,
  memberEntry,
  person,
  settle,
  standard,
} from "./support";

const logged = vi.hoisted(() => [] as unknown[][]);

vi.mock("firebase-functions", async (original) => {
  const capture =
    (level: string) =>
    (...line: unknown[]) => {
      logged.push([level, ...line]);
    };
  return {
    ...(await original<typeof import("firebase-functions")>()),
    logger: {
      debug: capture("debug"),
      log: capture("log"),
      info: capture("info"),
      warn: capture("warn"),
      error: capture("error"),
      write: capture("write"),
    },
  };
});

const functions = await import("../../functions/src/index");
const { recordWrite } = await import("../../functions/src/triggers/audit");
const { rebuildAccess } = await import("../../functions/src/access/maintain");
/** The logger that the mock above put in the place of the logger of firebase-functions. */
const { logger: capturing } = await import("firebase-functions");

type Runnable = { run(request: CallableRequest<unknown>): unknown };

/** Runs a function inside this process, as the platform would hand it a verified request. */
async function run<C extends CallableContract>(
  caller: Caller | null,
  contract: C,
  data: CallableInput<C> | unknown,
): Promise<unknown> {
  const callable = (functions as unknown as Record<string, Runnable>)[contract.name];
  if (callable === undefined) throw new Error(`No function is exported as ${contract.name}.`);
  const request = {
    data,
    rawRequest: {},
    acceptsStreaming: false,
    ...(caller === null
      ? {}
      : {
          auth: {
            uid: caller.uid,
            token: {
              uid: caller.uid,
              email: caller.email,
              email_verified: caller.emailVerified ?? true,
              auth_time: Math.floor(Date.now() / 1000),
              firebase: caller.secondFactor === true ? { sign_in_second_factor: "totp" } : {},
            },
          },
        }),
  } as unknown as CallableRequest<unknown>;
  try {
    return await callable.run(request);
  } catch (error) {
    return error;
  }
}

/** Every address that the scenario uses, and every special-category value. None may be left behind. */
const ADDRESSES = [
  "claimant.one@example.org",
  "shared.address@example.org",
  "newcomer.account@example.org",
  "first.administrator@example.org",
  "reader.account@example.org",
  "uid-admin@example.org",
];
const DEMOGRAPHIC_VALUES = ["synthetic gender term Q", "synthetic ethnicity term Z", "self-described synthetic term"];

beforeAll(async () => {
  process.env[IDENTITY_HASH_KEY_NAME] = DEMO_IDENTITY_HASH_KEY;
  await leaveNoTrace();
});

afterAll(async () => {
  delete process.env[IDENTITY_HASH_KEY_NAME];
  await leaveNoTrace();
});

describe("what the functions leave behind", () => {
  it("is free of email addresses and of special-category values, in the audit trail, the notifications and the logs", async () => {
    // The world: a person with an address and recorded demographics, two persons who share an
    // address, a laboratory at an institution, and an open correction request.
    await institution("inst-a", ["example.org"]);
    await laboratory("lab-a", { institutionId: "inst-a" });
    await person("person-1", [{ email: "claimant.one@example.org" }]);
    await memberEntry("lab-a", "person-1", { status: "confirmed", role: "coordinator" });
    await person("person-twin-1", [{ email: "shared.address@example.org" }]);
    await person("person-twin-2", [{ email: "shared.address@example.org" }]);
    await adminDb.doc(COLLECTIONS.personDemographics.docPath("person-1")).set({
      ...standard(),
      genderSource: DEMOGRAPHIC_VALUES[0],
      ethnicitySource: DEMOGRAPHIC_VALUES[1],
      genderSelfDescribed: DEMOGRAPHIC_VALUES[2],
      recordedAt: Timestamp.now(),
    });
    await adminDb.doc("correctionRequests/request-1").set({
      ...standard(),
      uid: "uid-claimant",
      entityType: "person",
      entityId: "person-1",
      field: "familyName",
      proposedValue: "Corrected",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    });
    const admin = await administrator("uid-admin");
    const claimant: Caller = { uid: "uid-claimant", email: "claimant.one@example.org" };
    const twin: Caller = { uid: "uid-twin", email: "shared.address@example.org" };
    const newcomer: Caller = { uid: "uid-newcomer", email: "newcomer.account@example.org" };
    const reader = await account("uid-reader", {
      email: "reader.account@example.org",
      mfaEnrolled: true,
      secondFactor: true,
    });
    await grantCapability("uid-reader", "demographics.read");

    // Every function, on its allowed path and on a refusal.
    for (const caller of [claimant, twin, newcomer]) await run(caller, sessionStartContract, {});
    await run({ ...newcomer, emailVerified: false }, sessionStartContract, {});
    expect(await run(claimant, claimProfileContract, {})).toEqual({ status: "linked", personId: "person-1" });
    expect(await run(twin, claimProfileContract, {})).toEqual({ status: "pendingReview" });
    expect(await run(newcomer, claimProfileContract, {})).toEqual({ status: "noMatch" });
    await run(newcomer, claimProfileContract, { email: "claimant.one@example.org" });
    await run(null, claimProfileContract, {});
    await run(newcomer, requestAccessContract, {
      statedName: "Synthetic Newcomer",
      affiliation: "Example University",
      message: "Please add me.",
    });
    const queue = (await run(admin, listAccountClaimsContract, {})) as { claims: { emailLower: string }[] };
    // The reviewer is given the addresses of the claimants. That is the purpose of the list.
    expect(queue.claims.map((claim) => claim.emailLower).sort()).toEqual([
      "newcomer.account@example.org",
      "shared.address@example.org",
    ]);
    await run(admin, reviewAccountClaimContract, { uid: "uid-twin", decision: "approve", personId: "person-twin-1" });
    await run(admin, reviewAccountClaimContract, {
      uid: "uid-newcomer",
      decision: "reject",
      note: "Not known to the programme.",
    });
    await run(admin, setRoleAssignmentContract, {
      action: "approve",
      assignmentId: "uid-claimant__lab_coordinator__laboratory__lab-a",
    });
    await run(admin, setCapabilityGrantContract, {
      action: "grant",
      uid: "uid-twin",
      capability: "audit.read",
      reason: "A synthetic reason.",
    });
    await run(claimant, requestLabClaimContract, { laboratoryId: "lab-a", requestedRole: "representative" });
    await run(admin, reviewLabClaimContract, { claimId: "uid-claimant__lab-a", decision: "approve" });
    await run(admin, resolveCorrectionRequestContract, { requestId: "request-1", outcome: "accepted" });
    await run(claimant, setPersonOrcidContract, {
      personId: "person-1",
      orcid: "0000-0002-1825-0097",
      confirmedOwn: true,
    });
    expect(await run(claimant, getPersonDemographicsContract, { personId: "person-1" })).toMatchObject({
      demographics: { genderSource: DEMOGRAPHIC_VALUES[0], ethnicitySource: DEMOGRAPHIC_VALUES[1] },
    });
    expect(await run(reader, getPersonDemographicsContract, { personId: "person-1" })).toMatchObject({
      demographics: { genderSelfDescribed: DEMOGRAPHIC_VALUES[2] },
    });
    await run(twin, getPersonDemographicsContract, { personId: "person-1" });
    await run(admin, unlinkAccountClaimContract, { uid: "uid-twin", reason: "A synthetic reason." });
    await run(admin, setUserStatusContract, {
      uid: "uid-newcomer",
      status: "suspended",
      reason: "A synthetic reason.",
    });
    await run(newcomer, sessionStartContract, {});

    // The triggers, with the same logger: a restricted document, and a damaged grant.
    await recordWrite(
      adminDb,
      {
        eventId: "event-privacy-1",
        documentPath: "persons/person-1/private/address",
        before: null,
        after: { postalAddress: "c/o claimant.one@example.org", updatedBy: "uid-claimant" },
        authType: "app_user",
        authId: "uid-somebody-else",
        time: new Date(),
      },
      capturing,
    );
    await adminDb
      .doc("capabilityGrants/uid-reader__audit.read")
      .set({ uid: "uid-reader", note: "reader.account@example.org" });
    await rebuildAccess(adminDb, "uid-reader", { at: new Date(), logger: capturing });
    await settle();

    const [audit, notifications] = await Promise.all([
      adminDb.collection("auditEvents").get(),
      adminDb.collectionGroup("notifications").get(),
    ]);
    // The scenario did leave something behind to scan.
    expect(audit.size).toBeGreaterThan(25);
    expect(notifications.size).toBeGreaterThan(5);
    // The lines that the scenario is known to log: a refused input, a refused account, a
    // mismatch between a document and its writer, and a grant that does not fit its schema.
    const messages = logged.map((line) => String(line[1]));
    for (const message of [
      "callable input rejected",
      "callable refused",
      "the writer in a document differs from the principal of its write",
      "documents that do not fit their schema confer nothing",
    ]) {
      expect(messages).toContain(message);
    }
    const actions = audit.docs.map((entry) => entry.get("action") as string);
    for (const action of [
      "demographics.read",
      "claim.approved",
      "claim.unlinked",
      "account.suspended",
      "document.created",
    ]) {
      expect(actions).toContain(action);
    }

    const written = {
      "the audit trail": audit.docs.map((entry) => `${entry.id} ${JSON.stringify(entry.data())}`),
      "the notifications": notifications.docs.map((entry) => `${entry.ref.path} ${JSON.stringify(entry.data())}`),
      "the logs": logged.map((line) => JSON.stringify(line)),
    };
    for (const [where, texts] of Object.entries(written)) {
      for (const text of texts) {
        const lowered = text.toLowerCase();
        for (const secret of [...ADDRESSES, ...DEMOGRAPHIC_VALUES]) {
          expect(lowered, `${where} holds ${secret}`).not.toContain(secret.toLowerCase());
        }
        // No address of any kind, whoever it belongs to.
        expect(text, `${where} holds an address`).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
      }
    }
  });
});
