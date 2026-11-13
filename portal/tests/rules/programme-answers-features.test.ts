// The rules that apply the programme's answers of 13 November 2026 (docs/MIGRATION_PLAN.md,
// section 11), beside the registry-driven matrix: the outcome labels of the prediction market,
// its null-significance labels and the links to its study descriptions and information sheets,
// and the summary figures of the historical workbooks are sealed and read by programme
// administrators alone, and so are the raw rows that hold them, whatever an override or a named
// grant says (questions 7, 14, 22 and 24); the contributor lists of a replication are read by its
// team and by programme staff (questions 10 and 23); and the basis on which an import confirmed a
// lead is written by trusted code.
// Fixtures are synthetic: fictitious accounts and studies on the example.org domain.
import { hypothesisId, replicationMembershipId } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, limit, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { FIXTURES } from "./fixtures";
import { EVERYONE_BELOW_ADMIN, forEach, storedPath } from "./redteam/exfiltration-and-escalation-support";
import { type Actor, expectOutcomes, requestsOf } from "./requests";
import { seedWorld, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import {
  type AccountSpec,
  type CallerProfile,
  firestoreWithToken,
  OWN_REPLICATION,
  OWNER_PERSON,
  resolveSyntheticAccess,
  stored,
  tokenOf,
} from "./world";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, update, createAt } = requestsOf(() => environment);

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-programme-answers");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

/** An account of its own, with an access document as the resolver writes it. */
async function account(name: string, spec: AccountSpec): Promise<Actor> {
  const uid = `uid-${name}`;
  const access = resolveSyntheticAccess(uid, spec);
  await trusted(environment, (db) => setDoc(doc(db, `access/${uid}`), { ...stored(), ...access }));
  const profile: CallerProfile = {
    kind: "member",
    uid,
    email: `${name}.account@example.org`,
    access,
    secondFactor: spec.secondFactor ?? false,
  };
  return { db: firestoreWithToken(environment, uid, tokenOf(profile)), uid };
}

const CORE: AccountSpec = {
  roles: [["core_team", "programme", "programme"]],
  personId: "person-synthetic-core-widened",
  mfaEnrolled: true,
  secondFactor: true,
};

describe("what a decision of the programme seals", () => {
  const sealed = [
    ["the outcome labels of a replication", "predictionMarketOutcomes"],
    ["a summary figure of a historical workbook", "historicalAggregates"],
    ["a raw row of a source", "sourceRecords"],
    ["the continuation of a raw row", "sourceRecordRawChunks"],
  ] as const;

  it.each(sealed)("is read by a programme administrator alone: %s", async (_what, key) => {
    await expectOutcomes({
      "the programme administrator reads it": ["allowed", get("admin", storedPath(key))],
      ...forEach(EVERYONE_BELOW_ADMIN, "denied", "reads it", (caller) => get(caller, storedPath(key))),
    });
  });

  it("is listed by a programme administrator alone", async () => {
    await expectOutcomes({
      "the programme administrator lists the outcome labels": [
        "allowed",
        list("admin", "predictionMarketOutcomes", limit(10)),
      ],
      "the programme administrator lists the figures of a replication": [
        "allowed",
        list("admin", "historicalAggregates", where("replicationIds", "array-contains", OWN_REPLICATION), limit(10)),
      ],
      ...forEach(EVERYONE_BELOW_ADMIN, "denied", "lists the outcome labels", (caller) =>
        list(caller, "predictionMarketOutcomes", limit(10)),
      ),
      ...forEach(EVERYONE_BELOW_ADMIN, "denied", "lists the figures of a replication", (caller) =>
        list(caller, "historicalAggregates", where("replicationIds", "array-contains", OWN_REPLICATION), limit(10)),
      ),
      ...forEach(EVERYONE_BELOW_ADMIN, "denied", "lists the raw rows of a source", (caller) =>
        list(caller, "sourceRecords", where("sourceKey", "==", "e"), limit(10)),
      ),
      ...forEach(EVERYONE_BELOW_ADMIN, "denied", "lists continuations of raw rows across records", (caller) =>
        listAcrossParents(caller, "rawChunks", limit(10)),
      ),
    });
  });

  it("is read by no member of the core team, whatever an override or a named grant says", async () => {
    const widened = await account("core-sealed-override", {
      ...CORE,
      overrides: [{ role: "core_team", overrides: { sealedRead: true, importsRun: true } }],
    });
    const granted = await account("core-sealed-grant", { ...CORE, namedGrants: ["sealed.read"] });
    const leadWithGrant = await account("lead-sealed-grant", {
      roles: [["replication_lead", "replication", OWN_REPLICATION]],
      personId: "person-synthetic-lead-sealed",
      mfaEnrolled: true,
      secondFactor: true,
      namedGrants: ["sealed.read"],
    });
    for (const [label, actor] of [
      ["with an override", widened],
      ["with a named grant", granted],
      ["a lead with a named grant", leadWithGrant],
    ] as const) {
      await expectOutcomes({
        [`${label}: the outcome labels`]: ["denied", get(actor, storedPath("predictionMarketOutcomes"))],
        [`${label}: a summary figure`]: ["denied", get(actor, storedPath("historicalAggregates"))],
        [`${label}: a raw row`]: ["denied", get(actor, storedPath("sourceRecords"))],
      });
    }
  });

  it("is written by no client, a programme administrator included", async () => {
    const labels = FIXTURES.predictionMarketOutcomes?.seed ?? {};
    await expectOutcomes({
      "the programme administrator rewrites a label": [
        "denied",
        update("admin", storedPath("predictionMarketOutcomes"), { labelsSource: { h01: "a forged label" } }),
      ],
      "the programme administrator plants labels for another replication": [
        "denied",
        createAt("admin", "predictionMarketOutcomes/SyntheticStudy2002", labels),
      ],
      "the programme administrator rewrites a figure": [
        "denied",
        update("admin", storedPath("historicalAggregates"), { valueSource: "999" }),
      ],
    });
  });
});

