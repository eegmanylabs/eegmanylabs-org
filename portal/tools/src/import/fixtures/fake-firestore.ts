// A stand-in for the few reads that the resolvers of the import framework make, so that their
// rules can be tested without an emulator. It holds documents by path and answers `doc().get()`.
import type { Firestore } from "firebase-admin/firestore";

export interface FakeFirestore {
  readonly db: Firestore;
  /** The paths that were read, in order. */
  readonly reads: string[];
}

export function fakeFirestore(documents: Readonly<Record<string, Readonly<Record<string, unknown>>>>): FakeFirestore {
  const reads: string[] = [];
  const db = {
    doc: (path: string) => ({
      path,
      get: async () => {
        reads.push(path);
        const data = documents[path];
        return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] };
      },
    }),
  };
  return { db: db as unknown as Firestore, reads };
}
