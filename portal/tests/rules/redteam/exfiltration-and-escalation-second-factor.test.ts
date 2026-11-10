// Red-team attacks by a programme administrator who is required to use a second factor and
// signed in without one. Such a session is an ordinary member and nothing more: no capability of
// the programme, no restricted record of a unit, no write that a programme role confers.
// The attacks also try to put the claim of a second factor where a rule might look for it by
// mistake. Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import type { RulesTestEnvironment, TokenOptions } from "@firebase/rules-unit-testing";
import { limit } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { type Actor, type Expectations, expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import {
  CALLERS,
  firestoreWithToken,
  MEMBER_PERSON,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  resolveSyntheticAccess,
  stored,
  tokenOf,
  uidOfCaller,
} from "../world";
import { newRecord, seed, storedPath } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, create, update } = requestsOf(() => environment);

const ADMIN_UID = uidOfCaller("adminWithoutFactor");

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-factor");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
});

/** Every read that a programme role confers and membership alone does not. */
function programmeReads(actor: Actor): Expectations {
  return {
    "reads who holds which role": ["denied", list(actor, "roleAssignments", limit(5))],
    "reads the named grants": ["denied", get(actor, storedPath("capabilityGrants"))],
    "reads the overrides of the capability matrix": ["denied", get(actor, storedPath("roleCapabilities"))],
    "reads the record grants": ["denied", get(actor, storedPath("recordGrants"))],
    "reads the contact document of a person": ["denied", get(actor, `persons/${OWNER_PERSON}/private/contact`)],
    "reads the postal address of a person": ["denied", get(actor, storedPath("personAddress"))],
    "reads the private notes about a person": ["denied", get(actor, storedPath("personNotes"))],
    "reads the evidence of an account claim": ["denied", get(actor, storedPath("accountClaimReview"))],
    "reads a request to represent a laboratory": ["denied", get(actor, storedPath("labClaims"))],
    "reads the private detail of a laboratory": ["denied", get(actor, storedPath("laboratoryDetail"))],
    "reads the private detail of a replication": ["denied", get(actor, storedPath("replicationDetail"))],
    "reads the private detail of a participation": ["denied", get(actor, storedPath("participationDetail"))],
    "reads the checklist of a participation": ["denied", get(actor, storedPath("participationChecklist"))],
    "lists the deviations of every participation": ["denied", listAcrossParents(actor, "deviations", limit(5))],
    "reads the outreach correspondence": ["denied", get(actor, storedPath("outreachContacts"))],
    "reads the address of a contributor": ["denied", get(actor, storedPath("contributorContact"))],
    "reads a contributor table": ["denied", get(actor, storedPath("contributorTables"))],
    "reads an account name of a replication": ["denied", get(actor, storedPath("externalAccounts"))],
    "reads an unconfirmed correction request of another account": [
      "denied",
      get(actor, storedPath("correctionRequests")),
    ],
    "reads the source registry": ["denied", get(actor, storedPath("sources"))],
    "reads a raw row": ["denied", get(actor, storedPath("sourceRecords"))],
    "reads a change of an import": ["denied", get(actor, storedPath("importBatchChanges"))],
    "reads the review queue": ["denied", get(actor, storedPath("reconciliationItems"))],
    "reads an integrity report": ["denied", get(actor, storedPath("integrityReports"))],
    "reads the directory, as every member does": ["allowed", get(actor, `persons/${OWNER_PERSON}`)],
  };
}

