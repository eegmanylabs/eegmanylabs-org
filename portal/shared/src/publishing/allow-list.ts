// The allow-list of public fields (requirement R14.1 and R14.4, docs/INTEGRATIONS.md, section 6).
//
// The public website receives a field of a record only when this file names it. A record is
// projected onto its public fields by name before anything else reads it, so a field that is
// added to a record later, a custom property, a restricted or special-category document, or any
// value that is not listed here can never reach a generated file. The generator reads directory
// documents alone, never the `private` or `special` documents beneath them, and the projection
// is checked against a strict schema, so a projection that let anything else through would fail.
//
// | Record        | Public fields                                                              |
// |---------------|----------------------------------------------------------------------------|
// | Person        | Website identifier, slug, display name, affiliation summary, verbatim country, listing, core team mark, portrait file name, scholar, university and laboratory addresses |
// | Replication   | Study key, theme, construct, public stage number, name and text, sign-up address and whether sign-up is open, target sample |
// | Laboratory    | Slug, name, department, city, country code, website, status               |
// | Participation | Replication, laboratory and status, which make the public list of a laboratory's studies |
// | Manuscript    | Website identifier, replication, title, kind, status, journal, DOI, OSF address, short authors, dates of acceptance and publication |
// | Summary       | The aggregate totals of a replication's recruitment, by basis, modality and category, with the number of participations that state each |
//
// Every record also passes `archivedAt` and `dataOrigin`, which decide whether it is published at
// all and are never written to a file.
import { DATA_ORIGINS } from "../data-origin";
import { isFirestoreTimestamp } from "../timestamp";
import { z } from "../zod";

export const PUBLIC_FIELDS = {
  person: [
    "websitePersonId",
    "slug",
    "displayName",
    "affiliationSummary",
    "countrySource",
    "publicListing",
    "isCoreTeam",
    "headshotFilename",
    "scholarUrl",
    "universityUrl",
    "labUrl",
  ],
  replication: [
    "studyKey",
    "theme",
    "psychConstruct",
    "publicStageNumber",
    "publicStageName",
    "publicStageText",
    "signupUrl",
    "signupActive",
    "targetN",
  ],
  laboratory: ["slug", "name", "department", "city", "countryCode", "website", "status"],
  participation: ["replicationId", "laboratoryId", "status"],
  manuscript: [
    "websitePublicationId",
    "replicationId",
    "title",
    "kind",
    "status",
    "journal",
    "doi",
    "osfUrl",
    "authorsShort",
    "acceptedAt",
    "publishedAt",
  ],
  summary: ["replicationId", "totals", "reporting", "latestAsOfDate"],
} as const;

export type PublicRecordKind = keyof typeof PUBLIC_FIELDS;

/** The two fields that decide whether a record is published, and that no file receives. */
const GATE_FIELDS = ["archivedAt", "dataOrigin"] as const;

const text = z.string().max(10_000);
const gate = {
  archived: z.boolean(),
  dataOrigin: z.enum(DATA_ORIGINS).nullable(),
};

const countsByCategory = z.record(z.string().max(100), z.record(z.string().max(100), z.number()));

export const publicPersonSchema = z.strictObject({
  id: text,
  ...gate,
  websitePersonId: text.exactOptional(),
  slug: text.exactOptional(),
  displayName: text.exactOptional(),
  affiliationSummary: text.exactOptional(),
  countrySource: text.exactOptional(),
  publicListing: z.enum(["none", "member", "coreTeam"]).exactOptional(),
  isCoreTeam: z.boolean().exactOptional(),
  headshotFilename: text.exactOptional(),
  scholarUrl: text.exactOptional(),
  universityUrl: text.exactOptional(),
  labUrl: text.exactOptional(),
});
export type PublicPerson = z.output<typeof publicPersonSchema>;

