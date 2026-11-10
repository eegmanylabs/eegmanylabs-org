import type { z } from "@eegml/shared";
import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
} from "firebase/firestore";

/** A stored document together with its identifier. */
export type WithId<T> = T & { readonly id: string };

/**
 * Raised when a stored document does not match its schema. It carries the path and the names
 * of the fields that were wrong, never their values.
 */
export class DataShapeError extends Error {
  override readonly name = "DataShapeError";
  readonly code = "data/invalid-shape";

  constructor(
    readonly kind: string,
    readonly path: string,
    readonly fields: readonly string[],
  ) {
    super(`The ${kind} at ${path} does not have the expected shape (${fields.join(", ") || "document"}).`);
  }
}

/**
 * Builds a Firestore converter from a zod schema in @eegml/shared.
 * Every document read through it is validated, so components never see unchecked data.
 */
export function schemaConverter<Schema extends z.ZodType<Record<string, unknown>>>(
  kind: string,
  schema: Schema,
): FirestoreDataConverter<WithId<z.output<Schema>>, DocumentData> {
  return {
    toFirestore(model: WithFieldValue<WithId<z.output<Schema>>>): DocumentData {
      const { id: _id, ...fields } = model as DocumentData;
      return fields;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions) {
      // "estimate" gives a pending server timestamp a local value, so a document that has just
      // been written locally validates as well.
      const parsed = schema.safeParse(snapshot.data({ ...options, serverTimestamps: "estimate" }));
      if (!parsed.success) {
        const fields = parsed.error.issues.map((issue) => issue.path.join("."));
        throw new DataShapeError(kind, snapshot.ref.path, fields);
      }
      return { ...parsed.data, id: snapshot.id };
    },
  };
}
