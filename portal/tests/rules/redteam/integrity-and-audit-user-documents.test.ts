// Red-team attacks on the documents beneath a user: reading and overwriting the favourites,
// recents, subscriptions, settings, notifications, login profile, access document and claim of
// someone else, from each of the five attackers, and forging one's own notifications.
//
// Every test states the secure behaviour: the request is refused.
// Everything here is synthetic: fictitious accounts on the example.org domain.
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { createdBy, OWN_LABORATORY, OWN_REPLICATION, OWNER_PERSON, OWNER_UID, stored, updatedBy } from "../world";
import { ATTACKERS, arena } from "./integrity-and-audit-support";

const lab = arena("user-documents");

const VICTIM = `users/${OWNER_UID}`;
const REFERENCE = `replication__${OWN_REPLICATION}`;
const SUBCOLLECTIONS = ["favourites", "recents", "notifications", "subscriptions", "settings"] as const;

describe.each(ATTACKERS)("the documents of another user, attacked by: %s", (attacker) => {
  const db = () => lab.db(attacker);
  const uid = () => lab.uid(attacker);

  it("are not read, one by one", async () => {
    for (const path of [
      VICTIM,
      `${VICTIM}/favourites/${REFERENCE}`,
      `${VICTIM}/recents/${REFERENCE}`,
      `${VICTIM}/notifications/notification-1`,
      `${VICTIM}/subscriptions/${REFERENCE}`,
      `${VICTIM}/settings/preferences`,
      `access/${OWNER_UID}`,
      `accountClaims/${OWNER_UID}`,
    ]) {
      await assertFails(getDoc(doc(db(), path)));
    }
  });

  it("are not listed, beneath the user or across every user", async () => {
    for (const name of SUBCOLLECTIONS) {
      await assertFails(getDocs(query(collection(db(), `${VICTIM}/${name}`), limit(5))));
      await assertFails(getDocs(query(collectionGroup(db(), name), limit(5))));
      await assertFails(getDocs(query(collectionGroup(db(), name), where("uid", "==", OWNER_UID), limit(5))));
      // A list that names the attacker's own uid proves nothing about where a document sits.
      await assertFails(getDocs(query(collectionGroup(db(), name), where("uid", "==", uid()), limit(5))));
    }
    await assertFails(getDocs(query(collection(db(), "users"), limit(5))));
    await assertFails(getDocs(query(collection(db(), "access"), limit(5))));
    await assertFails(getDocs(query(collection(db(), "accountClaims"), limit(5))));
  });

  it("are not overwritten, changed or removed", async () => {
    const stamp = () => updatedBy(uid());
    const reference = { entityType: "laboratory", entityId: OWN_LABORATORY };
    const added = `laboratory__${OWN_LABORATORY}`;
    for (const name of ["favourites", "recents"] as const) {
      // In the name of the victim, and in the attacker's own name beneath the victim.
      await assertFails(
        setDoc(doc(db(), `${VICTIM}/${name}/${added}`), { uid: OWNER_UID, ...reference, ...createdBy(uid()) }),
      );
      await assertFails(
        setDoc(doc(db(), `${VICTIM}/${name}/${added}`), { uid: OWNER_UID, ...reference, ...createdBy(OWNER_UID) }),
      );
      await assertFails(
        setDoc(doc(db(), `${VICTIM}/${name}/${added}`), { uid: uid(), ...reference, ...createdBy(uid()) }),
      );
      await assertFails(updateDoc(doc(db(), `${VICTIM}/${name}/${REFERENCE}`), { ...stamp() }));
      await assertFails(updateDoc(doc(db(), `${VICTIM}/${name}/${REFERENCE}`), { uid: uid(), ...stamp() }));
      await assertFails(
        updateDoc(doc(db(), `${VICTIM}/${name}/${REFERENCE}`), { archivedAt: serverTimestamp(), ...stamp() }),
      );
      await assertFails(deleteDoc(doc(db(), `${VICTIM}/${name}/${REFERENCE}`)));
    }
    await assertFails(
      setDoc(doc(db(), `${VICTIM}/subscriptions/${added}`), {
        uid: OWNER_UID,
        ...reference,
        level: "all",
        ...createdBy(uid()),
      }),
    );
    await assertFails(updateDoc(doc(db(), `${VICTIM}/subscriptions/${REFERENCE}`), { level: "none", ...stamp() }));
    await assertFails(deleteDoc(doc(db(), `${VICTIM}/subscriptions/${REFERENCE}`)));
    await assertFails(
      updateDoc(doc(db(), `${VICTIM}/settings/preferences`), { channels: { inApp: false, email: false }, ...stamp() }),
    );
    await assertFails(
      setDoc(doc(db(), `${VICTIM}/settings/preferences`), {
        channels: { inApp: false, email: false },
        digestFrequency: "off",
        quietHours: null,
        typeSwitches: {},
        ...createdBy(uid()),
      }),
    );
    await assertFails(deleteDoc(doc(db(), `${VICTIM}/settings/preferences`)));
    await assertFails(
      updateDoc(doc(db(), `${VICTIM}/notifications/notification-1`), { readAt: serverTimestamp(), ...stamp() }),
    );
    await assertFails(deleteDoc(doc(db(), `${VICTIM}/notifications/notification-1`)));
    for (const name of SUBCOLLECTIONS) {
      expect(
        await lab.stored(
          `${VICTIM}/${name}/${name === "notifications" ? "notification-1" : name === "settings" ? "preferences" : REFERENCE}`,
        ),
      ).not.toBeNull();
    }
  });

  it("gain nothing from a document of the attacker that names the victim", async () => {
    const own = `users/${uid()}`;
    // A favourite beneath the attacker that says it belongs to the victim.
    await assertFails(
      setDoc(doc(db(), `${own}/favourites/${REFERENCE}`), {
        uid: OWNER_UID,
        entityType: "replication",
        entityId: OWN_REPLICATION,
        ...createdBy(uid()),
      }),
    );
    // A favourite whose identifier names another record than its fields.
    await assertFails(
      setDoc(doc(db(), `${own}/favourites/person__${OWNER_PERSON}`), {
        uid: uid(),
        entityType: "replication",
        entityId: OWN_REPLICATION,
        ...createdBy(uid()),
      }),
    );
    await assertSucceeds(
      setDoc(doc(db(), `${own}/favourites/${REFERENCE}`), {
        uid: uid(),
        entityType: "replication",
        entityId: OWN_REPLICATION,
        ...createdBy(uid()),
      }),
    );
    await assertFails(updateDoc(doc(db(), `${own}/favourites/${REFERENCE}`), { uid: OWNER_UID, ...updatedBy(uid()) }));
    await assertFails(
      updateDoc(doc(db(), `${own}/favourites/${REFERENCE}`), { entityId: "AnotherStudy1999", ...updatedBy(uid()) }),
    );
  });

  it("does not forge, rewrite or remove its own notifications, or write its own profile, access or claim", async () => {
    const own = `users/${uid()}`;
    const notification = `${own}/notifications/notification-own`;
    await lab.plant({
      [notification]: {
        ...stored(),
        uid: uid(),
        type: "roleDecision",
        entityType: "user",
        entityId: uid(),
        eventId: "event-2",
        payload: { decision: "rejected" },
        readAt: null,
        emailedAt: null,
      },
    });
    const stamp = () => updatedBy(uid());
    await assertFails(updateDoc(doc(db(), notification), { payload: { decision: "approved" }, ...stamp() }));
    await assertFails(updateDoc(doc(db(), notification), { type: "milestone", ...stamp() }));
    await assertFails(updateDoc(doc(db(), notification), { readAt: Timestamp.fromMillis(0), ...stamp() }));
    await assertFails(updateDoc(doc(db(), notification), { readAt: "yesterday", ...stamp() }));
    await assertFails(updateDoc(doc(db(), notification), { emailedAt: serverTimestamp(), ...stamp() }));
    await assertFails(updateDoc(doc(db(), notification), { archivedAt: serverTimestamp(), ...stamp() }));
    await assertFails(updateDoc(doc(db(), notification), { readAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db(), notification)));
    await assertFails(
      setDoc(doc(db(), `${own}/notifications/notification-forged`), {
        uid: uid(),
        type: "roleDecision",
        entityType: "user",
        entityId: uid(),
        eventId: "event-3",
        payload: { decision: "approved" },
        readAt: null,
        emailedAt: null,
        ...createdBy(uid()),
      }),
    );
    await assertSucceeds(updateDoc(doc(db(), notification), { readAt: serverTimestamp(), ...stamp() }));
    await assertSucceeds(updateDoc(doc(db(), notification), { readAt: null, ...stamp() }));
    await assertFails(setDoc(doc(db(), `${own}/settings/another-document`), { anything: true, ...createdBy(uid()) }));
    await assertFails(setDoc(doc(db(), `${own}/secrets/token`), { anything: true, ...createdBy(uid()) }));
    await assertFails(setDoc(doc(db(), own), { status: "active", mfaEnrolled: true }, { merge: true }));
    await assertFails(setDoc(doc(db(), `access/${uid()}`), { member: true, suspended: false }, { merge: true }));
    await assertFails(deleteDoc(doc(db(), `access/${uid()}`)));
    await assertFails(setDoc(doc(db(), `accountClaims/${uid()}`), { status: "approved" }, { merge: true }));
  });
});
