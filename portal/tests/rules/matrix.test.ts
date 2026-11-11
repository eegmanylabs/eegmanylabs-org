// The registry-driven matrix: every kind of caller against every entry of the collection
// registry. The expected answer of each request comes from the registry (policy.ts), so this
// test fails when the rules allow what the registry refuses, and when they refuse what it grants.
//
// An entry whose rules are written is attacked through its fixture. An entry whose rules are
// not written yet must refuse every caller, a programme administrator included, every read and
// every write. The tests at the end hold the matrix itself to account: every entry is covered,
// every granted operation is both allowed to someone and refused to someone, and every allow
// statement of the rules file was granted at least once and refused at least once.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { COLLECTION_ENTRIES, COLLECTION_KEYS, type CollectionEntry, type WriteOperation } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Attempt, attemptsFor, outcomeOf } from "./attempts";
import { collectRuleCoverage, coverageOf, type RuleCoverage, resetRuleCoverage } from "./coverage";
import { FIXTURES } from "./fixtures";
import { grantedOperations } from "./policy";
import { allowStatements } from "./rules-source";
import { fixtureOf, pathOf, placeholderIds, restoreDocuments, seedWorld, storedDocument, worldDocuments } from "./seed";
import { createRulesEnvironment, readRulesFile } from "./support";
import { CALLER_KINDS, CALLERS, type CallerKind } from "./world";

/** A project of its own, so that the record of evaluated rules holds the requests of this file alone. */
const MATRIX_PROJECT_ID = "demo-eegml-rules-matrix";

let environment: RulesTestEnvironment;
const world = worldDocuments();
const rulesSource = readRulesFile("firestore.rules");
/** Which rule expressions the requests of the matrix made true and false, collected entry by entry. */
let coverage: RuleCoverage | null = null;

/** What the matrix observed, for the tests that hold it to account. */
const observed = new Map<string, { allowed: number; denied: number }>();
const record = (entry: CollectionEntry, attempt: Attempt, allowed: boolean) => {
  const key = `${entry.key} ${attempt.kind}`;
  const counts = observed.get(key) ?? { allowed: 0, denied: 0 };
  if (allowed) counts.allowed += 1;
  else counts.denied += 1;
  observed.set(key, counts);
};

