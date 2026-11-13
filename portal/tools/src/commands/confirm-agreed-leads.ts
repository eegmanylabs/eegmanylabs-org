// leads:confirm-agreed [--apply] [--production --project <identifier>]
//
// Confirms the lead of a replication on whom every source that names leads agrees, which the
// programme allowed on 13 November 2026 (docs/MIGRATION_PLAN.md, section 11, question 5). The
// importers write every lead membership for review: the website, which is imported first, cannot
// tell on its own whether the other sources agree. This command decides that, after the fact:
//
// | Condition                                                                                   |
// |---------------------------------------------------------------------------------------------|
// | Every source that names leads (`LEAD_SOURCE_KEYS`) has an applied import batch             |
// | The replication has one current lead membership and no other current lead or co-lead (question 4) |
// | That membership awaits review, and no person has decided it: an import wrote its status    |
// | No open `conflictingLead` or `candidateLink` item names the replication, whatever the cell or the number of studies it rests on |
//
// A membership that meets all of them is confirmed, with `confirmationBasis` naming the sources
// compared and the decision. The basis is the provenance of a decision, so it enters neither
// `importedValues` nor `fieldSources`: no source row claims it. A later import whose source names
// another lead lowers the confirmation again (tools/src/import/preview.ts). Without `--apply` the
// command reports what it would confirm and writes nothing. It is idempotent, and reports
// identifiers and counts only.
import { COLLECTIONS, LEAD_AGREEMENT_DECISION, LEAD_SOURCE_KEYS, systemActor, systemWriteContext } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";

/** The actor recorded on what the command writes. */
export const LEAD_AGREEMENT_ACTOR = systemActor("leadAgreement");

const LEAD_ROLES = new Set(["lead", "coLead"]);
const QUESTION_KINDS = new Set(["conflictingLead", "candidateLink"]);

export interface LeadAgreementSummary {
  /** The lead-naming sources that have no applied batch yet. While any is missing, nothing is confirmed. */
  readonly waitingFor: readonly string[];
  /** The memberships confirmed, or that would be in a dry run. */
  readonly confirmed: readonly string[];
  /** The replications whose lead stays for review, because a question about it is open or it has several leads. */
  readonly questioned: readonly string[];
}

/** The lead-naming sources with no applied import batch. */
async function sourcesNotApplied(db: Firestore): Promise<string[]> {
  const missing: string[] = [];
  for (const sourceKey of LEAD_SOURCE_KEYS) {
    const applied = await db
      .collection(COLLECTIONS.importBatches.collectionPath())
      .where("sourceKey", "==", sourceKey)
      .where("status", "==", "applied")
      .limit(1)
      .get();
    if (applied.empty) missing.push(sourceKey);
  }
  return missing;
}

/** The replications that an open question about a lead names, whichever cell or how many studies it rests on. */
async function questionedReplications(db: Firestore): Promise<Set<string>> {
  const open = await db
    .collection(COLLECTIONS.reconciliationItems.collectionPath())
    .where("status", "==", "open")
    .get();
  const named = new Set<string>();
  for (const item of open.docs) {
    if (!QUESTION_KINDS.has(String(item.get("kind")))) continue;
    const refs: unknown = item.get("entityRefs");
    if (!Array.isArray(refs)) continue;
    for (const ref of refs as { entityType?: unknown; entityId?: unknown }[]) {
      if (ref.entityType === "replication" && typeof ref.entityId === "string") named.add(ref.entityId);
    }
  }
  return named;
}

export async function confirmAgreedLeads(
  db: Firestore,
  options: { readonly apply: boolean; readonly now?: Date },
): Promise<LeadAgreementSummary> {
  const waitingFor = await sourcesNotApplied(db);
  if (waitingFor.length > 0) return { waitingFor, confirmed: [], questioned: [] };
  const at = Timestamp.fromDate(options.now ?? new Date());
  const questioned = await questionedReplications(db);
  const confirmed: string[] = [];
  const held: string[] = [];
  const replications = await db.collection(COLLECTIONS.replications.collectionPath()).listDocuments();
  for (const replication of replications.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const memberships = await db.collection(COLLECTIONS.replicationMemberships.collectionPath(replication.id)).get();
    const leads = memberships.docs.filter(
      (doc) =>
        LEAD_ROLES.has(String(doc.get("role"))) && doc.get("isCurrent") === true && doc.get("archivedAt") == null,
    );
    if (leads.length === 0) continue;
    const [only] = leads;
    if (questioned.has(replication.id) || leads.length > 1 || only === undefined || only.get("role") !== "lead") {
      held.push(replication.id);
      continue;
    }
    const imported = (only.get("importedValues") as Record<string, unknown> | undefined)?.reviewStatus;
    // Only a status that an import wrote is confirmed here. A reviewer's decision stands.
    if (only.get("reviewStatus") !== "needsReview" || imported !== "needsReview") continue;
    confirmed.push(only.ref.path);
    if (!options.apply) continue;
    const basis = { basis: "allSourcesAgree", sources: [...LEAD_SOURCE_KEYS], decision: LEAD_AGREEMENT_DECISION };
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(only.ref);
      if (current.get("reviewStatus") !== "needsReview") return;
      const next = COLLECTIONS.replicationMemberships.schema.parse({
        ...current.data(),
        reviewStatus: "confirmed",
        confirmationBasis: basis,
        updatedAt: at,
        updatedBy: LEAD_AGREEMENT_ACTOR,
        writeContext: systemWriteContext(),
      });
      transaction.update(only.ref, {
        reviewStatus: next.reviewStatus,
        confirmationBasis: basis,
        updatedAt: at,
        updatedBy: LEAD_AGREEMENT_ACTOR,
        writeContext: systemWriteContext(),
      });
    });
  }
  return { waitingFor, confirmed, questioned: held };
}

const USAGE = "Usage: leads:confirm-agreed [--apply] [--production --project <identifier>]";

export const confirmAgreedLeadsCommand: Command = {
  name: "leads:confirm-agreed",
  summary: "Confirm the leads on whom every lead-naming source agrees (question 5). Dry run without --apply.",
  async run(args) {
    let apply = false;
    let production = false;
    let projectId: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--apply") apply = true;
      else if (argument === "--production") production = true;
      else if (argument === "--project") {
        projectId = args[index + 1];
        if (projectId === undefined || projectId.startsWith("--"))
          throw new ToolRefusal(`--project needs a value.\n\n${USAGE}`);
        index += 1;
      } else throw new ToolRefusal(USAGE);
    }
    const target = requireImportTarget({ production, ...(projectId === undefined ? {} : { projectId }) });
    let db: Firestore;
    if (target.kind === "production") db = connectToProject(target.projectId).db;
    else {
      await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
      db = connectToEmulators(target).db;
    }
    const summary = await confirmAgreedLeads(db, { apply });
    if (summary.waitingFor.length > 0) {
      console.log(
        `leads:confirm-agreed in ${target.projectId}: nothing confirmed, because these lead-naming sources have no applied import yet: ${summary.waitingFor.join(", ")}.`,
      );
      return undefined;
    }
    console.log(
      `leads:confirm-agreed in ${target.projectId} (${apply ? "applied" : "dry run, nothing written"}): ` +
        `${summary.confirmed.length} lead(s) ${apply ? "confirmed" : "to confirm"}, ${summary.questioned.length} replication(s) whose lead stays for review.`,
    );
    for (const path of summary.confirmed) console.log(`  ${path}`);
    return undefined;
  },
};
