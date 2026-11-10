// Runs every query of the catalogue against the security rules, as the caller that makes it:
// the query is accepted, and the same query without the clause that limits it to a scope is
// refused. The indexes that the queries need are checked in tests/architecture/indexes.test.ts.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getDocs } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outcomeOf } from "./attempts";
import { QUERY_CATALOGUE } from "./queries";
import { seedWorld } from "./seed";
import { createRulesEnvironment } from "./support";
import { CALLERS, firestoreOf } from "./world";

let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-queries");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

const byClients = QUERY_CATALOGUE.filter((query) => query.caller !== null);

describe("a catalogued query", () => {
  it.each(byClients.map((query) => [query.purpose, query] as const))("is accepted: %s", async (_purpose, query) => {
    const db = firestoreOf(environment, CALLERS[query.caller ?? "signedOut"]);
    expect(await outcomeOf(() => getDocs(query.build(db)))).toBe("allowed");
  });

  it.each(byClients.filter((query) => query.scopedBy !== null).map((query) => [query.purpose, query] as const))(
    "is refused without the clause that limits it to a scope: %s",
    async (_purpose, query) => {
      const db = firestoreOf(environment, CALLERS[query.caller ?? "signedOut"]);
      expect(await outcomeOf(() => getDocs(query.buildWithoutScope(db)))).toBe("denied");
    },
  );

  it.each(byClients.map((query) => [query.purpose, query] as const))(
    "is refused to a caller who is not signed in: %s",
    async (_purpose, query) => {
      const db = firestoreOf(environment, CALLERS.signedOut);
      expect(await outcomeOf(() => getDocs(query.build(db)))).toBe("denied");
    },
  );

  it("returns the documents of the scope when it is accepted", async () => {
    const [first] = byClients;
    const snapshot = await getDocs(
      (first as (typeof byClients)[number]).build(firestoreOf(environment, CALLERS.ownCoordinator)),
    );
    expect(snapshot.docs.map((document) => document.ref.path)).toEqual([
      expect.stringMatching(/^participations\/.+\/checklist\/ethics$/),
    ]);
  });
});
