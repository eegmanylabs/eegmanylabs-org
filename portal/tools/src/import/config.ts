// The private configuration of the importers: the secret of the keyed hash and, for each source,
// the identifier and the addresses of its document. The file lives in `portal/.private/`, which
// git ignores, and its format is documented by `tools/sources.example.json`. Nothing that is
// read here is ever printed, logged or written to a document that a client can read.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MIN_HASH_SECRET_BYTES, z } from "@eegml/shared";
import { ToolRefusal } from "../environment";

const privateSourceSchema = z.strictObject({
  /** The identifier that the host gives the document. */
  externalId: z.string().min(1).max(300).optional(),
  /** The address at which a person opens the document. */
  url: z.url({ protocol: /^https?$/ }).optional(),
  /** The address of the anonymous XLSX export, for a sheet that anyone with the link can read. */
  exportUrl: z.url({ protocol: /^https?$/ }).optional(),
});
export type PrivateSource = z.output<typeof privateSourceSchema>;

const privateConfigSchema = z.strictObject({
  /** The secret of the keyed hash of this environment. Production and staging each have their own. */
  hashKey: z.string().refine((key) => Buffer.byteLength(key, "utf8") >= MIN_HASH_SECRET_BYTES, {
    error: `The hash key is at least ${MIN_HASH_SECRET_BYTES} bytes long.`,
  }),
  /** The sources by key: the lower-case letter of a lettered source. */
  sources: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), privateSourceSchema).default({}),
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
