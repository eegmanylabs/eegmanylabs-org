// The registry-driven references and queries of the web data layer, run against the Firestore
// emulator: the same code the browser runs, given the Firestore instance of a test.
// Fixtures are synthetic: invented studies and laboratories, and fictitious accounts on the example.org domain.

import {
  COLLECTIONS,
  emptyAccess,
  type ListableCollectionKey,
  participationId,
  unitScopeKeys,
  userWriteContext,
} from "@eegml/shared";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, type Firestore, getDoc, getDocs, setDoc, Timestamp } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DataShapeError } from "../../web/src/data/converter";
import { type LiveQuery, LiveQueryError } from "../../web/src/data/query-spec";
import {
  collectionGroupReference,
  collectionReference,
  documentReference,
  queryReference,
} from "../../web/src/data/refs";
import { ACCOUNTS, createRulesEnvironment, firestoreAs } from "./support";

let environment: RulesTestEnvironment;

const EARLY = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
const LATE = Timestamp.fromDate(new Date("2026-03-01T00:00:00Z"));

const standard = (at: Timestamp = EARLY) => ({
  schemaVersion: 1,
  createdAt: at,
  updatedAt: at,
  createdBy: "uid-synthetic",
  updatedBy: "uid-synthetic",
  archivedAt: null,
  writeContext: userWriteContext(),
});

const participation = (replicationId: string, laboratoryId: string, at: Timestamp = EARLY) => ({
  ...standard(at),
  replicationId,
  laboratoryId,
  scopeKeys: unitScopeKeys(replicationId, laboratoryId),
  status: "invited",
  statusHistoryId: null,
  readinessStatus: "notStarted",
  custom: {},
  dataOrigin: "demo",
});

const hypothesis = (replicationId: string, number: number, scientificReviewStatus: string) => ({
  ...standard(),
  replicationId,
  hypothesisNumber: String(number),
  text: `Synthetic hypothesis ${number}`,
  scientificReviewStatus,
  analysisStatus: "notStarted",
  resultReviewedBy: null,
  resultReviewedAt: null,
});

const user = (email: string) => ({
  ...standard(),
  emailLower: email,
  displayName: null,
  personId: null,
  status: "active",
  mfaEnrolled: false,
  lastSeenAt: EARLY,
  dataOrigin: "demo",
});

/** Runs with the rules switched off, as a caller whom the rules allow everything would. */
function trusted<T>(run: (db: Firestore) => Promise<T>): Promise<T> {
  let result: T;
  return environment
    .withSecurityRulesDisabled(async (context) => {
      result = await run(context.firestore() as unknown as Firestore);
    })
    .then(() => result);
}

const PARTICIPATIONS = [
  participation("StudyA2001", "lab-1"),
  participation("StudyA2001", "lab-2", LATE),
  participation("StudyA2001", "lab-3"),
  participation("StudyB2002", "lab-1", LATE),
];

beforeAll(async () => {
  environment = await createRulesEnvironment();
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await trusted(async (db) => {
    const writes = [
      ...PARTICIPATIONS.map((data) =>
        setDoc(
          doc(db, COLLECTIONS.participations.docPath(participationId(data.replicationId, data.laboratoryId))),
          data,
        ),
      ),
      setDoc(doc(db, "replications/StudyA2001/hypotheses/h01"), hypothesis("StudyA2001", 1, "verified")),
      setDoc(doc(db, "replications/StudyA2001/hypotheses/h02"), hypothesis("StudyA2001", 2, "unverified")),
      setDoc(doc(db, "replications/StudyB2002/hypotheses/h01"), hypothesis("StudyB2002", 1, "verified")),
      setDoc(doc(db, `users/${ACCOUNTS.owner.uid}`), user(ACCOUNTS.owner.email)),
      setDoc(doc(db, `access/${ACCOUNTS.owner.uid}`), { ...standard(), ...emptyAccess() }),
      setDoc(doc(db, `access/${ACCOUNTS.other.uid}`), { ...standard(), ...emptyAccess() }),
    ];
    await Promise.all(writes);
  });
});

