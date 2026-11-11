// How the imports console names what it shows: the actor of a batch, its duration and its
// counts. A source is named by its letter and title only, never by the address of its document.
import { entryOfDocumentPath, isSystemActor } from "@eegml/shared";
import { PersonOfAccount } from "@/pages/admin/people";

/** Who started a batch: the import tool or another trusted actor in words, or the person of an account. */
export function ActorName({ actor }: { actor: string }) {
  if (actor === "system:import") return <>The import tool</>;
  if (isSystemActor(actor)) return <>Trusted code ({actor.slice("system:".length)})</>;
  return <PersonOfAccount uid={actor} />;
}

/** A duration in words, from two instants, or null while the batch runs. */
export function durationText(startedAt: Date, finishedAt: Date | null): string | null {
  if (finishedAt === null) return null;
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
}

/** The words of a key in camel case, in lower case: `itemsRaised` gives "items raised". */
function words(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

/** The counts of a batch that have words of their own. Any other key is put into words. */
const STAT_LABELS: Readonly<Record<string, string>> = {
  rowsRead: "Rows read",
  itemsRaised: "Items raised for review",
  created: "Records created",
  updated: "Records updated",
  matched: "Records matched, unchanged",
  changesCommitted: "Changes written",
};

/** A key of the statistics of a batch, or a field name, in sentence case. */
export function statLabel(key: string): string {
  const known = STAT_LABELS[key];
  if (known !== undefined) return known;
  const text = key.split(":").map(words).filter(Boolean).join(", ");
  return text === "" ? key : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** The kind of record a document path holds, in sentence case: `persons/p-1/private/contact` gives "Person contact". */
export function collectionOfPath(path: string): string {
  const matched = entryOfDocumentPath(path);
  return statLabel(matched === null ? (path.split("/")[0] ?? path) : matched.entry.key);
}

/** The counts of a map, as "key: count" pairs sorted by key. */
export function countEntries(counts: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, "en"));
}
