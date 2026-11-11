import { isDeepStrictEqual } from "node:util";
import {
  type AuditChange,
  COLLECTIONS,
  type EquipmentConfigurationInput,
  laboratoryEquipmentDocSchema,
  nestedEntityId,
  parseStoredDocument,
  saveEquipmentConfigurationContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

/** The fields of a configuration that a person states, in the order the audit entry lists them. */
const STATED_FIELDS = [
  "name",
  "amplifierManufacturer",
  "amplifierModel",
  "capType",
  "electrodeType",
  "channelCount",
  "samplingRatesHz",
  "referenceScheme",
  "triggerMethod",
  "presentationSoftware",
  "stimulusComputer",
  "displayRefreshHz",
  "eyeTracker",
  "responseDevices",
  "notes",
] as const satisfies readonly (keyof EquipmentConfigurationInput)[];

const NOT_CURRENT_MESSAGE =
  "This configuration has been replaced since you opened it, so nothing was saved. Reload the page and edit the current configuration.";

/**
 * Saves an equipment configuration of a laboratory (docs/DATA_MODEL.md, section 4). No client
 * writes equipment, so this function is the only way a configuration changes.
 *
 * | Caller                                         | May                                          |
 * |------------------------------------------------|----------------------------------------------|
 * | A holder of `labs.manage` for the laboratory   | Open a configuration, or replace the current one: the coordinators of the laboratory, the core team and programme administrators, with the second factor where the access document requires one |
 *
 * Replacing the current configuration closes it, by setting `validTo` and clearing
 * `isCurrent`, and opens a new configuration that names it in `supersedesId`, in one
 * transaction with the audit entry, so each chain has exactly one current configuration and a
 * closed one never changes. The verbatim EEG system of an imported configuration and its free
 * map of other equipment are carried to the new one unchanged. A save that states exactly what
 * the current configuration states writes nothing, so a repeated call is harmless.
 */
export const saveEquipmentConfiguration = defineCallable(saveEquipmentConfigurationContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const { laboratoryId, replacesConfigurationId, configuration } = input;
    const laboratoryReference = db.doc(COLLECTIONS.laboratories.docPath(laboratoryId));
    const newReference = db.collection(COLLECTIONS.laboratoryEquipment.collectionPath(laboratoryId)).doc();

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      requireCapability(context, access, "labs.manage", { laboratoryId });
      const laboratory = await transaction.get(laboratoryReference);
      if (!laboratory.exists) throw new AppError("not-found", "This laboratory does not exist.");
      if (laboratory.get("archivedAt") != null) {
        throw new AppError("failed-precondition", "This laboratory is archived, so its equipment cannot change.");
      }
      const previousReference =
        replacesConfigurationId === null
          ? null
          : db.doc(COLLECTIONS.laboratoryEquipment.docPath(laboratoryId, replacesConfigurationId));
      const previousSnapshot = previousReference === null ? null : await transaction.get(previousReference);
      const previous =
        previousSnapshot === null
          ? null
          : previousSnapshot.exists
            ? parseStoredDocument(laboratoryEquipmentDocSchema, previousSnapshot.data())
            : null;
      if (previousReference !== null && previous === null) {
        throw new AppError("not-found", "This equipment configuration does not exist.");
      }
      if (previous !== null && !previous.success) throw previous.error;
      const stored = previous?.data ?? null;
      if (stored !== null && (!stored.isCurrent || stored.archivedAt !== null)) {
        throw new AppError("failed-precondition", NOT_CURRENT_MESSAGE);
      }

      const changes: AuditChange[] = STATED_FIELDS.flatMap((field) => {
        const before = stored?.[field];
        const after = configuration[field];
        return isDeepStrictEqual(before, after) ? [] : [{ field, before: before ?? null, after: after ?? null }];
      });
      if (stored !== null && previousReference !== null && changes.length === 0) {
        return { laboratoryId, configurationId: previousReference.id, supersededId: null, changed: false };
      }

      const auditEventId = writeAudit(
        transaction,
        {
          action: "equipment.saved",
          actor: { kind: "user", uid },
          entityType: "equipmentConfiguration",
          entityId: nestedEntityId(laboratoryId, newReference.id),
          changes: [...changes, { field: "supersedesId", after: previousReference?.id ?? null }],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const now = Timestamp.fromDate(at);
      if (previousReference !== null) {
        transaction.update(previousReference, { isCurrent: false, validTo: now, ...touchedFields(stamp) });
      }
      transaction.create(
        newReference,
        laboratoryEquipmentDocSchema.parse({
          ...createdFields("laboratoryEquipment", stamp),
          laboratoryId,
          ...configuration,
          ...(stored?.eegSystemSource === undefined ? {} : { eegSystemSource: stored.eegSystemSource }),
          ...(stored?.other === undefined ? {} : { other: stored.other }),
          isCurrent: true,
          validFrom: now,
          validTo: null,
          supersedesId: previousReference?.id ?? null,
        }),
      );
      return {
        laboratoryId,
        configurationId: newReference.id,
        supersededId: previousReference?.id ?? null,
        changed: true,
      };
    });
  },
});
