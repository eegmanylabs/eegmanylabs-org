// Red-team attacks that use a batch or a transaction: hiding a forbidden write among allowed
// ones, forging a document in the same batch that creates it, removing a record and writing it
// afresh, and filling a batch with writes whose rules read more documents than one request may,
// so that a rule which errors might let something through.
//
// Every test states the secure behaviour: a batch with a forbidden write is refused as a whole
// and leaves nothing behind, whatever else it holds.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain.
import { participationId, unitScopeKeys } from "@eegml/shared";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, runTransaction, serverTimestamp, writeBatch } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import {
  createdBy,
  MEMBER_PERSON,
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_REPLICATION,
  stored,
  updatedBy,
} from "../world";
import { arena, LABORATORY, PARTICIPATION, REPLICATION } from "./integrity-and-audit-support";

const lab = arena("batches");

/** More laboratories than the documents that the rules may read for one batch. */
const MANY = 30;
const batchLaboratory = (index: number) => `lab-synthetic-batch-${String(index).padStart(2, "0")}`;

const participation = (replicationId: string, laboratoryId: string) => ({
  replicationId,
  laboratoryId,
  scopeKeys: unitScopeKeys(replicationId, laboratoryId),
  status: "invited",
  statusHistoryId: null,
  readinessStatus: "notStarted",
  custom: {},
  dataOrigin: "live",
});

async function plantLaboratories(): Promise<void> {
  await lab.plant(
    Object.fromEntries(
      Array.from({ length: MANY }, (_, index) => [
        `laboratories/${batchLaboratory(index)}`,
        {
          ...stored(),
          slug: batchLaboratory(index),
          name: `Synthetic batch laboratory ${index}`,
          status: "active",
          custom: {},
          dataOrigin: "demo",
        },
      ]),
    ),
  );
}

async function writtenParticipations(): Promise<number> {
  let written = 0;
  for (let index = 0; index < MANY; index += 1) {
    const path = `participations/${participationId(OWN_REPLICATION, batchLaboratory(index))}`;
    if ((await lab.stored(path)) !== null) written += 1;
  }
  return written;
}

describe("a batch of writes", () => {
  it("is refused as a whole where one write is forbidden, and leaves nothing behind", async () => {
    const db = lab.db("ownLead");
    const stamp = updatedBy(lab.uid("ownLead"));
    const batch = writeBatch(db);
    batch.update(doc(db, REPLICATION), { shortTitle: "Renamed in a batch", ...stamp });
    batch.update(doc(db, `replications/${OTHER_REPLICATION}`), { shortTitle: "Renamed by an outsider", ...stamp });
    await assertFails(batch.commit());
    expect((await lab.stored(REPLICATION))?.shortTitle).not.toBe("Renamed in a batch");

    const honest = writeBatch(db);
    honest.update(doc(db, REPLICATION), { shortTitle: "Renamed in a batch", ...stamp });
    await assertSucceeds(honest.commit());
  });

  it("does not let a later write forge the document that an earlier write of the batch created", async () => {
    const db = lab.db("member");
    const uid = lab.uid("member");
    const favourite = doc(db, `users/${uid}/favourites/replication__${OWN_REPLICATION}`);
    const batch = writeBatch(db);
    batch.set(favourite, { uid, entityType: "replication", entityId: OWN_REPLICATION, ...createdBy(uid) });
    batch.update(favourite, { createdBy: "uid-owner", createdAt: new Date("2020-01-01T00:00:00Z") });
    await assertFails(batch.commit());
    expect(await lab.stored(favourite.path)).toBeNull();
  });

  it("does not remove a core record and write it afresh under the attacker's name", async () => {
    const db = lab.db("ownCoordinator");
    const uid = lab.uid("ownCoordinator");
    const batch = writeBatch(db);
    batch.delete(doc(db, PARTICIPATION));
    batch.set(doc(db, PARTICIPATION), { ...participation(OWN_REPLICATION, OWN_LABORATORY), ...createdBy(uid) });
    await assertFails(batch.commit());
    expect((await lab.stored(PARTICIPATION))?.createdBy).toBe("system:import");
  });

  it("does not create a participation together with what only a function writes beneath or beside it", async () => {
    const db = lab.db("ownCoordinator");
    const uid = lab.uid("ownCoordinator");
    const id = participationId(OTHER_REPLICATION, OWN_LABORATORY);
    const fields = participation(OTHER_REPLICATION, OWN_LABORATORY);
    const scope = {
      replicationId: OTHER_REPLICATION,
      laboratoryId: OWN_LABORATORY,
      scopeKeys: unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY),
    };
    const withChecklist = writeBatch(db);
    withChecklist.set(doc(db, `participations/${id}`), { ...fields, status: "interested", ...createdBy(uid) });
    withChecklist.set(doc(db, `participations/${id}/checklist/ethics`), {
      participationId: id,
      templateKey: "onboarding",
      templateItemKey: "ethics",
      label: "Ethics approval",
      status: "done",
      completedBy: uid,
      completedAt: serverTimestamp(),
      position: 1,
      ...scope,
      ...createdBy(uid),
    });
    await assertFails(withChecklist.commit());

    const withHistory = writeBatch(db);
    withHistory.set(doc(db, `participations/${id}`), {
      ...fields,
      status: "collecting",
      statusHistoryId: "history-red-team",
      ...createdBy(uid),
    });
    withHistory.set(doc(db, "statusHistory/history-red-team"), {
      entityType: "participation",
      entityId: id,
      fromStatusKey: null,
      toStatusKey: "collecting",
      effectiveAt: serverTimestamp(),
      recordedAt: serverTimestamp(),
      changedBy: uid,
      source: "manual",
      ...scope,
      ...createdBy(uid, true),
    });
    await assertFails(withHistory.commit());
    expect(await lab.stored(`participations/${id}`)).toBeNull();
  });

  it("does not add a team member to a participation that the same batch has yet to create for other units", async () => {
    // The rules read the stored participation, so a child cannot borrow the scope of a parent
    // that exists only in the request.
    const db = lab.db("ownLead");
    const uid = lab.uid("ownLead");
    const id = participationId(OTHER_REPLICATION, OTHER_LABORATORY);
    const batch = writeBatch(db);
    batch.set(doc(db, `participations/${id}/teamMembers/${MEMBER_PERSON}`), {
      participationId: id,
      personId: MEMBER_PERSON,
      role: "analyst",
      replicationId: OWN_REPLICATION,
      laboratoryId: OTHER_LABORATORY,
      scopeKeys: unitScopeKeys(OWN_REPLICATION, OTHER_LABORATORY),
      ...createdBy(uid),
    });
    await assertFails(batch.commit());
  });
});

