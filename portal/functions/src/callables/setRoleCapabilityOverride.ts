import {
  type CapabilityField,
  COLLECTIONS,
  capabilityField,
  GRANTABLE_CAPABILITIES,
  type GrantableCapability,
  PROGRAMME_KEY,
  parseStoredDocument,
  roleCanHold,
  roleCapabilitiesDocSchema,
  setRoleCapabilityOverrideContract,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  touchedFields,
  writeAudit,
} from "../framework";

const CAPABILITY_OF_FIELD = new Map<CapabilityField, GrantableCapability>(
  GRANTABLE_CAPABILITIES.map((capability) => [capabilityField(capability), capability]),
);

/**
 * Sets or clears one override of the default capability matrix (docs/SECURITY.md, section 5).
 * For programme administrators who hold `roles.manage`, with the second factor wherever the
 * caller's access document requires one. This is how a sensitive operation is switched on or
 * off for the core team.
 *
 * An override that could never take effect is refused: a scoped role never holds a capability
 * of the level `programme`. The two roles that take no overrides, the programme administrator
 * and the external collaborator, are no part of the contract.
 *
 * The function writes the override and its audit entry. A trigger then resolves the access
 * document of every account again, which can take a few seconds.
 */
export const setRoleCapabilityOverride = defineCallable(setRoleCapabilityOverrideContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();
    const field = capabilityField(input.capability);
    const reference = db.doc(COLLECTIONS.roleCapabilities.docPath(input.role));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, actor, transaction);
      requireCapability(context, access, "roles.manage", "programme");
      requireProgrammeAdministrator(access);
      if (!roleCanHold(input.role, input.capability)) {
        throw new AppError(
          "failed-precondition",
          "This role can never hold this capability, because the capability belongs to the programme as a whole.",
        );
      }
      const snapshot = await transaction.get(reference);
      const stored = snapshot.exists ? parseStoredDocument(roleCapabilitiesDocSchema, snapshot.data()) : null;
      if (stored !== null && !stored.success) throw stored.error;
      const before = stored?.data.overrides ?? {};
      const overrides = { ...before };
      if (input.allowed === null) delete overrides[field];
      else overrides[field] = input.allowed;
      const named = Object.fromEntries(
        (Object.entries(overrides) as [CapabilityField, boolean][]).flatMap(([key, allowed]) => {
          const capability = CAPABILITY_OF_FIELD.get(key);
          return capability === undefined ? [] : [[capability, allowed] as const];
        }),
      );
      if ((before[field] ?? null) === input.allowed) return { role: input.role, overrides: named };

      const auditEventId = writeAudit(
        transaction,
        {
          action: "roleCapabilities.changed",
          actor: { kind: "user", uid: actor },
          entityType: "programme",
          entityId: PROGRAMME_KEY,
          changes: [
            { field: "role", after: input.role },
            { field: "capability", after: input.capability },
            { field: "allowed", before: before[field] ?? null, after: input.allowed },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      transaction.set(
        reference,
        roleCapabilitiesDocSchema.parse(
          stored === null
            ? { ...createdFields("roleCapabilities", stamp), role: input.role, overrides }
            : { ...stored.data, ...touchedFields(stamp), overrides },
        ),
      );
      return { role: input.role, overrides: named };
    });
  },
});
