// The members who may be mentioned in a page or a comment: the people of the directory who have
// claimed an account, by the uid of that account, which is what a mention and its notification
// name. Every member reads the directory, so this reads nothing the reader may not see.
import { useMemo } from "react";
import type { MentionCandidate } from "@/editor/PageEditor";
import { ALL_PERSONS, useDirectoryItems } from "@/registry/queries";

export type { MentionCandidate };

export interface Members {
  readonly candidates: readonly MentionCandidate[];
  /** The name of the member behind an account, or null where the directory does not know it. */
  nameOf(uid: string): string | null;
}

export function useMembers(load: boolean): Members {
  const persons = useDirectoryItems(load ? ALL_PERSONS : null);
  return useMemo(() => {
    const candidates =
      persons.status === "ready"
        ? persons.data
            .flatMap((person) =>
              person.userId === null || person.archivedAt !== null
                ? []
                : [{ uid: person.userId, name: person.displayName }],
            )
            .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
        : [];
    const names = new Map(candidates.map((candidate) => [candidate.uid, candidate.name]));
    return { candidates, nameOf: (uid: string) => names.get(uid) ?? null };
  }, [persons]);
}