describe("documentReference", () => {
  it("reads one document of any registry entry, validated and with its identifier", async () => {
    const record = await trusted(async (db) =>
      (await getDoc(documentReference(db, "participations", "StudyA2001__lab-1"))).data(),
    );
    expect(record).toMatchObject({ id: "StudyA2001__lab-1", replicationId: "StudyA2001", laboratoryId: "lab-1" });
    expect(record?.createdAt.toMillis()).toBe(EARLY.toMillis());

    const nested = await trusted(async (db) =>
      (await getDoc(documentReference(db, "replicationHypotheses", "StudyA2001", "h02"))).data(),
    );
    expect(nested).toMatchObject({ id: "h02", hypothesisNumber: "2", scientificReviewStatus: "unverified" });
  });

  it("gives no data for a document that does not exist", async () => {
    const snapshot = await trusted((db) => getDoc(documentReference(db, "participations", "StudyZ2009__lab-9")));
    expect(snapshot.exists()).toBe(false);
  });

  it("leaves out a field of a newer version, and refuses a document that does not match its schema", async () => {
    await trusted(async (db) => {
      await setDoc(doc(db, "participations/StudyA2001__lab-1"), {
        ...participation("StudyA2001", "lab-1"),
        addedLater: true,
      });
      await setDoc(doc(db, "participations/StudyA2001__lab-2"), {
        ...participation("StudyA2001", "lab-2"),
        status: "undecided",
      });
    });
    const tolerant = await trusted(async (db) =>
      (await getDoc(documentReference(db, "participations", "StudyA2001__lab-1"))).data(),
    );
    expect(tolerant).not.toHaveProperty("addedLater");
    expect(tolerant?.status).toBe("invited");

    const broken = await trusted((db) => getDoc(documentReference(db, "participations", "StudyA2001__lab-2")));
    expect(() => broken.data()).toThrow(DataShapeError);
  });

  it("goes through the security rules: an account reads its own profile and nobody else's", async () => {
    const own = documentReference(firestoreAs(environment, "owner"), "users", ACCOUNTS.owner.uid);
    const snapshot = await assertSucceeds(getDoc(own));
    expect(snapshot.data()).toMatchObject({ id: ACCOUNTS.owner.uid, emailLower: ACCOUNTS.owner.email });
    await assertFails(getDoc(documentReference(firestoreAs(environment, "other"), "users", ACCOUNTS.owner.uid)));
    await assertFails(getDoc(documentReference(firestoreAs(environment, "signedOut"), "users", ACCOUNTS.owner.uid)));
  });
});

describe("queryReference", () => {
  const idsOf = async <K extends ListableCollectionKey>(description: LiveQuery<K>) =>
    trusted(async (db) => (await getDocs(queryReference(db, description))).docs.map((snapshot) => snapshot.data().id));

  it("filters, orders and bounds a collection", async () => {
    expect(
      await idsOf({
        collection: "participations",
        within: [],
        where: [["replicationId", "==", "StudyA2001"]],
        orderBy: [["laboratoryId", "desc"]],
        limit: 2,
      }),
    ).toEqual(["StudyA2001__lab-3", "StudyA2001__lab-2"]);
  });

  it("limits a query to the scopes the caller holds", async () => {
    expect(
      await idsOf({
        collection: "participations",
        within: [],
        where: [["scopeKeys", "array-contains-any", ["rep:StudyB2002", "lab:lab-3"]]],
        orderBy: [["laboratoryId", "asc"]],
        limit: 10,
      }),
    ).toEqual(["StudyB2002__lab-1", "StudyA2001__lab-3"]);
  });

  it("compares a date with stored timestamps", async () => {
    expect(
      (
        await idsOf({
          collection: "participations",
          within: [],
          where: [["updatedAt", ">", new Date("2026-02-01T00:00:00Z")]],
          limit: 10,
        })
      ).sort(),
    ).toEqual(["StudyA2001__lab-2", "StudyB2002__lab-1"]);
  });

  it("reads a subcollection beneath one parent, or beneath every parent at once", async () => {
    expect(await idsOf({ collection: "replicationHypotheses", within: ["StudyA2001"], limit: 10 })).toEqual([
      "h01",
      "h02",
    ]);
    const verified = await trusted(async (db) =>
      (
        await getDocs(
          queryReference(db, {
            collection: "replicationHypotheses",
            within: "group",
            where: [["scientificReviewStatus", "==", "verified"]],
            limit: 10,
          }),
        )
      ).docs.map((snapshot) => `${snapshot.data().replicationId}/${snapshot.data().id}`),
    );
    expect(verified.sort()).toEqual(["StudyA2001/h01", "StudyB2002/h01"]);
  });

  it("validates every document of a result", async () => {
    await trusted((db) => setDoc(doc(db, "participations/StudyA2001__lab-9"), { status: "invited" }));
    const snapshot = await trusted((db) =>
      getDocs(queryReference(db, { collection: "participations", within: [], limit: 10 })),
    );
    expect(() => snapshot.docs.map((document) => document.data())).toThrow(DataShapeError);
  });

  it("refuses an unbounded query before it reaches Firestore", async () => {
    await trusted(async (db) => {
      expect(() => queryReference(db, { collection: "participations", within: [], limit: 0 })).toThrow(LiveQueryError);
    });
  });

  it("goes through the security rules: a collection that no rule opens cannot be listed", async () => {
    const db = firestoreAs(environment, "owner");
    await assertFails(getDocs(queryReference(db, { collection: "participations", within: [], limit: 10 })));
    await assertFails(getDocs(queryReference(db, { collection: "replicationHypotheses", within: "group", limit: 10 })));
  });
});

describe("collectionReference and collectionGroupReference", () => {
  it("address the collection of an entry by the identifiers of its ancestors", async () => {
    await trusted(async (db) => {
      expect(collectionReference(db, "participations").path).toBe("participations");
      expect(collectionReference(db, "replicationHypotheses", "StudyA2001").path).toBe(
        "replications/StudyA2001/hypotheses",
      );
      const all = await getDocs(collectionGroupReference(db, "replicationHypotheses"));
      expect(all.docs.map((snapshot) => snapshot.ref.path).sort()).toEqual([
        "replications/StudyA2001/hypotheses/h01",
        "replications/StudyA2001/hypotheses/h02",
        "replications/StudyB2002/hypotheses/h01",
      ]);
    });
  });
});
