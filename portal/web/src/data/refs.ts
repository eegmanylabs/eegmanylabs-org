// Typed references to the documents and collections of the collection registry. Paths, shapes
// and converters all come from @eegml/shared, so this file contains no collection name and no
// field name, and every registry entry is served by the same four functions.
//
// Each function takes the Firestore instance as its first argument, so that the same code runs
// in the browser and in tests against the emulator. live.ts supplies the application's instance.
import {
  COLLECTIONS,
  type CollectionKey,
  type CollectionPathIds,
  type DocPathIds,
  type ListableCollectionKey,
} from "@eegml/shared";
import {
  type CollectionReference,
  collection,
  collectionGroup,
  type DocumentData,
  type DocumentReference,
  doc,
  type Firestore,
  limit,
  orderBy,
  type Query,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { converterOf, type RecordOf } from "./converter";
import { assertValidLiveQuery, type LiveQuery, type QueryValue } from "./query-spec";

type PathBuilder = (...ids: readonly string[]) => string;

/** A reference to one document of a registry entry. */
export function documentReference<K extends CollectionKey>(
  db: Firestore,
  key: K,
  ...ids: DocPathIds<K>
): DocumentReference<RecordOf<K>, DocumentData> {
  return doc(db, (COLLECTIONS[key].docPath as PathBuilder)(...ids)).withConverter(converterOf(key));
}

/** A reference to the collection of a registry entry beneath the given ancestors. */
export function collectionReference<K extends ListableCollectionKey>(
  db: Firestore,
  key: K,
  ...ids: CollectionPathIds<K>
): CollectionReference<RecordOf<K>, DocumentData> {
  return collection(db, (COLLECTIONS[key].collectionPath as PathBuilder)(...ids)).withConverter(converterOf(key));
}

/** The collection of a registry entry beneath every parent at once. */
export function collectionGroupReference<K extends ListableCollectionKey>(
  db: Firestore,
  key: K,
): Query<RecordOf<K>, DocumentData> {
  return collectionGroup(db, COLLECTIONS[key].collectionId).withConverter(converterOf(key));
}

const stored = (value: QueryValue) => (value instanceof Date ? Timestamp.fromDate(value) : value);

/** The Firestore query that a description asks for. */
export function queryReference<K extends ListableCollectionKey>(
  db: Firestore,
  description: LiveQuery<K>,
): Query<RecordOf<K>, DocumentData> {
  assertValidLiveQuery(description);
  const base =
    description.within === "group"
      ? collectionGroupReference(db, description.collection)
      : collectionReference(db, description.collection, ...description.within);
  return query(
    base,
    ...(description.where ?? []).map(([field, operator, value]) => where(field, operator, stored(value))),
    ...(description.orderBy ?? []).map(([field, direction]) => orderBy(field, direction)),
    limit(description.limit),
  );
}
