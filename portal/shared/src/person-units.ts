// Which member entries and memberships count towards the units that the directory document of
// a person names (docs/DATA_MODEL.md, section 14: `persons.laboratoryIds` and
// `persons.replicationIds`).
//
// Leads and coordinators read the contact details of the people whose directory document names
// their unit. An entry that a lead or a coordinator adds starts unconfirmed, and only the person
// concerned or an administrator confirms it, so nobody gains sight of an address by adding a
// person to their own unit. An archived entry counts for nothing either. The trigger that
// derives the two arrays, the functions that confirm an entry and `seed:demo` all decide with
// the functions of this file.

type Stored = Readonly<Record<string, unknown>> | null | undefined;

const inForce = (entry: Stored): entry is Readonly<Record<string, unknown>> =>
  entry !== null && entry !== undefined && (entry.archivedAt === null || entry.archivedAt === undefined);

/** Whether a member entry of a laboratory puts the laboratory on the person: confirmed and not archived. */
export function memberEntryCounts(entry: Stored): boolean {
  return inForce(entry) && entry.status === "confirmed";
}

/** Whether a membership puts its replication on the person: confirmed, current and not archived. */
export function membershipCounts(membership: Stored): boolean {
  return inForce(membership) && membership.reviewStatus === "confirmed" && membership.isCurrent === true;
}

/** A list of unit identifiers with one of them present or absent, sorted and free of duplicates. */
export function withUnit(ids: readonly string[], id: string, present: boolean): string[] {
  const others = ids.filter((existing) => existing !== id);
  return [...new Set(present ? [...others, id] : others)].sort();
}

/** Whether two lists of unit identifiers name the same units. */
export function sameUnits(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
