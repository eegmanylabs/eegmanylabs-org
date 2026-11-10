import { COLLECTIONS, type CollectionKey, type DocOf, parseStoredDocument, type z } from "@eegml/shared";
import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
} from "firebase/firestore";

/** A stored document together with its identifier. */
export type WithId<T> = T & { readonly id: string };

/** A document of a registry entry as the application sees it: validated, with its identifier. */
export type RecordOf<K extends CollectionKey> = WithId<DocOf<K>>;

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
 * Every document read through it is validated, so components never see unchecked data. A field
 * that the schema does not know is left out, so a document written by a newer version of the
 * portal can still be read. Everything else that does not fit is an error.
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
      const parsed = parseStoredDocument(schema, snapshot.data({ ...options, serverTimestamps: "estimate" }));
      if (!parsed.success) {
        const fields = parsed.error.issues.map((issue) => issue.path.join("."));
        throw new DataShapeError(kind, snapshot.ref.path, fields);
      }
      return { ...parsed.data, id: snapshot.id };
    },
  };
}

const converters = new Map<CollectionKey, FirestoreDataConverter<WithId<Record<string, unknown>>, DocumentData>>();

/**
 * The converter of a registry entry, built from its schema. There is one for every entry of
 * the collection registry, so no collection needs a converter written by hand.
 */
export function converterOf<K extends CollectionKey>(key: K): FirestoreDataConverter<RecordOf<K>, DocumentData> {
  let converter = converters.get(key);
  if (converter === undefined) {
    converter = schemaConverter(key, COLLECTIONS[key].schema);
    converters.set(key, converter);
  }
  return converter as unknown as FirestoreDataConverter<RecordOf<K>, DocumentData>;
}
