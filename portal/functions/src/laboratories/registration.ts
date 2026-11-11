// What registering a laboratory writes, shared by the review of a laboratory claim that proposes
// one (`reviewLabClaim`) and the direct creation by an administrator (`createLaboratory`).
//
// A laboratory and an institution that are registered in the portal take the identifiers that
// their name keys give them (`registeredLaboratoryId`, `registeredInstitutionId`), and the same
// keys are reserved as identity keys in the transaction that creates them, so an import finds
// them again and the same laboratory proposed twice is one document. A key that names another
// record already, such as a laboratory that an import created under its own identifier, makes
// the proposal a duplicate of that record.
import {
  COLLECTIONS,
  fold,
  identityKeyDocSchema,
  identityKeyId,
  institutionDocSchema,
  type LaboratoryInput,
  type LaboratoryProposal,
  laboratoryDocSchema,
  type NewInstitution,
  organisationKey,
  parseStoredDocument,
  registeredInstitutionId,
  registeredLaboratoryId,
} from "@eegml/shared";
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { AppError, createdFields, type WriteStamp } from "../framework";

/** The proposal of a laboratory from what a person entered: identifiers derived, texts as entered. */
export function proposalOf(input: LaboratoryInput): LaboratoryProposal {
  const newInstitution: NewInstitution | null =
    input.institution.kind === "new"
      ? { name: input.institution.name, countryCode: input.institution.countryCode, city: input.institution.city }
      : null;
  const institutionId =
    input.institution.kind === "existing"
      ? input.institution.institutionId
      : registeredInstitutionId(input.institution.name, input.institution.countryCode);
  return {
    name: input.name,
    institutionId,
    ...(newInstitution === null ? {} : { newInstitution }),
    ...(input.department === undefined ? {} : { department: input.department }),
    ...(input.website === undefined ? {} : { website: input.website }),
  };
}

/** The identifier that a proposed laboratory takes. */
export function proposedLaboratoryId(proposal: LaboratoryProposal): string {
  return registeredLaboratoryId(proposal.institutionId, proposal.name);
}

/** The slug of a registered laboratory: its folded name and the start of the hash of its identifier, which keeps it unique. */
export function laboratorySlug(laboratoryId: string, name: string): string {
  const hash = laboratoryId.slice(laboratoryId.lastIndexOf("_") + 1, laboratoryId.lastIndexOf("_") + 7);
  const base = fold(name).slice(0, 80).replace(/-+$/, "");
  return base === "" ? `lab-${hash}` : `${base}-${hash}`;
}

interface KeyRead {
  readonly reference: DocumentReference;
  readonly snapshot: DocumentSnapshot;
}

/** What the transaction has read before it writes a registration. */
export interface RegistrationState {
  readonly proposal: LaboratoryProposal;
  readonly laboratoryId: string;
  readonly laboratoryReference: DocumentReference;
  /** The laboratory that exists already under the identifier or the name key, or null. */
  readonly existingLaboratoryId: string | null;
  readonly institution: DocumentSnapshot;
  readonly laboratoryKey: KeyRead;
  readonly institutionKey: KeyRead | null;
  readonly slugKey: KeyRead;
  readonly slug: string;
}

const EXISTING_INSTITUTION_MESSAGE =
  "This institution exists already under this name and country. Choose it from the list of institutions.";

function holderOf(snapshot: DocumentSnapshot): readonly string[] {
  if (!snapshot.exists) return [];
  const parsed = parseStoredDocument(identityKeyDocSchema, snapshot.data());
  if (!parsed.success) throw parsed.error;
  return parsed.data.entityIds;
}

/**
 * Reads, inside a transaction and before its first write, everything that a registration needs:
 * the laboratory, its institution and the identity keys of both. Refuses an existing
 * institution that is missing or archived, and a new institution whose name key is held by
 * another institution that exists, which then has to be chosen as an existing institution.
 */
