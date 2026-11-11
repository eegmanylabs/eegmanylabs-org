// The rules of recruitment (docs/DATA_MODEL.md, section 7; D-009, D-019), beside the
// registry-driven matrix: who reads a report, that a member of one laboratory never reads the
// reports of another, that nobody writes, edits or deletes a report directly, who enters a
// planned pause and how it stays tied to its participation, and that forecast runs are read by
// every member and written by trusted code alone. Each refusal stands beside the honest request
// that is accepted.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { laboratoryScopeKey, participationId, replicationScopeKey, unitScopeKeys } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, limit, serverTimestamp, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { EVERYONE, forEach } from "./redteam/exfiltration-and-escalation-support";
import { expectOutcomes, requestsOf } from "./requests";
import { seedWorld, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import {
  appended,
  autoId,
  OTHER_LABORATORY,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  SECOND_PARTICIPATION,
  stored,
  uidOfCaller,
} from "./world";

let environment: RulesTestEnvironment;
const { get, list, create, createAt, update, remove } = requestsOf(() => environment);

/** The report of the world (fixtures.ts), of the own laboratory, and one of the other laboratory in the same replication. */
const OWN_REPORT = `recruitmentReports/${autoId("stored recruitment report")}`;
const OTHER_REPORT = `recruitmentReports/${autoId("other lab report")}`;
const PAUSE = `plannedPauses/${autoId("stored planned pause")}`;
const RUN = `forecastRuns/${autoId("stored forecast run")}`;

const report = (participation: string, laboratoryId: string, fields: Record<string, unknown> = {}) => ({
  participationId: participation,
  replicationId: OWN_REPLICATION,
  laboratoryId,
  scopeKeys: unitScopeKeys(OWN_REPLICATION, laboratoryId),
  asOfDate: "2026-02-28",
  reportKind: "cumulative",
  basis: "labReported",
  entryKind: "new",
  counts: { main: { tested: 4 }, rest: { tested: 3 } },
  exclusions: [],
  reportedBy: uidOfCaller("otherCoordinator"),
  source: "manual",
  dataOrigin: "live",
  ...fields,
});

const pause = (fields: Record<string, unknown> = {}) => ({
  participationId: OWN_PARTICIPATION,
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
  startsOn: "2026-09-01",
  endsOn: "2026-09-14",
  ...fields,
});

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-recruitment");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await trusted(environment, async (db) => {
    await setDoc(doc(db, OTHER_REPORT), { ...appended(), ...report(SECOND_PARTICIPATION, OTHER_LABORATORY) });
    await setDoc(doc(db, `participations/${SECOND_PARTICIPATION}`), {
      ...stored(),
      replicationId: OWN_REPLICATION,
      laboratoryId: OTHER_LABORATORY,
      scopeKeys: unitScopeKeys(OWN_REPLICATION, OTHER_LABORATORY),
      status: "collecting",
      statusHistoryId: null,
      readinessStatus: "approved",
      custom: {},
      dataOrigin: "demo",
    });
  });
});

