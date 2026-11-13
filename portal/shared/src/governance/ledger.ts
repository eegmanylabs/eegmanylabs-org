// The governance ledger (docs/SECURITY.md, section 10). A restore to an earlier moment brings
// back whatever the database held then, so an erasure, a revocation or the end of a member's
// sessions made after that moment would be undone by it. Each of those actions is therefore
// also written, as one structured log entry, outside Firestore: the functions log it, a log sink
// routes it to a locked log bucket with a long retention (ops/backup-setup.mjs), and after a
// restore `governance:replay` applies every entry later than the restored moment again.
//
// An entry names identifiers only: a person, an account, a request, a role assignment or a grant.
// Never an address, a name or a special-category value.
import { idSchema, uidSchema } from "../schemas/base";
import { z } from "../zod";

/** The key under which a log entry carries a ledger entry, for the log sink's filter. */
export const GOVERNANCE_LEDGER_KEY = "governanceLedger";

const instantSchema = z.iso.datetime({ offset: true });

export const governanceLedgerEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("erasureApplied"), at: instantSchema, personId: idSchema, requestId: idSchema }),
  z.strictObject({ kind: z.literal("roleRevoked"), at: instantSchema, uid: uidSchema, assignmentId: idSchema }),
  z.strictObject({ kind: z.literal("capabilityRevoked"), at: instantSchema, uid: uidSchema, grantId: idSchema }),
  z.strictObject({ kind: z.literal("sessionsEnded"), at: instantSchema, uid: uidSchema }),
  z.strictObject({ kind: z.literal("accountSuspended"), at: instantSchema, uid: uidSchema }),
]);
export type GovernanceLedgerEntry = z.output<typeof governanceLedgerEntrySchema>;

/**
 * The ledger entries of an export of the log bucket (`gcloud logging read ... --format=json`, a
 * JSON array of log entries whose `jsonPayload` carries the entry), or of a JSON array of
 * entries, later than an instant and oldest first. A line that is no ledger entry is skipped and
 * counted, never guessed at.
 */
export function ledgerEntriesAfter(
  exported: unknown,
  after: Date,
): { readonly entries: GovernanceLedgerEntry[]; readonly skipped: number } {
  const items: unknown[] = Array.isArray(exported) ? exported : [];
  const entries: GovernanceLedgerEntry[] = [];
  let skipped = 0;
  for (const item of items) {
    const payload =
      typeof item === "object" && item !== null && "jsonPayload" in item
        ? (item as { jsonPayload?: Record<string, unknown> }).jsonPayload?.[GOVERNANCE_LEDGER_KEY]
        : item;
    const parsed = governanceLedgerEntrySchema.safeParse(payload);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    if (new Date(parsed.data.at).getTime() > after.getTime()) entries.push(parsed.data);
  }
  entries.sort((a, b) => a.at.localeCompare(b.at));
  return { entries, skipped };
}
