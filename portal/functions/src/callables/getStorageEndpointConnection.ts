import { getStorageEndpointConnectionContract } from "@eegml/shared";
import { readEndpoint } from "../datasets/model";
import { AppError, defineCallable, readAccessDocument, requireCapability, writeAudit } from "../framework";

/**
 * Gives a holder of `datasets.manage` for the programme the connection details of a storage
 * server, so that they can be edited: the host, the port, the base path and the name of the
 * secret, never a credential, which the portal does not hold. The read is recorded in the audit
 * trail with the fields served and none of their values, because a read leaves no other trace.
 */
export const getStorageEndpointConnection = defineCallable(getStorageEndpointConnectionContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      requireCapability(context, access, "datasets.manage", "programme");
      const endpoint = await readEndpoint(db, transaction, input.key);
      if (endpoint.connection === null) throw new AppError("not-found", "This server has no connection details.");
      writeAudit(
        transaction,
        {
          action: "storageEndpoint.connectionViewed",
          actor: { kind: "user", uid: context.uid },
          entityType: "storageEndpoint",
          entityId: input.key,
          changes: [{ field: "served", after: "host, port, basePath, credentialRef, allowedPrefixes" }],
          at,
        },
        db,
      );
      return {
        host: endpoint.connection.host,
        port: endpoint.connection.port ?? null,
        basePath: endpoint.connection.basePath ?? null,
        credentialRef: endpoint.connection.credentialRef ?? null,
        allowedPrefixes: endpoint.connection.allowedPrefixes ?? {},
      };
    });
  },
});