describe("a recruitment report", () => {
  it("is read within the scope of its participation, and a member of one laboratory never reads another's", async () => {
    await expectOutcomes({
      "a member of the laboratory reads its report": ["allowed", get("ownLabMember", OWN_REPORT)],
      "the coordinator of the laboratory reads it": ["allowed", get("ownCoordinator", OWN_REPORT)],
      "a lead of the replication reads it": ["allowed", get("ownLead", OWN_REPORT)],
      "the team of the replication reads it": ["allowed", get("ownTeam", OWN_REPORT)],
      "the core team reads it": ["allowed", get("coreTeam", OWN_REPORT)],
      "a member of the laboratory reads the report of another laboratory": [
        "denied",
        get("ownLabMember", OTHER_REPORT),
      ],
      "the coordinator of the laboratory reads the report of another laboratory": [
        "denied",
        get("ownCoordinator", OTHER_REPORT),
      ],
      "a member of the other laboratory reads the report of the first": ["denied", get("otherLabMember", OWN_REPORT)],
      "a member of the other laboratory reads its own": ["allowed", get("otherLabMember", OTHER_REPORT)],
      "a lead of another replication reads it": ["denied", get("otherLead", OWN_REPORT)],
      "a member without a role reads it": ["denied", get("member", OWN_REPORT)],
      "an administrator without the factor reads it": ["denied", get("adminWithoutFactor", OWN_REPORT)],
      "a suspended account reads it": ["denied", get("suspended", OWN_REPORT)],
      "a member of the laboratory lists the reports of its laboratory": [
        "allowed",
        list("ownLabMember", "recruitmentReports", where("laboratoryId", "==", OWN_LABORATORY), limit(100)),
      ],
      "a member of the laboratory lists the reports of the other laboratory": [
        "denied",
        list("ownLabMember", "recruitmentReports", where("laboratoryId", "==", OTHER_LABORATORY), limit(100)),
      ],
      "a member of the laboratory lists the reports of the whole replication": [
        "denied",
        list("ownLabMember", "recruitmentReports", where("replicationId", "==", OWN_REPLICATION), limit(100)),
      ],
      "a member of the laboratory lists by the scope keys it holds": [
        "allowed",
        list(
          "ownLabMember",
          "recruitmentReports",
          where("scopeKeys", "array-contains-any", [laboratoryScopeKey(OWN_LABORATORY)]),
          limit(100),
        ),
      ],
      "a member of the laboratory lists by a key it does not hold": [
        "denied",
        list(
          "ownLabMember",
          "recruitmentReports",
          where("scopeKeys", "array-contains-any", [replicationScopeKey(OWN_REPLICATION)]),
          limit(100),
        ),
      ],
      "a lead lists the reports of the replication": [
        "allowed",
        list("ownLead", "recruitmentReports", where("replicationId", "==", OWN_REPLICATION), limit(100)),
      ],
      "a list without a scope": ["denied", list("ownLead", "recruitmentReports", limit(100))],
      "an administrator lists every report": ["allowed", list("admin", "recruitmentReports", limit(100))],
    });
  });

  it("is never created, edited or deleted directly, by anyone", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "creates a report directly", (caller) =>
        create(
          caller,
          `recruitmentReports/${autoId(`direct report of ${caller}`)}`,
          report(OWN_PARTICIPATION, OWN_LABORATORY, { reportedBy: uidOfCaller(caller) }),
          true,
        ),
      ),
      ...forEach(EVERYONE, "denied", "edits a report", (caller) =>
        update(caller, OWN_REPORT, { counts: { main: { tested: 400 } } }),
      ),
      ...forEach(EVERYONE, "denied", "deletes a report", (caller) => remove(caller, OWN_REPORT)),
      "the coordinator files a correction directly": [
        "denied",
        create(
          "ownCoordinator",
          `recruitmentReports/${autoId("direct correction")}`,
          report(OWN_PARTICIPATION, OWN_LABORATORY, {
            entryKind: "correction",
            correctsReportId: OWN_REPORT.split("/")[1],
            reportedBy: uidOfCaller("ownCoordinator"),
          }),
          true,
        ),
      ],
      "an administrator files a central verification directly": [
        "denied",
        createAt(
          "admin",
          `recruitmentReports/${autoId("direct verification")}`,
          report(OWN_PARTICIPATION, OWN_LABORATORY, {
            basis: "centrallyVerified",
            verifiesReportId: OWN_REPORT.split("/")[1],
            reportedBy: uidOfCaller("admin"),
          }),
        ),
      ],
    });
  });
});