export const publicReplicationSchema = z.strictObject({
  id: text,
  ...gate,
  studyKey: text.exactOptional(),
  theme: text.exactOptional(),
  psychConstruct: text.exactOptional(),
  publicStageNumber: z.number().exactOptional(),
  publicStageName: text.exactOptional(),
  publicStageText: text.exactOptional(),
  signupUrl: text.exactOptional(),
  signupActive: z.boolean().exactOptional(),
  targetN: z.number().exactOptional(),
});
export type PublicReplication = z.output<typeof publicReplicationSchema>;

export const publicLaboratorySchema = z.strictObject({
  id: text,
  ...gate,
  slug: text.exactOptional(),
  name: text.exactOptional(),
  department: text.exactOptional(),
  city: text.exactOptional(),
  countryCode: text.exactOptional(),
  website: text.exactOptional(),
  status: text.exactOptional(),
});
export type PublicLaboratory = z.output<typeof publicLaboratorySchema>;

export const publicParticipationSchema = z.strictObject({
  id: text,
  ...gate,
  replicationId: text.exactOptional(),
  laboratoryId: text.exactOptional(),
  status: text.exactOptional(),
});
export type PublicParticipation = z.output<typeof publicParticipationSchema>;

export const publicManuscriptSchema = z.strictObject({
  id: text,
  ...gate,
  websitePublicationId: text.exactOptional(),
  replicationId: text.exactOptional(),
  title: text.exactOptional(),
  kind: text.exactOptional(),
  status: text.exactOptional(),
  journal: text.exactOptional(),
  doi: text.exactOptional(),
  osfUrl: text.exactOptional(),
  authorsShort: text.exactOptional(),
  /** An ISO 8601 date: the projection turns a stored instant into its day. */
  acceptedAt: text.exactOptional(),
  publishedAt: text.exactOptional(),
});
export type PublicManuscript = z.output<typeof publicManuscriptSchema>;

export const publicSummarySchema = z.strictObject({
  id: text,
  ...gate,
  replicationId: text.exactOptional(),
  totals: z.record(z.string().max(100), countsByCategory).exactOptional(),
  reporting: z.record(z.string().max(100), countsByCategory).exactOptional(),
  latestAsOfDate: text.nullable().exactOptional(),
});
export type PublicSummary = z.output<typeof publicSummarySchema>;

const SCHEMAS = {
  person: publicPersonSchema,
  replication: publicReplicationSchema,
  laboratory: publicLaboratorySchema,
  participation: publicParticipationSchema,
  manuscript: publicManuscriptSchema,
  summary: publicSummarySchema,
} as const;

export interface PublicRecords {
  readonly person: PublicPerson;
  readonly replication: PublicReplication;
  readonly laboratory: PublicLaboratory;
  readonly participation: PublicParticipation;
  readonly manuscript: PublicManuscript;
  readonly summary: PublicSummary;
}

/** A stored value as a file may hold it: an instant becomes its calendar day in UTC. */
function publicValue(value: unknown): unknown {
  if (isFirestoreTimestamp(value)) return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

/**
 * The public projection of a stored record: its identifier, whether it is archived, its origin,
 * and the fields that `PUBLIC_FIELDS` lists for its kind, taken by name. Nothing else of the
 * document is read, so a field that the allow-list does not name never leaves the portal. A
 * value that does not fit the public schema of its field is left out, never coerced.
 */
export function publicProjection<K extends PublicRecordKind>(
  kind: K,
  id: string,
  data: Readonly<Record<string, unknown>>,
): PublicRecords[K] {
  const picked: Record<string, unknown> = {
    id,
    archived: data[GATE_FIELDS[0]] !== null && data[GATE_FIELDS[0]] !== undefined,
    dataOrigin: (DATA_ORIGINS as readonly unknown[]).includes(data[GATE_FIELDS[1]]) ? data[GATE_FIELDS[1]] : null,
  };
  const schema = SCHEMAS[kind];
  for (const field of PUBLIC_FIELDS[kind] as readonly string[]) {
    if (!Object.hasOwn(data, field)) continue;
    const value = publicValue(data[field]);
    const candidate = { ...picked, [field]: value };
    if (schema.safeParse(candidate).success) picked[field] = value;
  }
  return schema.parse(picked) as PublicRecords[K];
}
