import { COLLECTIONS, capabilityGrantId, exportPersonDataContract } from "@eegml/shared";
import {
  AppError,
  authentication,
  defineCallable,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  writeAudit,
} from "../framework";
import { gatherPersonData } from "../governance/person-data";
import { grantInForce } from "../people/demographics-grant";

/**
 * The subject access export of one person (docs/SECURITY.md, section 6): everything the portal
 * holds about the person, as JSON, for a programme administrator who holds `people.manage`, with
 * the second factor. The special-category document is included only while the caller holds an
 * unexpired, unrevoked named grant of `demographics.read`, as for every other read of it.
 *
 * The export is returned to the caller and stored nowhere. Its audit entry names the person, the
 * number of documents and accounts and whether special-category data was included, and no value.
 */
export const exportPersonData = defineCallable(exportPersonDataContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "people.manage", "programme");
    requireProgrammeAdministrator(access);
    const person = await db.doc(COLLECTIONS.persons.docPath(input.personId)).get();
    if (!person.exists) throw new AppError("not-found", "This person does not exist.");
    const grant = await db.doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId(uid, "demographics.read"))).get();
    const includeSpecial = grantInForce(grant, at);

    const data = await gatherPersonData(db, authentication(), input.personId, includeSpecial);
    const batch = db.batch();
    writeAudit(
      batch,
      {
        action: "person.dataExported",
        actor: { kind: "user", uid },
        entityType: "person",
        entityId: input.personId,
        changes: [
          { field: "documents", after: data.documents.length },
          { field: "accounts", after: data.accounts.length },
          { field: "specialCategoryIncluded", after: includeSpecial },
          { field: "truncated", after: data.truncated },
        ],
        at,
      },
      db,
    );
    await batch.commit();
    return {
      personId: input.personId,
      exportedAt: at.toISOString(),
      specialCategoryIncluded: includeSpecial,
      truncated: data.truncated,
      documents: data.documents,
      accounts: data.accounts,
    };
  },
});
