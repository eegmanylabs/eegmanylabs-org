// Where the records behind a figure or a chart came from. Fact-like documents carry a
// `dataOrigin`, and every origin but `live` is labelled wherever its values are shown
// (CONTRIBUTING.md), so a figure computed over demonstration or imported records says so.
import { DATA_ORIGINS, type DataOrigin, type ViewRecord } from "@eegml/shared";
import { DATA_ORIGIN_LABELS } from "@/registry/labels";

const isOrigin = (value: unknown): value is DataOrigin =>
  typeof value === "string" && (DATA_ORIGINS as readonly string[]).includes(value);

/**
 * The line that says where the records came from, or null where every record is live or the
 * records carry no origin, as the rows of a database do.
 */
export function originNote(records: readonly ViewRecord[]): string | null {
  const counts = new Map<DataOrigin, number>();
  for (const record of records) {
    const origin = record.values.dataOrigin;
    if (isOrigin(origin)) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  const labelled = [...counts].filter(([origin]) => origin !== "live");
  if (labelled.length === 0) return null;
  if (counts.size === 1) return `From ${DATA_ORIGIN_LABELS[labelled[0]?.[0] ?? "demo"].toLowerCase()}`;
  return `Mixed origins: ${DATA_ORIGINS.filter((origin) => counts.has(origin))
    .map((origin) => `${counts.get(origin)} ${DATA_ORIGIN_LABELS[origin].toLowerCase()}`)
    .join(", ")}`;
}
