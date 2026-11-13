import {
  COLLECTIONS,
  checkOsfLinkContract,
  documentLinkDocSchema,
  type LinkAccessStatus,
  osfIdentifierOf,
  parseStoredDocument,
} from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";
import { OSF_NOT_ENABLED_MESSAGE, osfAdapter } from "../integrations/osf/adapters";
import { OsfError, type OsfResource } from "../integrations/osf/types";
import { readsAudience } from "../integrations/support";

/** The longest the function waits when OSF asks it to slow down before it asks once more. */
const LONGEST_RETRY_WAIT_MS = 2_000;

const LINK_NOT_FOUND_MESSAGE = "This linked item does not exist.";

/**
 * Checks an OSF link against OSF (docs/INTEGRATIONS.md, section 5), for whoever reads the link
 * and manages its record: `replications.manage` for a link of a replication, `labs.manage` for
 * one of a laboratory. The function asks the OSF adapter about the identifier in the address,
 * never the page, and records on the link what OSF answered: public with its title and the time
 * it last changed, not public, or gone, and whether a registration has been withdrawn. When OSF asks it to slow down it waits once, briefly, and
 * asks again. During an outage the link keeps what was known before, and the person is told.
 * Nothing is read from a resource that is not public, and nothing is made up.
 */
export const checkOsfLink = defineCallable(checkOsfLinkContract, {
  handler: async (input, context) => {
    const { db } = context;
    const access = await readAccessDocument(db, context.uid);
    const reference = db.doc(COLLECTIONS.documentLinks.docPath(input.linkId));
    const parsed = parseStoredDocument(documentLinkDocSchema, (await reference.get()).data());
    if (!parsed.success || parsed.data.archivedAt !== null || !readsAudience(access, context, parsed.data.scopeKeys)) {
      throw new AppError("not-found", LINK_NOT_FOUND_MESSAGE);
    }
    const link = parsed.data;
    requireCapability(
      context,
      access,
      link.laboratoryId !== null && link.replicationId === null ? "labs.manage" : "replications.manage",
      link.replicationId !== null
        ? { replicationId: link.replicationId }
        : link.laboratoryId !== null
          ? { laboratoryId: link.laboratoryId }
          : "programme",
    );
    const id = osfIdentifierOf(link.url);
    if (id === null)
      throw new AppError("invalid-argument", "This link does not point at an OSF project, registration or preprint.");
    const adapter = osfAdapter();
    if (adapter === null) throw new AppError("failed-precondition", OSF_NOT_ENABLED_MESSAGE);

    let resource: OsfResource | null = null;
    let failure: OsfError | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        resource = await adapter.resource(id);
        failure = null;
        break;
      } catch (error) {
        if (!(error instanceof OsfError)) throw error;
        failure = error;
        if (error.kind !== "rateLimited" || attempt === 2) break;
        const wait = Math.min((error.retryAfterSeconds ?? 1) * 1000, LONGEST_RETRY_WAIT_MS);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    if (failure !== null && (failure.kind === "rateLimited" || failure.kind === "unavailable")) {
      throw new AppError(
        "resource-exhausted",
        failure.kind === "rateLimited"
          ? "OSF asked the portal to slow down. The link keeps what was last known: check it again in a minute."
          : "OSF did not answer. The link keeps what was last known: check it again later.",
      );
    }

    const at = context.clock.now();
    const accessStatus: LinkAccessStatus =
      resource !== null ? "public" : failure?.kind === "restricted" ? "restricted" : "unreachable";
    const httpStatus = resource !== null ? 200 : (failure?.httpStatus ?? null);
    const message =
      resource !== null
        ? resource.withdrawn
          ? "OSF answered: the registration has been withdrawn."
          : "OSF answered: the resource is public."
        : accessStatus === "restricted"
          ? "OSF answered: the resource is not public. Ask its owner to make it public or share it."
          : "OSF answered: no resource has this identifier any more.";
    await db.runTransaction(async (transaction) => {
      const current = parseStoredDocument(documentLinkDocSchema, (await transaction.get(reference)).data());
      if (!current.success || current.data.archivedAt !== null) throw new AppError("not-found", LINK_NOT_FOUND_MESSAGE);
      const auditEventId = writeAudit(
        transaction,
        {
          action: "documentLink.osfChecked",
          actor: { kind: "user", uid: context.uid },
          entityType: "documentLink",
          entityId: input.linkId,
          changes: [
            { field: "accessStatus", before: current.data.accessStatus, after: accessStatus },
            ...(resource?.withdrawn === true && current.data.withdrawnAt === undefined
              ? [{ field: "withdrawnAt", before: null, after: at.toISOString() }]
              : []),
          ],
          at,
        },
        db,
      );
      transaction.update(reference, {
        accessStatus,
        ...(httpStatus === null ? {} : { httpStatus }),
        lastCheckedAt: Timestamp.fromDate(at),
        externalId: id,
        ...(resource !== null && current.data.title === undefined ? { title: resource.title.slice(0, 300) } : {}),
        ...(resource?.dateModified == null ? {} : { modifiedAt: Timestamp.fromDate(new Date(resource.dateModified)) }),
        // A withdrawn registration stays public on OSF, so the withdrawal is kept beside the
        // access status, and cleared when a later check finds the resource standing again.
        ...(resource?.withdrawn === true
          ? { withdrawnAt: current.data.withdrawnAt ?? Timestamp.fromDate(at) }
          : current.data.withdrawnAt === undefined
            ? {}
            : { withdrawnAt: FieldValue.delete() }),
        ...touchedFields(callerStamp(context.uid, at, auditEventId)),
      });
    });
    return {
      accessStatus,
      title: resource?.title ?? null,
      kind: resource?.kind ?? null,
      registeredAt: resource?.dateRegistered == null ? null : new Date(resource.dateRegistered).toISOString(),
      withdrawn: resource?.withdrawn ?? false,
      message,
    };
  },
});