describe("a transaction", () => {
  it("is refused where it reads a record and writes it back in the name of someone else", async () => {
    const db = lab.db("ownCoordinator");
    await assertFails(
      runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(doc(db, LABORATORY));
        transaction.update(doc(db, LABORATORY), {
          city: `${String(snapshot.get("name"))} Town`,
          updatedBy: "uid-owner",
          updatedAt: serverTimestamp(),
          writeContext: snapshot.get("writeContext"),
        });
      }),
    );
    expect((await lab.stored(LABORATORY))?.updatedBy).toBe("system:import");
  });
});

describe("a batch whose rules read more documents than one request may", () => {
  const manyParticipations = (count: number) => {
    const db = lab.db("ownLead");
    const uid = lab.uid("ownLead");
    const batch = writeBatch(db);
    for (let index = 0; index < count; index += 1) {
      const laboratoryId = batchLaboratory(index);
      batch.set(doc(db, `participations/${participationId(OWN_REPLICATION, laboratoryId)}`), {
        ...participation(OWN_REPLICATION, laboratoryId),
        ...createdBy(uid),
      });
    }
    return batch;
  };

  it("is refused as a whole, although every write in it is one the lead may make", async () => {
    // The rules read the access document, the replication and one laboratory for each
    // participation: thirty-two documents, where a batch may read twenty. The rule errors, and
    // an error refuses.
    await plantLaboratories();
    await assertFails(manyParticipations(MANY).commit());
    expect(await writtenParticipations()).toBe(0);
  });

  it("is accepted as a whole at the limit of twenty documents", async () => {
    await plantLaboratories();
    await assertSucceeds(manyParticipations(18).commit());
    expect(await writtenParticipations()).toBe(18);
  });

  it.each([
    ["last", MANY],
    ["first", 0],
    ["in the middle", MANY / 2],
  ] as const)("is refused where a forbidden write hides among the allowed ones: %s", async (_position, position) => {
    await plantLaboratories();
    const db = lab.db("ownLead");
    const uid = lab.uid("ownLead");
    const batch = writeBatch(db);
    const forbidden = () => {
      // A team member beneath the participation of other units, with scope fields that name the
      // attacker's own, so that only the document the rule reads can tell.
      const id = participationId(OTHER_REPLICATION, OTHER_LABORATORY);
      batch.set(doc(db, `participations/${id}/teamMembers/${MEMBER_PERSON}`), {
        participationId: id,
        personId: MEMBER_PERSON,
        role: "localLead",
        replicationId: OWN_REPLICATION,
        laboratoryId: OWN_LABORATORY,
        scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
        ...createdBy(uid),
      });
    };
    await lab.plant({
      [`participations/${participationId(OTHER_REPLICATION, OTHER_LABORATORY)}`]: {
        ...stored(),
        ...participation(OTHER_REPLICATION, OTHER_LABORATORY),
        dataOrigin: "demo",
      },
    });
    for (let index = 0; index < MANY; index += 1) {
      if (index === position) forbidden();
      const laboratoryId = batchLaboratory(index);
      batch.set(doc(db, `participations/${participationId(OWN_REPLICATION, laboratoryId)}`), {
        ...participation(OWN_REPLICATION, laboratoryId),
        ...createdBy(uid),
      });
    }
    if (position === MANY) forbidden();
    await assertFails(batch.commit());
    expect(await writtenParticipations()).toBe(0);
    expect(
      await lab.stored(
        `participations/${participationId(OTHER_REPLICATION, OTHER_LABORATORY)}/teamMembers/${MEMBER_PERSON}`,
      ),
    ).toBeNull();
  });

  it("is refused where the last of many allowed writes changes a status that only a function changes", async () => {
    await plantLaboratories();
    const db = lab.db("ownLead");
    const uid = lab.uid("ownLead");
    const batch = writeBatch(db);
    for (let index = 0; index < MANY; index += 1) {
      const laboratoryId = batchLaboratory(index);
      batch.set(doc(db, `participations/${participationId(OWN_REPLICATION, laboratoryId)}`), {
        ...participation(OWN_REPLICATION, laboratoryId),
        ...createdBy(uid),
      });
    }
    batch.update(doc(db, REPLICATION), { statusKey: "published", ...updatedBy(uid) });
    await assertFails(batch.commit());
    expect(await writtenParticipations()).toBe(0);
    expect((await lab.stored(REPLICATION))?.statusKey).toBe("planning");
  });
});
