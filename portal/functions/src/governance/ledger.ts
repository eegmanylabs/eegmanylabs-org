// Writes an entry of the governance ledger (shared/src/governance/ledger.ts) as one structured
// log entry, after the action it records has been committed. In a deployed project a log sink
// routes these entries to a locked log bucket outside Firestore's backups (ops/backup-setup.mjs),
// and `governance:replay` applies them again after a restore. The entry carries identifiers only.
import { GOVERNANCE_LEDGER_KEY, type GovernanceLedgerEntry, governanceLedgerEntrySchema } from "@eegml/shared";
import type { Logger } from "../framework/context";

export function recordGovernance(logger: Logger, entry: GovernanceLedgerEntry): void {
  logger.info("governance ledger", { [GOVERNANCE_LEDGER_KEY]: governanceLedgerEntrySchema.parse(entry) });
}
