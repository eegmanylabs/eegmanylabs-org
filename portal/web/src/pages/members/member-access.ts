// What the member page asks for, decided from the access document the way the security rules
// and the functions decide it, so that the page never asks for what the account may not read.
// The rules and the functions refuse whatever the page asks; this only spares the request.
import type { RecordOf } from "@/data";
import type { Viewer } from "@/registry/viewer";

type Person = Pick<RecordOf<"persons">, "userId" | "replicationIds" | "laboratoryIds">;

/** Whether the account may read the restricted contact document of a person. */
export function readsContactOf(viewer: Viewer, person: Person): boolean {
  if (viewer.access.suspended) return false;
  if (person.userId === viewer.uid) return true;
  if (!viewer.access.member) return false;
  return (
    viewer.can("people.contact.read", "programme") ||
    viewer.access.contactReplicationIds.some((id) => person.replicationIds.includes(id)) ||
    viewer.access.contactLaboratoryIds.some((id) => person.laboratoryIds.includes(id))
  );
}

/**
 * Whether the page offers the special-category details of a person: to the person, and to a
 * holder of `demographics.read` whose second factor is satisfied. The function that serves them
 * also asks for a named grant, and refuses without one.
 */
export function offersDemographicsOf(viewer: Viewer, person: Person): boolean {
  if (viewer.access.suspended) return false;
  return person.userId === viewer.uid || viewer.can("demographics.read", "programme");
}

/** Whether the account may edit the profile addresses of a person: the person, or a holder of `people.manage`. */
export function editsLinksOf(viewer: Viewer, person: Person): boolean {
  if (viewer.access.suspended || !viewer.access.member) return false;
  return person.userId === viewer.uid || viewer.can("people.manage", "programme");
}
