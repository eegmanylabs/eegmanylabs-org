// Helpers shared by the red-team tests of the security rules. Each of those tests acts as a
// malicious but authenticated browser client: it reaches Firestore and Cloud Storage through the
// client SDK alone, and trusted code is used only to put documents in place beforehand.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain.
import { COLLECTIONS, type CollectionKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import type { Outcome } from "../attempts";
import { FIXTURES } from "../fixtures";
import type { Actor, Expectations } from "../requests";
import { pathOf, trusted } from "../seed";
import {
  type AccountSpec,
  type CallerKind,
  type CallerProfile,
  firestoreWithToken,
  resolveSyntheticAccess,
  stored,
  tokenOf,
} from "../world";

type Request = () => Promise<unknown>;

/**
 * The callers who have no tie to the owning replication or the owning laboratory of the world
 * and hold no power of the programme in their session. Whatever is restricted to those units,
 * to their people or to the programme is refused to every one of them.
 *
 * | Caller               | Starting point of the attack                                         |
 * |----------------------|----------------------------------------------------------------------|
 * | `noMembership`       | A signed-in account with no membership                               |
 * | `suspended`          | A suspended member, whose access document still lists two roles      |
 * | `member`             | An ordinary member                                                   |
 * | `otherLabMember`     | A member of another laboratory                                       |
 * | `otherCoordinator`   | A coordinator of another laboratory                                  |
 * | `otherLead`          | A lead of another replication                                        |
 * | `adminWithoutFactor` | A programme administrator who signed in without the required factor |
 */
export const OUTSIDERS = [
  "noMembership",
  "suspended",
  "member",
  "otherLabMember",
  "otherCoordinator",
  "otherLead",
  "adminWithoutFactor",
] as const satisfies readonly CallerKind[];

/** The callers who belong to the owning units without managing them. */
export const INSIDERS_WITHOUT_MANAGEMENT = ["ownLabMember", "ownTeam"] as const satisfies readonly CallerKind[];

/** Every signed-in caller who is no programme administrator with a verified second factor. */
export const EVERYONE_BELOW_ADMIN = [
  ...OUTSIDERS,
  ...INSIDERS_WITHOUT_MANAGEMENT,
  "owner",
  "ownCoordinator",
  "ownLead",
  "coreTeam",
] as const satisfies readonly CallerKind[];

/** Every signed-in caller of the world, the programme administrator with a verified factor included. */
export const EVERYONE = [...EVERYONE_BELOW_ADMIN, "admin"] as const satisfies readonly CallerKind[];

/** The path of the stored document of an enforced entry of the registry. */
export function storedPath(key: CollectionKey): string {
  const fixture = FIXTURES[key];
  if (fixture === undefined) throw new Error(`The world stores no document for the entry "${key}".`);
  return pathOf(COLLECTIONS[key], fixture.ids);
}

/** The document that a client would send to create a record of an entry, without the standard fields. */
export function newRecord(key: CollectionKey, uid: string): Record<string, unknown> {
  const creation = FIXTURES[key]?.create;
  if (creation === undefined) throw new Error(`The fixture of "${key}" creates no document.`);
  return creation.data(uid);
}

/** One row of a table for each caller: the same request, with the same answer. */
export function forEach<Kind extends CallerKind>(
  callers: readonly Kind[],
  expected: Outcome,
  what: string,
  request: (caller: Kind) => Request,
): Expectations {
  return Object.fromEntries(callers.map((caller) => [`${caller}: ${what}`, [expected, request(caller)] as const]));
}

/** Writes documents with the rules switched off, as trusted code would. */
export async function seed(
  environment: RulesTestEnvironment,
  documents: Readonly<Record<string, Record<string, unknown>>>,
): Promise<void> {
  await trusted(environment, async (db) => {
    await Promise.all(Object.entries(documents).map(([path, data]) => setDoc(doc(db, path), data)));
  });
}

/**
 * An account that is no caller of the world, with the access document that its roles resolve
 * to, stored as trusted code stores it, and a client that carries its sign-in token.
 */
export async function account(environment: RulesTestEnvironment, name: string, spec: AccountSpec): Promise<Actor> {
  const uid = `uid-redteam-${name}`;
  const access = resolveSyntheticAccess(uid, spec);
  await seed(environment, { [`access/${uid}`]: { ...stored(), ...access } });
  const profile: CallerProfile = {
    kind: "member",
    uid,
    email: `redteam.${name}@example.org`,
    access,
    secondFactor: spec.secondFactor ?? false,
  };
  return { db: firestoreWithToken(environment, uid, tokenOf(profile)), uid };
}