describe("a planned pause", () => {
  it("is entered by those who manage the participation, and read within its scope", async () => {
    await expectOutcomes({
      "the coordinator of the laboratory enters a pause": [
        "allowed",
        create("ownCoordinator", `plannedPauses/${autoId("coordinator pause")}`, pause()),
      ],
      "a lead of the replication enters a pause": [
        "allowed",
        create("ownLead", `plannedPauses/${autoId("lead pause")}`, pause({ reason: "Equipment repair." })),
      ],
      "a member of the laboratory enters a pause": [
        "denied",
        create("ownLabMember", `plannedPauses/${autoId("member pause")}`, pause()),
      ],
      "the coordinator of another laboratory enters one": [
        "denied",
        create("otherCoordinator", `plannedPauses/${autoId("other pause")}`, pause()),
      ],
      "a member of the laboratory reads the pause": ["allowed", get("ownLabMember", PAUSE)],
      "a member of the other laboratory reads it": ["denied", get("otherLabMember", PAUSE)],
      "the coordinator moves its end": ["allowed", update("ownCoordinator", PAUSE, { endsOn: "2026-08-10" })],
      "a member of the laboratory moves its end": ["denied", update("ownLabMember", PAUSE, { endsOn: "2026-08-10" })],
      "the coordinator archives it": ["allowed", update("ownCoordinator", PAUSE, { archivedAt: serverTimestamp() })],
      "the coordinator deletes it": ["denied", remove("ownCoordinator", PAUSE)],
    });
  });

  it("stays tied to its participation, with dates in order", async () => {
    await expectOutcomes({
      "a pause that ends before it starts": [
        "denied",
        create("ownCoordinator", `plannedPauses/${autoId("backwards pause")}`, pause({ endsOn: "2026-08-01" })),
      ],
      "a pause on a day that does not exist": [
        "denied",
        create("ownCoordinator", `plannedPauses/${autoId("impossible pause")}`, pause({ endsOn: "2026-09-31" })),
      ],
      "a pause whose laboratory is not that of its participation": [
        "denied",
        create(
          "ownLead",
          `plannedPauses/${autoId("mismatched pause")}`,
          pause({ laboratoryId: OTHER_LABORATORY, scopeKeys: unitScopeKeys(OWN_REPLICATION, OTHER_LABORATORY) }),
        ),
      ],
      "a pause of a participation that does not exist": [
        "denied",
        create(
          "ownCoordinator",
          `plannedPauses/${autoId("orphan pause")}`,
          pause({ participationId: participationId(OWN_REPLICATION, "lab-synthetic-none") }),
        ),
      ],
      "a pause with scope keys of its own choosing": [
        "denied",
        create(
          "ownCoordinator",
          `plannedPauses/${autoId("widened pause")}`,
          pause({ scopeKeys: [...unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY), "members"] }),
        ),
      ],
      "a pause moved to another participation": [
        "denied",
        update("ownLead", PAUSE, { participationId: SECOND_PARTICIPATION }),
      ],
      "a pause moved to another laboratory": ["denied", update("ownLead", PAUSE, { laboratoryId: OTHER_LABORATORY })],
      "an update that turns the dates round": ["denied", update("ownCoordinator", PAUSE, { startsOn: "2026-08-20" })],
    });
  });
});

describe("a forecast run", () => {
  it("is read by every member and written by trusted code alone", async () => {
    await expectOutcomes({
      "a member without a role reads it": ["allowed", get("member", RUN)],
      "an account without membership reads it": ["denied", get("noMembership", RUN)],
      "a member lists the runs of a replication": [
        "allowed",
        list("member", "forecastRuns", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "a lead stores a run directly": [
        "denied",
        create(
          "ownLead",
          `forecastRuns/${autoId("direct forecast run")}`,
          {
            replicationId: OWN_REPLICATION,
            generatedAt: new Date("2026-02-01T00:00:00Z"),
            generatedBy: uidOfCaller("ownLead"),
            methodVersion: "recruitment-forecast/1",
            assumptions: {},
            scenarios: { optimistic: {}, central: {}, conservative: {} },
            inputsAsOf: "2026-02-01",
            dataOrigin: "projected",
          },
          true,
        ),
      ],
      "an administrator changes a run": ["denied", update("admin", RUN, { inputsAsOf: "2026-01-01" })],
      "an administrator deletes a run": ["denied", remove("admin", RUN)],
    });
  });
});
