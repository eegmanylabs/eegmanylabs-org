// Where the records behind a figure or a chart came from. Fact-like documents carry a
// `dataOrigin`, and every origin but `live` is labelled wherever its values are shown
// (CONTRIBUTING.md), so a figure computed over demonstration or imported records says so.
import { DATA_ORIGINS, type DataOrigin, FIGURE_BASES, type FigureBasis, type ViewRecord } from "@eegml/shared";
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

/** How many of some records state a number for a property, which a sum adds and a blank leaves out. */
export function statedCount(records: readonly ViewRecord[], propertyId: string): number {
  return records.filter((record) => typeof record.values[propertyId] === "number").length;
}

/**
 * The bases of the values a sum adds, where the records say what their values rest on, as the
 * records of recruitment do: reported, verified or both. Empty for records that do not say.
 */
export function basesOf(records: readonly ViewRecord[], propertyId: string): FigureBasis[] {
  const found = new Set<FigureBasis>();
  for (const record of records) {
    if (typeof record.values[propertyId] !== "number") continue;
    const basis = record.values.basis;
    if (basis === "reported" || basis === "mixed") found.add("reported");
    if (basis === "verified" || basis === "mixed") found.add("verified");
  }
  return FIGURE_BASES.filter((basis) => found.has(basis));
}