export async function readRegistration(
  db: Firestore,
  transaction: Transaction,
  proposal: LaboratoryProposal,
  secret: string,
): Promise<RegistrationState> {
  const laboratoryId = proposedLaboratoryId(proposal);
  const slug = laboratorySlug(laboratoryId, proposal.name);
  const laboratoryKeyText = organisationKey.laboratory(proposal.institutionId, proposal.name);
  if (laboratoryKeyText === null)
    throw new AppError("invalid-argument", "The name needs at least one letter or digit. Enter it again.");
  const institutionKeyText =
    proposal.newInstitution === undefined
      ? null
      : organisationKey.institution(proposal.newInstitution.name, proposal.newInstitution.countryCode);
  const keyReference = (entityType: "laboratory" | "institution", kind: string, key: string) =>
    db.doc(COLLECTIONS.identityKeys.docPath(identityKeyId(entityType, kind, key, secret)));
  const laboratoryKeyReference = keyReference("laboratory", "nameAffiliation", laboratoryKeyText);
  const slugKeyReference = keyReference("laboratory", "slug", slug);
  const institutionKeyReference =
    institutionKeyText === null ? null : keyReference("institution", "nameAffiliation", institutionKeyText);
  const laboratoryReference = db.doc(COLLECTIONS.laboratories.docPath(laboratoryId));
  const [laboratory, institution, laboratoryKey, slugKey, institutionKey] = await transaction.getAll(
    laboratoryReference,
    db.doc(COLLECTIONS.institutions.docPath(proposal.institutionId)),
    laboratoryKeyReference,
    slugKeyReference,
    ...(institutionKeyReference === null ? [] : [institutionKeyReference]),
  );
  if (laboratory === undefined || institution === undefined || laboratoryKey === undefined || slugKey === undefined) {
    throw new Error("The transaction returned no snapshot.");
  }
  if (proposal.newInstitution === undefined) {
    if (!institution.exists || institution.get("archivedAt") != null) {
      throw new AppError(
        "failed-precondition",
        "The institution of this laboratory does not exist. Choose another one.",
      );
    }
  } else if (institutionKey !== undefined && holderOf(institutionKey).some((id) => id !== proposal.institutionId)) {
    // An institution that an import or an earlier registration created under another
    // identifier holds the name key, so a new one would stand beside it and its laboratories
    // would escape the search for duplicates.
    throw new AppError("failed-precondition", EXISTING_INSTITUTION_MESSAGE);
  }
  const keyHolders = holderOf(laboratoryKey).filter((id) => id !== laboratoryId);
  const existingLaboratoryId = laboratory.exists ? laboratoryId : (keyHolders[0] ?? null);
  return {
    proposal,
    laboratoryId,
    laboratoryReference,
    existingLaboratoryId,
    institution,
    laboratoryKey: { reference: laboratoryKeyReference, snapshot: laboratoryKey },
    institutionKey:
      institutionKeyReference === null || institutionKey === undefined
        ? null
        : { reference: institutionKeyReference, snapshot: institutionKey },
    slugKey: { reference: slugKeyReference, snapshot: slugKey },
    slug,
  };
}

const keyDocument = (
  stamp: WriteStamp,
  entityType: "laboratory" | "institution",
  keyKind: "nameAffiliation" | "slug",
  id: string,
  held: readonly string[],
) =>
  identityKeyDocSchema.parse({
    ...createdFields("identityKeys", stamp),
    entityType,
    keyKind,
    entityIds: [...new Set([...held, id])].sort(),
    status: "active",
    mergedIntoId: null,
  });

/**
 * Writes a new laboratory, with its institution where that is new, and reserves their keys.
 * Call it only where `existingLaboratoryId` is null. Returns whether an institution was created.
 */
export function writeRegistration(
  transaction: Transaction,
  state: RegistrationState,
  stamp: WriteStamp,
  status: "unverified" | "active",
): { institutionCreated: boolean } {
  const { proposal, laboratoryId } = state;
  if (state.existingLaboratoryId !== null) throw new Error("A laboratory that exists is never registered again.");
  if (holderOf(state.slugKey.snapshot).some((id) => id !== laboratoryId)) {
    throw new AppError(
      "already-exists",
      "Another laboratory has the same address in the portal. Change the name slightly.",
    );
  }
  const created = proposal.newInstitution !== undefined && !state.institution.exists;
  const stored = state.institution.exists ? parseStoredDocument(institutionDocSchema, state.institution.data()) : null;
  if (stored !== null && !stored.success) throw stored.error;
  const countryCode = proposal.newInstitution?.countryCode ?? stored?.data.countryCode;
  const city = proposal.newInstitution?.city ?? stored?.data.city;
  if (created && proposal.newInstitution !== undefined) {
    transaction.create(
      state.institution.ref,
      institutionDocSchema.parse({
        ...createdFields("institutions", stamp),
        name: proposal.newInstitution.name,
        countryCode: proposal.newInstitution.countryCode,
        city: proposal.newInstitution.city,
        emailDomains: [],
      }),
    );
    if (state.institutionKey !== null) {
      transaction.set(
        state.institutionKey.reference,
        keyDocument(
          stamp,
          "institution",
          "nameAffiliation",
          proposal.institutionId,
          holderOf(state.institutionKey.snapshot),
        ),
      );
    }
  }
  transaction.create(
    state.laboratoryReference,
    laboratoryDocSchema.parse({
      ...createdFields("laboratories", stamp),
      slug: state.slug,
      name: proposal.name,
      institutionId: proposal.institutionId,
      ...(proposal.department === undefined ? {} : { department: proposal.department }),
      ...(countryCode === undefined ? {} : { countryCode }),
      ...(city === undefined ? {} : { city }),
      ...(proposal.website === undefined ? {} : { website: proposal.website }),
      status,
      custom: {},
      dataOrigin: "live",
    }),
  );
  transaction.set(
    state.laboratoryKey.reference,
    keyDocument(stamp, "laboratory", "nameAffiliation", laboratoryId, holderOf(state.laboratoryKey.snapshot)),
  );
  transaction.set(state.slugKey.reference, keyDocument(stamp, "laboratory", "slug", laboratoryId, []));
  return { institutionCreated: created };
}
