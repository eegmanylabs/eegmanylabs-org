// A stand-in for the few reads that the resolvers of the import framework make, so that their
// rules can be tested without an emulator. It holds documents by path and answers `doc().get()`
// and, for the documents directly beneath a collection, `collection().where(field, "==", value).get()`.
import type { Firestore } from "firebase-admin/firestore";

export interface FakeFirestore {
  readonly db: Firestore;
  /** The paths that were read, in order. */
  readonly reads: string[];
}

export function fakeFirestore(documents: Readonly<Record<string, Readonly<Record<string, unknown>>>>): FakeFirestore {
  const reads: string[] = [];
  const snapshot = (path: string) => {
    const data = documents[path];
    return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] };
  };
  const db = {
    doc: (path: string) => ({
      path,
      get: async () => {
        reads.push(path);
        return snapshot(path);
      },
    }),
    collection: (collectionPath: string) => ({
      where: (field: string, operator: string, value: unknown) => ({
        get: async () => {
          if (operator !== "==") throw new Error(`The fake database answers equality filters only, not ${operator}.`);
          reads.push(collectionPath);
          const docs = Object.keys(documents)
            .filter(
              (path) =>
                path.startsWith(`${collectionPath}/`) &&
                !path.slice(collectionPath.length + 1).includes("/") &&
                documents[path]?.[field] === value,
            )
            .sort()
            .map(snapshot);
          return { docs, empty: docs.length === 0 };
        },
      }),
    }),
  };
  return { db: db as unknown as Firestore, reads };
}