beforeAll(async () => {
  environment = await createRulesEnvironment(MATRIX_PROJECT_ID);
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

/** Checks that a document the rules accepted is a document its schema accepts. */
async function invalidFieldsOf(entry: CollectionEntry, path: string): Promise<string[] | null> {
  const stored = await storedDocument(environment, path);
  if (stored === null) return ["(the document is not there)"];
  const parsed = entry.schema.safeParse(stored);
  return parsed.success ? null : parsed.error.issues.map((issue) => issue.path.join(".") || "(document)");
}

/**
 * Makes every request of one entry as one caller and returns what went against the registry.
 * Whatever a write changed is put back, so that each caller meets the same world.
 */
async function disagreements(entry: CollectionEntry, kind: CallerKind): Promise<string[]> {
  const wrong: string[] = [];
  const touched = new Set<string>();
  for (const attempt of attemptsFor(environment, entry, CALLERS[kind])) {
    const outcome = await outcomeOf(attempt.run);
    const allowed = outcome === "allowed";
    record(entry, attempt, allowed);
    if (allowed !== attempt.expected) {
      wrong.push(`${attempt.operation}: ${outcome}, and the registry ${attempt.expected ? "grants" : "refuses"} it`);
    }
    if (allowed && attempt.path !== null) {
      touched.add(attempt.path);
      for (const other of attempt.touches ?? []) touched.add(other);
      if (attempt.expected && attempt.kind !== "delete") {
        const invalid = await invalidFieldsOf(entry, attempt.path);
        if (invalid !== null) wrong.push(`${attempt.operation}: the rules accepted an invalid document (${invalid})`);
      }
    }
  }
  if (touched.size > 0) {
    const stored = Object.fromEntries(
      [...touched].flatMap((path) => (path in world ? [[path, world[path] ?? {}]] : [])),
    );
    await restoreDocuments(
      environment,
      stored,
      [...touched].filter((path) => !(path in world)),
    );
  }
  return wrong;
}

/** After how many entries the coverage that the emulator holds is collected and discarded. */
const COVERAGE_STEP = 12;

describe.each(COLLECTION_ENTRIES.map((entry, index) => [entry.key, entry, index] as const))(
  "%s",
  (_key, entry, index) => {
    afterAll(async () => {
      if ((index + 1) % COVERAGE_STEP !== 0 && index + 1 !== COLLECTION_ENTRIES.length) return;
      coverage = await collectRuleCoverage(MATRIX_PROJECT_ID, coverage);
      await resetRuleCoverage(MATRIX_PROJECT_ID, rulesSource);
    });

    it.each(CALLER_KINDS)(
      `${entry.enforcement === "enforced" ? "follows the registry" : "is closed"} for: %s`,
      async (kind) => {
        expect(await disagreements(entry, kind)).toEqual([]);
      },
    );
  },
);

describe("the matrix", () => {
  const enforced = COLLECTION_ENTRIES.filter((entry) => entry.enforcement === "enforced");

  it("covers every entry of the registry, with a fixture for each enforced entry and for no other", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(enforced.map((entry) => entry.key).sort());
    const covered = new Set([...observed.keys()].map((key) => key.split(" ")[0]));
    expect(COLLECTION_KEYS.filter((key) => !covered.has(key))).toEqual([]);
  });

  it("stores, for every enforced entry, a document that its schema accepts", () => {
    const invalid = enforced.flatMap((entry) => {
      const parsed = entry.schema.safeParse(fixtureOf(entry.key)?.seed);
      return parsed.success ? [] : [`${entry.key}: ${parsed.error.issues.map((issue) => issue.path.join("."))}`];
    });
    expect(invalid).toEqual([]);
  });

  it("stores each document at a path of its own", () => {
    const paths = COLLECTION_ENTRIES.map((entry) => pathOf(entry, fixtureOf(entry.key)?.ids ?? placeholderIds(entry)));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("attempts every write that the registry grants, with a document of the fixture's own", () => {
    const missing = enforced.flatMap((entry) => {
      const fixture = fixtureOf(entry.key);
      const granted = grantedOperations(entry);
      return [
        ...(granted.includes("create") !== (fixture?.create !== undefined) ? [`${entry.key}: create`] : []),
        ...(granted.includes("update") !== (fixture?.update !== undefined) ? [`${entry.key}: update`] : []),
      ];
    });
    expect(missing).toEqual([]);
  });

  it("saw every read that the registry opens, and every write that it grants, both allowed and refused", () => {
    const lacking: string[] = [];
    for (const entry of enforced) {
      const expectations: [string, boolean][] = [
        ["read", !entry.read.tiers.every((tier) => tier === "FUNCTION")],
        ...(["create", "update", "delete"] as const).map((operation): [WriteOperation, boolean] => [
          operation,
          grantedOperations(entry).includes(operation),
        ]),
      ];
      for (const [kind, open] of expectations) {
        const counts = observed.get(`${entry.key} ${kind}`) ?? { allowed: 0, denied: 0 };
        // The fixed document `system/settings` has no sibling to create.
        if (counts.allowed + counts.denied === 0 && kind === "create" && fixtureOf(entry.key)?.ids.length === 0)
          continue;
        if (counts.denied === 0) lacking.push(`${entry.key} ${kind}: never refused`);
        if (open !== counts.allowed > 0) {
          lacking.push(
            `${entry.key} ${kind}: ${open ? "never allowed" : "allowed, and the registry opens it to nobody"}`,
          );
        }
      }
    }
    expect(lacking).toEqual([]);
  });

  it("allowed nothing at all on an entry whose rules are not written yet", () => {
    const opened = COLLECTION_ENTRIES.filter((entry) => entry.enforcement === "deniedUntilBuilt").flatMap((entry) =>
      [...observed]
        .filter(([key, counts]) => key.startsWith(`${entry.key} `) && counts.allowed > 0)
        .map(([key]) => key),
    );
    expect(opened).toEqual([]);
  });
});

describe("the rules file", () => {
  it("has every allow statement granted at least once and refused at least once by the matrix", () => {
    const source = rulesSource;
    const report = coverage ?? { source: "", byOffset: new Map() };
    expect(report.source).toBe(source);
    const statements = allowStatements(source);
    expect(statements.length).toBeGreaterThan(100);

    const neverGranted: string[] = [];
    const neverRefused: string[] = [];
    const grantedDenyAll: string[] = [];
    for (const statement of statements) {
      const { granted, refused } = coverageOf(report, statement);
      const label = `line ${statement.line}: allow ${statement.methods.join(", ")}`;
      if (statement.condition === "false") {
        // The statement that closes everything else is a constant, which the emulator does not
        // record. The entries whose rules are not written yet prove that it holds.
        if (granted > 0) grantedDenyAll.push(label);
        continue;
      }
      if (granted === 0) neverGranted.push(label);
      if (refused === 0) neverRefused.push(label);
    }
    expect(neverGranted).toEqual([]);
    expect(neverRefused).toEqual([]);
    expect(grantedDenyAll).toEqual([]);
  });
});
