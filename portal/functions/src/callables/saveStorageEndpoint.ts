import {
  COLLECTIONS,
  parseStoredDocument,
  saveStorageEndpointContract,
  storageEndpointConnectionDocSchema,
  storageEndpointDocSchema,
} from "@eegml/shared";
import { FieldValue } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";

/** Whether two maps of folders by scope key are the same. */
function samePrefixes(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * Registers or changes a storage server (docs/DATA_MODEL.md, section 10).
 *
 * | Caller                                                       | May                                         |
 * |--------------------------------------------------------------|---------------------------------------------|
 * | A holder of `datasets.manage` for the programme              | Register a server and change its name, owner, description, way of listing and the folder of each replication or laboratory, or retire it. Change its protocol, host, port and base path while it names no secret |
 * | The same, also holding `integrations.credentials`            | Name or change the secret that holds the server's read-only credential, and change where a server that names one is reached |
 *
 * The public document names the server and never its address; the host, the port, the base
 * path and the name of the secret go in `private/connection`, which no client reads. The
 * credential itself is never given to the portal: an administrator places it in the secret
 * store. The audit entry names the connection fields that changed and records none of their
 * values.
 */
export const saveStorageEndpoint = defineCallable(saveStorageEndpointContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    const endpointReference = db.doc(COLLECTIONS.storageEndpoints.docPath(input.key));
    const connectionReference = db.doc(COLLECTIONS.storageEndpointConnection.docPath(input.key));
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      requireCapability(context, access, "datasets.manage", "programme");
      const [endpointSnapshot, connectionSnapshot] = await transaction.getAll(endpointReference, connectionReference);
      const stored = parseStoredDocument(storageEndpointDocSchema, endpointSnapshot?.data());
      const storedConnection = parseStoredDocument(storageEndpointConnectionDocSchema, connectionSnapshot?.data());
      const created = !stored.success;
      const previousSecret = storedConnection.success ? (storedConnection.data.credentialRef ?? null) : null;
      const nextSecret = input.connection.credentialRef ?? null;
      // The secret goes wherever the connection points, so whoever moves a connection that names
      // one decides where the credential is sent, as much as whoever names it.
      const targetChanged =
        !stored.success ||
        !storedConnection.success ||
        stored.data.protocol !== input.protocol ||
        storedConnection.data.host !== input.connection.host ||
        (storedConnection.data.port ?? null) !== (input.connection.port ?? null) ||
        (storedConnection.data.basePath ?? null) !== (input.connection.basePath ?? null);
      if (nextSecret !== previousSecret || (nextSecret !== null && targetChanged)) {
        requireCapability(context, access, "integrations.credentials", "programme");
      }
      if (
        input.institutionId !== null &&
        !(await transaction.get(db.doc(COLLECTIONS.institutions.docPath(input.institutionId)))).exists
      ) {
        throw new AppError("invalid-argument", "The institution is not in the portal.");
      }
      if (
        input.ownerPersonId !== null &&
        !(await transaction.get(db.doc(COLLECTIONS.persons.docPath(input.ownerPersonId)))).exists
      ) {
        throw new AppError("invalid-argument", "The owner is not in the portal.");
      }
      const connectionFields = ["host", "port", "basePath", "credentialRef"] as const;
      const storedPrefixes = storedConnection.success ? (storedConnection.data.allowedPrefixes ?? {}) : {};
      const allowedPrefixes = input.connection.allowedPrefixes ?? storedPrefixes;
      const changedConnection = [
        ...connectionFields.filter((field) => {
          const before = storedConnection.success ? (storedConnection.data[field] ?? null) : null;
          return before !== (input.connection[field] ?? null);
        }),
        ...(samePrefixes(storedPrefixes, allowedPrefixes) ? [] : ["allowedPrefixes" as const]),
      ];
      const auditEventId = writeAudit(
        transaction,
        {
          action: "storageEndpoint.saved",
          actor: { kind: "user", uid: context.uid },
          entityType: "storageEndpoint",
          entityId: input.key,
          changes: [
            { field: "name", before: stored.success ? stored.data.name : null, after: input.name },
            { field: "protocol", before: stored.success ? stored.data.protocol : null, after: input.protocol },
            { field: "scanMode", before: stored.success ? stored.data.scanMode : null, after: input.scanMode },
            {
              field: "retired",
              before: stored.success ? stored.data.status === "retired" : null,
              after: input.retired,
            },
            ...withheldChanges(changedConnection.map((field) => `connection.${field}`)),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const status = input.retired
        ? "retired"
        : stored.success && stored.data.status !== "retired"
          ? stored.data.status
          : "active";
      const description = input.description === "" ? undefined : input.description;
      const publicFields = {
        key: input.key,
        name: input.name,
        protocol: input.protocol,
        scanMode: input.scanMode,
        status,
        ...(input.institutionId === null ? {} : { institutionId: input.institutionId }),
        ...(input.ownerPersonId === null ? {} : { ownerPersonId: input.ownerPersonId }),
        ...(description === undefined ? {} : { description }),
      };
      const connection = {
        host: input.connection.host,
        ...(input.connection.port === undefined ? {} : { port: input.connection.port }),
        ...(input.connection.basePath === undefined ? {} : { basePath: input.connection.basePath }),
        ...(input.connection.credentialRef === undefined ? {} : { credentialRef: input.connection.credentialRef }),
        ...(Object.keys(allowedPrefixes).length === 0 ? {} : { allowedPrefixes }),
      };
      if (created) {
        transaction.create(
          endpointReference,
          storageEndpointDocSchema.parse({
            ...createdFields("storageEndpoints", stamp),
            ...publicFields,
            lastCheckedAt: null,
            lastSeenAt: null,
            scopeKeys: [],
          }),
        );
        transaction.create(
          connectionReference,
          storageEndpointConnectionDocSchema.parse({
            ...createdFields("storageEndpointConnection", stamp),
            ...connection,
          }),
        );
      } else {
        storageEndpointDocSchema.parse({ ...stored.data, ...publicFields });
        transaction.update(endpointReference, {
          ...publicFields,
          institutionId: input.institutionId ?? FieldValue.delete(),
          ownerPersonId: input.ownerPersonId ?? FieldValue.delete(),
          description: description ?? FieldValue.delete(),
          ...(status === "active" && stored.data.status === "retired" ? { statusReason: FieldValue.delete() } : {}),
          ...touchedFields(stamp),
        });
        // The connection is written whole, so that a port, a base path or a secret that the
        // call leaves out is removed rather than kept.
        const kept = storedConnection.success
          ? {
              schemaVersion: storedConnection.data.schemaVersion,
              createdAt: storedConnection.data.createdAt,
              createdBy: storedConnection.data.createdBy,
              archivedAt: storedConnection.data.archivedAt,
              ...(storedConnection.data.lastCheckResult === undefined
                ? {}
                : { lastCheckResult: storedConnection.data.lastCheckResult }),
            }
          : createdFields("storageEndpointConnection", stamp);
        transaction.set(
          connectionReference,
          storageEndpointConnectionDocSchema.parse({ ...kept, ...touchedFields(stamp), ...connection }),
        );
      }
      return { key: input.key, created };
    });
  },
});
