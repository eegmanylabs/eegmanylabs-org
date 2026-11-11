// The writes of a view, all through the callable function that checks every value: in groups of
// the most records one call takes, so that a bulk edit of many rows still goes through.
import { type CallableInput, type PropertyValue, SAVE_RECORDS_MAX, saveRecordsContract } from "@eegml/shared";
import { callFunction } from "@/data";

type StoredValues = CallableInput<typeof saveRecordsContract>["changes"][number]["values"];

export interface RecordChange {
  /** The record to change, or none for a new row of a database. */
  readonly recordId?: string;
  readonly title?: string;
  readonly values: Readonly<Record<string, PropertyValue>>;
}

/** Saves changes to records, and returns the identifiers of the records, new ones included. */
export async function saveRecordChanges(
  collectionKey: string,
  changes: readonly RecordChange[],
  archive: readonly string[] = [],
): Promise<string[]> {
  const recordIds: string[] = [];
  for (let start = 0; start < Math.max(changes.length, archive.length); start += SAVE_RECORDS_MAX) {
    const result = await callFunction(saveRecordsContract, {
      collectionKey,
      changes: changes.slice(start, start + SAVE_RECORDS_MAX).map((change) => ({
        ...(change.recordId === undefined ? {} : { recordId: change.recordId }),
        ...(change.title === undefined ? {} : { title: change.title }),
        values: change.values as StoredValues,
      })),
      archive: archive.slice(start, start + SAVE_RECORDS_MAX),
    });
    recordIds.push(...result.recordIds);
  }
  return recordIds;
}