describe("the null-significance labels and the links to the market's documents (question 22)", () => {
  const sealed = storedPath("predictionMarketOutcomes");
  const hypothesis = `replications/${OWN_REPLICATION}/hypotheses/${hypothesisId(1)}`;
  const material = {
    nullSigSource: "sig",
    studyDescriptionUrl: "https://example.org/synthetic-market/study-description.pdf",
    infosheetUrl: "https://example.org/synthetic-market/information-sheet",
  } as const;

  it("are held in the sealed document of the replication, which a programme administrator alone reads", async () => {
    const seeded = FIXTURES.predictionMarketOutcomes?.seed ?? {};
    for (const field of ["nullSigSource", "studyDescriptionUrl", "infosheetUrl", "materialSealedBy"]) {
      if (!(field in seeded)) throw new Error(`The sealed fixture holds no ${field}.`);
    }
    await expectOutcomes({
      "the programme administrator reads them": ["allowed", get("admin", sealed)],
      ...forEach(EVERYONE_BELOW_ADMIN, "denied", "reads them", (caller) => get(caller, sealed)),
      ...forEach(EVERYONE_BELOW_ADMIN, "denied", "lists them", (caller) =>
        list(caller, "predictionMarketOutcomes", where("replicationId", "==", OWN_REPLICATION), limit(10)),
      ),
    });
  });

  it("are written by no client into the sealed document, a programme administrator included", async () => {
    await expectOutcomes({
      "the programme administrator rewrites a null-significance label": [
        "denied",
        update("admin", sealed, { nullSigSource: { h01: "a forged label" } }),
      ],
      "the programme administrator rewrites a link": [
        "denied",
        update("admin", sealed, { infosheetUrl: "https://example.org/a-forged-sheet" }),
      ],
    });
  });

  it("are written by no one onto a hypothesis, which every member reads", async () => {
    const callers = ["admin", "coreTeam", "ownLead"] as const;
    const attempts: Record<string, Parameters<typeof expectOutcomes>[0][string]> = {};
    for (const caller of callers) {
      // The same caller may change the address of the preregistration, so a denial below is the field's alone.
      attempts[`${caller} changes the preregistration of a hypothesis`] = [
        "allowed",
        update(caller, hypothesis, { preregistrationUrl: `https://example.org/preregistration-${caller}` }),
      ];
      for (const [field, value] of Object.entries(material)) {
        attempts[`${caller} writes ${field} on a hypothesis`] = [
          "denied",
          update(caller, hypothesis, { [field]: value }),
        ];
      }
    }
    await expectOutcomes(attempts);
  });
});

describe("the contributor lists of a replication", () => {
  it("are read by its team, which the programme decided, and by programme staff, which the answer to question 23 confirms, and by no other member", async () => {
    const path = storedPath("contributors");
    await expectOutcomes({
      "the programme administrator reads a row": ["allowed", get("admin", path)],
      "the core team reads a row": ["allowed", get("coreTeam", path)],
      "the lead of the replication reads a row": ["allowed", get("ownLead", path)],
      "a member of its team reads a row": ["allowed", get("ownTeam", path)],
      "its team lists the rows of the replication": [
        "allowed",
        list("ownTeam", "contributors", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      ...forEach(
        ["member", "ownLabMember", "otherLabMember", "ownCoordinator", "otherCoordinator", "otherLead", "noMembership"],
        "denied",
        "reads a row",
        (caller) => get(caller, path),
      ),
      ...forEach(["member", "otherLead"], "denied", "lists the rows of the replication", (caller) =>
        list(caller, "contributors", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ),
      "a member lists every row": ["denied", list("member", "contributors", limit(50))],
    });
  });
});

describe("the basis on which an import confirmed a lead", () => {
  it("is written by trusted code alone", async () => {
    const basis = {
      basis: "allSourcesAgree",
      sources: ["h/replications"],
      decision: {
        decidedBy: "programmeLead",
        decidedOn: "2026-11-13",
        reference: "docs/MIGRATION_PLAN.md, section 11, question 5",
      },
    };
    const pathOf = (role: string) =>
      `replications/${OWN_REPLICATION}/memberships/${replicationMembershipId(OWNER_PERSON, role)}`;
    const membership = pathOf("advisor");
    await expectOutcomes({
      "the programme administrator creates a membership without a basis": [
        "allowed",
        createAt("admin", pathOf("analyst"), {
          replicationId: OWN_REPLICATION,
          personId: OWNER_PERSON,
          role: "analyst",
          isCurrent: true,
          earlierPeriods: [],
          reviewStatus: "confirmed",
        }),
      ],
      "the programme administrator states a basis on a new membership": [
        "denied",
        createAt("admin", membership, {
          replicationId: OWN_REPLICATION,
          personId: OWNER_PERSON,
          role: "advisor",
          isCurrent: true,
          earlierPeriods: [],
          reviewStatus: "confirmed",
          confirmationBasis: basis,
        }),
      ],
      "the programme administrator adds a basis to a stored membership": [
        "denied",
        update("admin", storedPath("replicationMemberships"), { confirmationBasis: basis }),
      ],
    });
  });
});
