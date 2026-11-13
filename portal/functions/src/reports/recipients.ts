// Who a scheduled report may name and notify (requirement R15.7). A report is about a record
// that exists, and each recipient is a member in good standing who may read the document the
// report updates: every member for a template whose audience is the members, and the record's
// team or programme staff for one whose audience is the team. The configurer chooses among such
// people only, and the weekly sweep checks again, since an account can be suspended or lose its
// roles after the report was saved.
import {
  COLLECTIONS,
  DOCUMENT_TEMPLATES,
  type DocumentTemplateDoc,
  laboratoryDocSchema,
  laboratoryScopeKey,
  PROGRAMME_KEY,
  PROGRAMME_SCOPE_KEY,
  parseStoredDocument,
  type ResolvedAccess,
  replicationDocSchema,
  replicationScopeKey,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { readAccessDocument } from "../framework";

export type ReportEntityType = "programme" | "replication" | "laboratory";

/** Whether the record a report is about exists and is not archived. */
export async function reportEntityExists(db: Firestore, entityType: ReportEntityType, entityId: string) {
  if (entityType === "programme") return entityId === PROGRAMME_KEY;
  const parsed =
    entityType === "replication"
      ? parseStoredDocument(
          replicationDocSchema,
          (await db.doc(COLLECTIONS.replications.docPath(entityId)).get()).data(),
        )
      : parseStoredDocument(
          laboratoryDocSchema,
          (await db.doc(COLLECTIONS.laboratories.docPath(entityId)).get()).data(),
        );
  return parsed.success && parsed.data.archivedAt === null;
}

/** Whether an account may receive a report of a template about a record. */
export function recipientQualifies(
  access: ResolvedAccess,
  template: Pick<DocumentTemplateDoc, "kind">,
  entityType: ReportEntityType,
  entityId: string,
): boolean {
  if (!access.member || access.suspended) return false;
  if (DOCUMENT_TEMPLATES[template.kind].audience === "members") return true;
  if (access.scopeKeys.includes(PROGRAMME_SCOPE_KEY)) return true;
  if (entityType === "replication") return access.scopeKeys.includes(replicationScopeKey(entityId));
  if (entityType === "laboratory") return access.scopeKeys.includes(laboratoryScopeKey(entityId));
  return false;
}

/** The recipients of a list who qualify, in their order, and those who do not. */
export async function sortRecipients(
  db: Firestore,
  uids: readonly string[],
  template: Pick<DocumentTemplateDoc, "kind">,
  entityType: ReportEntityType,
  entityId: string,
): Promise<{ readonly qualified: string[]; readonly refused: string[] }> {
  const qualified: string[] = [];
  const refused: string[] = [];
  for (const uid of new Set(uids)) {
    const access = await readAccessDocument(db, uid);
    (recipientQualifies(access, template, entityType, entityId) ? qualified : refused).push(uid);
  }
  return { qualified, refused };
}
