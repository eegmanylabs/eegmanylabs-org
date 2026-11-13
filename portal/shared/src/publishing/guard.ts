// The last check before a publication is offered for approval (requirement R14.4). The
// allow-list keeps private fields out by construction; this check reads the generated files
// themselves and fails the batch where anything shaped like an email address, or a value that a
// caller names as private, appears in them. A finding names the file, the line and the kind of
// finding, never the value.
import { sha256Hex } from "../ids";

/** Text shaped like an email address: something, an at sign, a domain with a dot. */
const EMAIL_SHAPE = /[^\s@<>"'(),;]+@[^\s@<>"'(),;]+\.[A-Za-z]{2,}/;

export type PrivacyFindingKind = "emailShaped" | "privateValue";

export interface PrivacyFinding {
  readonly path: string;
  /** The line of the file, from 1. */
  readonly line: number;
  readonly kind: PrivacyFindingKind;
}

/**
 * The findings in a set of files. `privateValues` are texts that must never appear, such as the
 * values a test plants in restricted documents; a value shorter than four characters is ignored,
 * because it would match ordinary words.
 */
export function privacyFindings(
  files: Readonly<Record<string, string>>,
  privateValues: readonly string[] = [],
): PrivacyFinding[] {
  const values = privateValues.filter((value) => value.length >= 4);
  const findings: PrivacyFinding[] = [];
  for (const [path, text] of Object.entries(files)) {
    text.split(/\r\n|\n|\r/).forEach((line, index) => {
      if (EMAIL_SHAPE.test(line)) findings.push({ path, line: index + 1, kind: "emailShaped" });
      if (values.some((value) => line.includes(value))) findings.push({ path, line: index + 1, kind: "privateValue" });
    });
  }
  return findings;
}

/** The hash of an export: of each path with the hash of its text, in the order of the paths. */
export function publicationPayloadSha256(
  files: readonly { readonly path: string; readonly content: string }[],
): string {
  return sha256Hex(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((file) => `${file.path}\n${sha256Hex(file.content)}\n`)
      .join(""),
  );
}
