// A live query as data. Routes and components describe what they want to read in these terms
// and never touch the Firebase SDK. A description is also what identifies a query in the
// subscription cache: two components that describe the same query share one listener.
import type { CollectionPathIds, DocOf, ListableCollectionKey } from "@eegml/shared";

/** The name of a top-level field of the documents of a collection. */
export type FieldOf<K extends ListableCollectionKey> = Extract<keyof DocOf<K>, string>;

export type QueryOperator =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not-in"
  | "array-contains"
  | "array-contains-any";

/** A value to compare a field with. A `Date` is compared with stored timestamps. */
export type QueryValue = string | number | boolean | null | Date | readonly (string | number)[];

export type QueryFilter<K extends ListableCollectionKey> = readonly [
  field: FieldOf<K>,
  operator: QueryOperator,
  value: QueryValue,
];
export type QueryOrder<K extends ListableCollectionKey> = readonly [field: FieldOf<K>, direction: "asc" | "desc"];

/** The most documents one live query may ask for. */
export const LIVE_QUERY_MAX_LIMIT = 1_000;

/**
 * A query over the documents of one registry entry.
 *
 * Security rules do not filter results, so a query must itself be limited to what the caller
 * may read: constrain `scopeKeys`, or one of the scalar scope fields, with keys the caller
 * holds (docs/DATA_MODEL.md, section 1). Firestore accepts at most 30 values in one `in` or
 * `array-contains-any` clause and one array-membership clause in a query.
 */
export interface LiveQuery<K extends ListableCollectionKey> {
  readonly collection: K;
  /**
   * The identifiers of the ancestors of the collection, in order, or `"group"` to read the
   * collection beneath every parent at once. A top-level collection takes an empty list.
   */
  readonly within: CollectionPathIds<K> | "group";
  readonly where?: readonly QueryFilter<K>[];
  readonly orderBy?: readonly QueryOrder<K>[];
  /** The most documents to read. Every list is bounded. */
  readonly limit: number;
  /**
   * Reads the documents after this identifier, in the order of their identifiers: a page of a
   * longer list. Only for a query of one collection without `orderBy`, which is in that order
   * already.
   */
  readonly startAfterId?: string;
}

/** The most values Firestore accepts in one `in`, `not-in` or `array-contains-any` clause. */
export const QUERY_MAX_CLAUSE_VALUES = 30;

const LIST_OPERATORS: readonly QueryOperator[] = ["in", "not-in", "array-contains-any"];
const ARRAY_OPERATORS: readonly QueryOperator[] = ["array-contains", "array-contains-any"];

/** Raised for a query that Firestore would refuse or that asks for an unbounded list. */
export class LiveQueryError extends Error {
  override readonly name = "LiveQueryError";
}

/**
 * Checks a query before it reaches Firestore, so that a mistake in a component is reported
 * where it was made and in words.
 */
export function assertValidLiveQuery<K extends ListableCollectionKey>(query: LiveQuery<K>): void {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > LIVE_QUERY_MAX_LIMIT) {
    throw new LiveQueryError(`A live query reads between 1 and ${LIVE_QUERY_MAX_LIMIT} documents.`);
  }
  if (query.startAfterId !== undefined && ((query.orderBy ?? []).length > 0 || query.within === "group")) {
    throw new LiveQueryError(
      "A query that starts after a document reads one collection and is ordered by identifier alone.",
    );
  }
  const filters = query.where ?? [];
  if (filters.filter(([, operator]) => ARRAY_OPERATORS.includes(operator)).length > 1) {
    throw new LiveQueryError("A query holds one array-membership clause at most.");
  }
  for (const [field, operator, value] of filters) {
    const isList = Array.isArray(value);
    if (LIST_OPERATORS.includes(operator) !== isList) {
      throw new LiveQueryError(
        `The clause on ${field} compares ${isList ? "a list" : "one value"} with "${operator}".`,
      );
    }
    if (isList && (value.length === 0 || value.length > QUERY_MAX_CLAUSE_VALUES)) {
      throw new LiveQueryError(`The clause on ${field} holds between 1 and ${QUERY_MAX_CLAUSE_VALUES} values.`);
    }
  }
}

/**
 * The key under which the subscription cache holds a query. It describes the query completely:
 * two queries have the same key exactly when they ask Firestore for the same thing.
 */
export function liveQueryKey<K extends ListableCollectionKey>(query: LiveQuery<K>): string {
  const plain = (value: QueryValue) => (value instanceof Date ? { date: value.toISOString() } : value);
  return `query:${JSON.stringify([
    query.collection,
    query.within,
    (query.where ?? []).map(([field, operator, value]) => [field, operator, plain(value)]),
    query.orderBy ?? [],
    query.limit,
    ...(query.startAfterId === undefined ? [] : [query.startAfterId]),
  ])}`;
}