describe("a programme administrator who signed in without the required second factor", () => {
  it("reads what a member reads and nothing that a programme role confers", async () => {
    await expectOutcomes(programmeReads("adminWithoutFactor"));
  });

  it("writes nothing that a programme role confers", async () => {
    await expectOutcomes({
      "edits the directory document of another person": [
        "denied",
        update("adminWithoutFactor", `persons/${OWNER_PERSON}`, { displayName: "Synthetic Owner, edited" }),
      ],
      "writes private notes about a person": [
        "denied",
        create("adminWithoutFactor", `persons/${MEMBER_PERSON}/private/notes`, newRecord("personNotes", ADMIN_UID)),
      ],
      "edits a laboratory": [
        "denied",
        update("adminWithoutFactor", `laboratories/${OWN_LABORATORY}`, { city: "Example Town" }),
      ],
      "edits a replication": [
        "denied",
        update("adminWithoutFactor", `replications/${OWN_REPLICATION}`, { shortTitle: "Edited" }),
      ],
      "confirms a membership": [
        "denied",
        update("adminWithoutFactor", storedPath("replicationMemberships"), { reviewStatus: "needsReview" }),
      ],
      "names a lead": [
        "denied",
        create("adminWithoutFactor", `replications/${OWN_REPLICATION}/memberships/${MEMBER_PERSON}__lead`, {
          replicationId: OWN_REPLICATION,
          personId: MEMBER_PERSON,
          role: "lead",
          isCurrent: true,
          earlierPeriods: [],
          reviewStatus: "confirmed",
        }),
      ],
      "edits a participation": [
        "denied",
        update("adminWithoutFactor", `participations/${OWN_PARTICIPATION}`, { targetNMain: 1 }),
      ],
      "creates a status definition": [
        "denied",
        create("adminWithoutFactor", "statusDefinitions/replication__synthetic", {
          ...newRecord("statusDefinitions", ADMIN_UID),
          entityType: "replication",
          key: "synthetic",
        }),
      ],
      "edits the email domains of an institution": [
        "denied",
        update("adminWithoutFactor", storedPath("institutions"), { emailDomains: ["example.org"] }),
      ],
      "writes the address of a contributor": [
        "denied",
        update("adminWithoutFactor", storedPath("contributorContact"), { email: "changed.address@example.org" }),
      ],
      // The same account with its factor may do each of these: one stands for all.
      "admin: edits the directory document of another person": [
        "allowed",
        update("admin", `persons/${OWNER_PERSON}`, { displayName: "Synthetic Owner, edited" }),
      ],
    });
  });

  it("gains nothing from a claim of a second factor that Firebase did not put where it puts one", async () => {
    const base = tokenOf(CALLERS.adminWithoutFactor);
    const forged: Readonly<Record<string, TokenOptions>> = {
      "a custom claim named like the claim of Firebase": { ...base, sign_in_second_factor: "totp" },
      "a custom claim that says the factor was verified": { ...base, mfa: true, secondFactor: true, amr: ["mfa"] },
      "custom claims that name a programme role": {
        ...base,
        programmeRoles: ["programme_admin"],
        admin: true,
        role: "programme_admin",
      },
    };
    for (const [what, token] of Object.entries(forged)) {
      const actor: Actor = { db: firestoreWithToken(environment, ADMIN_UID, token), uid: ADMIN_UID };
      const refusals = Object.fromEntries(
        Object.entries(programmeReads(actor)).map(([label, row]) => [`${what}: ${label}`, row] as const),
      );
      await expectOutcomes(refusals);
    }
    // The session is in good standing throughout: what is refused is refused for want of the factor.
    await expectOutcomes({
      "reads its own access document": ["allowed", get("adminWithoutFactor", `access/${ADMIN_UID}`)],
    });
  });
});

describe("a holder of a programme role who has enrolled no factor", () => {
  it("is refused the powers of the role even when a stale access document still lists them", async () => {
    // The resolver withholds the powers until a factor is enrolled. This document is what an
    // out-of-date copy would look like: every capability, and no enrolled factor.
    const uid = "uid-redteam-stale-admin";
    const resolved = resolveSyntheticAccess(uid, {
      roles: [["programme_admin", "programme", "programme"]],
      personId: "person-synthetic-stale-admin",
      mfaEnrolled: true,
    });
    await seed(environment, { [`access/${uid}`]: { ...stored(), ...resolved, mfaEnrolled: false } });
    const withFactorClaim: TokenOptions = {
      ...tokenOf(CALLERS.admin),
      email: "redteam.stale-admin@example.org",
    };
    const actor: Actor = { db: firestoreWithToken(environment, uid, withFactorClaim), uid };
    await expectOutcomes(programmeReads(actor));
  });
});
