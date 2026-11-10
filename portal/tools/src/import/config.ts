// The private configuration of the importers: the secret of the keyed hash and, for each source,
// the identifier and the addresses of its document. The file lives in `portal/.private/`, which
// git ignores, and its format is documented by `tools/sources.example.json`. Nothing that is
// read here is ever printed, logged or written to a document that a client can read.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MIN_HASH_SECRET_BYTES, z } from "@eegml/shared";
import { ToolRefusal } from "../environment";
import { ROW_CLASSES } from "./model";
import { WITHHELD_OUTPUT_KEYS } from "./withheld";

/**
 * The rows that each tab of a source is expected to hold, by the title or the key of the tab and
 * by the class of row. `import verify` compares a fresh reading with it, and a difference stands
 * until the operator has explained it by stating the new numbers here.
 */
const baselineSchema = z.record(
  z.string().min(1).max(300),
  z.partialRecord(z.enum(ROW_CLASSES), z.number().int().min(0)),
);

const privateSourceSchema = z.strictObject({
  /** The identifier that the host gives the document. */
  externalId: z.string().min(1).max(300).optional(),
  /** The address at which a person opens the document. */
  url: z.url({ protocol: /^https?$/ }).optional(),
  /** The address of the anonymous XLSX export, for a sheet that anyone with the link can read. */
  exportUrl: z.url({ protocol: /^https?$/ }).optional(),
  baseline: baselineSchema.optional(),
  /**
   * The header lists that a maintainer has confirmed, by tab title, for a tab whose columns no
   * description of the source states. Until a list is stored here the importer keeps the header
   * of such a tab and nothing below it, and it reads the rows only while the header still equals
   * the stored list.
   */
  confirmedHeaders: z.record(z.string().min(1).max(300), z.array(z.string().max(300)).max(200)).optional(),
});
export type PrivateSource = z.output<typeof privateSourceSchema>;

/**
 * A decision of a maintainer about one column of a contributor sheet, which the importer never
 * takes by itself: that a column without a header, or one whose header does not fit its
 * content, holds a field. It is checked against the content of the column on every run and is
 * not applied where the content no longer fits.
 */
const columnOverrideSchema = z.strictObject({
  /** The header of the column exactly as the sheet writes it. Empty for a column without a header. */
  header: z.string().max(200),
  /** The position of the column in the sheet, from 1. Required for a column without a header, and checked where given. */
  position: z.number().int().min(1).max(500).optional(),
  /** The field that the column holds. */
  field: z.enum(["orderInPublication", "orcid"]),
});
export type ColumnOverride = z.output<typeof columnOverrideSchema>;

const contributorSheetSchema = z.strictObject({
  /** The identifier that the host gives the sheet. The key of the sheet in the registry is derived from it. */
  externalId: z.string().min(1).max(300),
  /** The replication whose manuscript the sheet lists the contributors of. Nothing inside a sheet names it. */
  replicationId: z.string().regex(/^[A-Z][A-Za-z]+\d{4}$/),
  url: z.url({ protocol: /^https?$/ }).optional(),
  exportUrl: z.url({ protocol: /^https?$/ }).optional(),
  columnOverrides: z.array(columnOverrideSchema).max(10).optional(),
  baseline: baselineSchema.optional(),
});
export type PrivateContributorSheet = z.output<typeof contributorSheetSchema>;

const privateConfigSchema = z.strictObject({
  /** The secret of the keyed hash of this environment. Production and staging each have their own. */
  hashKey: z.string().refine((key) => Buffer.byteLength(key, "utf8") >= MIN_HASH_SECRET_BYTES, {
    error: `The hash key is at least ${MIN_HASH_SECRET_BYTES} bytes long.`,
  }),
  /** The sources by key: the lower-case letter of a lettered source. */
  sources: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), privateSourceSchema).default({}),
  /**
   * The registry of contributor sheets, each under a name that the operator chooses and states
   * with `--sheet`. A sheet that is not registered here is refused.
   */
  contributorSheets: z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), contributorSheetSchema).optional(),
  /**
   * The withheld outputs that this environment writes for rehearsal (withheld.ts). It is read
   * for the emulators only: a real project never receives a withheld output, whatever stands here.
   */
  rehearse: z.array(z.enum(WITHHELD_OUTPUT_KEYS)).max(WITHHELD_OUTPUT_KEYS.length).default([]),
  /** The number of studies of the programme, which the verification compares once the list of studies is applied. */
  expectedStudies: z.number().int().min(1).max(10_000).optional(),
});
export type PrivateConfig = z.output<typeof privateConfigSchema>;

/** The directory of the portal, which holds `.private/`. */
export const PORTAL_DIRECTORY = path.resolve(import.meta.dirname, "..", "..", "..");
export const PRIVATE_DIRECTORY = path.join(PORTAL_DIRECTORY, ".private");
export const DEFAULT_CONFIG_PATH = path.join(PRIVATE_DIRECTORY, "sources.json");
export const DEFAULT_EXPORTS_DIRECTORY = path.join(PRIVATE_DIRECTORY, "exports");

/** Reads the private configuration, or refuses with what to do about it. The refusal quotes no value of the file. */
export function loadPrivateConfig(configPath: string = DEFAULT_CONFIG_PATH): PrivateConfig {
  if (!existsSync(configPath)) {
    throw new ToolRefusal(
      `Refusing to run: the private import configuration ${configPath} does not exist. ` +
        "Copy tools/sources.example.json to portal/.private/sources.json and fill it in, or name another file with --config.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new ToolRefusal(`Refusing to run: the private import configuration ${configPath} is not valid JSON.`);
  }
  const result = privateConfigSchema.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.code}`);
    throw new ToolRefusal(
      `Refusing to run: the private import configuration ${configPath} does not have the documented format ` +
        `(${[...new Set(problems)].join(", ")}). See tools/sources.example.json.`,
    );
  }
  return result.data;
}

/** The shortest identifier of a source document that a file name is searched for. A shorter text names nothing. */
const MIN_IDENTIFIER_LENGTH = 8;

/** The identifiers that the hosts give the source documents of a configuration. They are private. */
export function externalIdentifiers(config: PrivateConfig): string[] {
  return [...Object.values(config.sources), ...Object.values(config.contributorSheets ?? {})]
    .flatMap((source) => (source.externalId === undefined ? [] : [source.externalId]))
    .filter((identifier) => identifier.length >= MIN_IDENTIFIER_LENGTH);
}

/** Whether a file name holds the identifier of a source document, as an export that a browser has named often does. */
export function namesSourceDocument(fileName: string, config: PrivateConfig): boolean {
  return externalIdentifiers(config).some((identifier) => fileName.includes(identifier));
}
