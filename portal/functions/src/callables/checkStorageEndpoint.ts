import { checkStorageEndpointContract } from "@eegml/shared";
import { runEndpointCheck } from "../datasets/endpoints";
import { defineCallable, readAccessDocument, requireCapability } from "../framework";

/**
 * Checks that a storage server answers, for a holder of `datasets.manage` for the programme
 * (docs/INTEGRATIONS.md, sections 7 and 9). The check asks the server for the base path and
 * reads no file. A server that answers becomes active and records when it was seen; one that
 * does not answer, or answers too slowly, becomes unreachable with the reason, and the first
 * time it does its owner and those who manage the integrations are told. The audit entry
 * records the outcome.
 */
export const checkStorageEndpoint = defineCallable(checkStorageEndpointContract, {
  handler: async (input, context) => {
    const access = await readAccessDocument(context.db, context.uid);
    requireCapability(context, access, "datasets.manage", "programme");
    return runEndpointCheck(context.db, input.key, { kind: "user", uid: context.uid }, context.clock.now());
  },
});
