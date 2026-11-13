// Integration tests of laboratory registration and equipment, run against the emulators:
// requestLabClaim with a proposed laboratory, reviewLabClaim of such a request, createLaboratory
// and saveEquipmentConfiguration.
// Fixtures are synthetic: fictitious accounts, people, institutions and laboratories on the example.org domain.
import {
  COLLECTIONS,
  createLaboratoryContract,
  DEMO_IDENTITY_HASH_KEY,
  identityKeyId,
  labClaimDocSchema,
  laboratoryDocSchema,
  laboratoryEquipmentDocSchema,
  organisationKey,
  registeredInstitutionId,
  registeredLaboratoryId,
  requestLabClaimContract,
  reviewLabClaimContract,
  roleAssignmentId,
  saveEquipmentConfigurationContract,
} from "@eegml/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  codeOf,
  coreTeamMember,
  dataOf,
  grantRole,
  institution,
  laboratory,
  person,
  refusal,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

withoutTriggers();
beforeEach(resetWorld);

const NEW_INSTITUTION = {
  kind: "new",
  name: "Synthetic Example University",
  countryCode: "GB",
  city: "Exampleton",
} as const;
const PROPOSAL = {
  name: "Synthetic Vision Laboratory",
  institution: NEW_INSTITUTION,
  department: "Psychology",
} as const;
const INSTITUTION_ID = registeredInstitutionId(NEW_INSTITUTION.name, NEW_INSTITUTION.countryCode);
const LABORATORY_ID = registeredLaboratoryId(INSTITUTION_ID, PROPOSAL.name);

/** A member with a linked person, as a claim makes one. */
async function member(uid: string, personId: string): Promise<Caller> {
  await person(personId, [{ email: `${uid}@example.org` }], { userId: uid });
  return account(uid, { personId });
}

const keyPath = (entityType: "laboratory" | "institution", kind: string, key: string) =>
  COLLECTIONS.identityKeys.docPath(identityKeyId(entityType, kind, key, DEMO_IDENTITY_HASH_KEY));

describe("registering a laboratory", () => {
  it("files a request under the identifier the proposed laboratory will take, and creates nothing yet", async () => {
    const ada = await member("uid-ada", "person-ada");
    const answer = await call(ada, requestLabClaimContract, { proposal: PROPOSAL, requestedRole: "coordinator" });
    expect(answer).toEqual({
      claimId: `uid-ada__${LABORATORY_ID}`,
      laboratoryId: LABORATORY_ID,
      status: "pendingReview",
      duplicate: false,
    });
    const claim = labClaimDocSchema.parse(await dataOf(COLLECTIONS.labClaims.docPath(answer.claimId)));
    expect(claim.proposal).toEqual({
      name: PROPOSAL.name,
      institutionId: INSTITUTION_ID,
      newInstitution: { name: NEW_INSTITUTION.name, countryCode: "GB", city: "Exampleton" },
      department: "Psychology",
    });
    expect((await adminDb.doc(COLLECTIONS.laboratories.docPath(LABORATORY_ID)).get()).exists).toBe(false);
    expect((await adminDb.doc(COLLECTIONS.institutions.docPath(INSTITUTION_ID)).get()).exists).toBe(false);
    expect(await auditOf("labClaim.requested", LABORATORY_ID)).toHaveLength(1);
  });

  it("refuses a member without a linked person and an existing institution that does not exist", async () => {
    const stranger = await account("uid-stranger");
    expect(
      await codeOf(call(stranger, requestLabClaimContract, { proposal: PROPOSAL, requestedRole: "coordinator" })),
    ).toBe("failed-precondition");
    const ada = await member("uid-ada", "person-ada");
    const missing = await refusal(
      call(ada, requestLabClaimContract, {
        proposal: { name: "Synthetic Lab", institution: { kind: "existing", institutionId: "inst-missing" } },
        requestedRole: "representative",
      }),
    );
    expect(missing.code).toBe("failed-precondition");
    expect(
      await codeOf(call(null, requestLabClaimContract, { proposal: PROPOSAL, requestedRole: "coordinator" })),
    ).toBe("unauthenticated");
  });

  it("gives the same laboratory proposed twice, however its name is spelt, one identifier", async () => {
    const ada = await member("uid-ada", "person-ada");
    const ben = await member("uid-ben", "person-ben");
    const first = await call(ada, requestLabClaimContract, { proposal: PROPOSAL, requestedRole: "coordinator" });
    const second = await call(ben, requestLabClaimContract, {
      proposal: {
        ...PROPOSAL,
        name: "  synthetic VISION laboratory ",
        institution: { ...NEW_INSTITUTION, name: "synthetic example university" },
      },
      requestedRole: "representative",
    });
    expect(second.laboratoryId).toBe(first.laboratoryId);
    expect(await codeOf(call(ada, requestLabClaimContract, { proposal: PROPOSAL, requestedRole: "coordinator" }))).toBe(
      "resource-exhausted",
    );
  });

  it("is created on approval, with its institution, keys, member entry, role and audit entries, in one decision", async () => {
    const ada = await member("uid-ada", "person-ada");
    const admin = await administrator("uid-admin");
    const { claimId } = await call(ada, requestLabClaimContract, { proposal: PROPOSAL, requestedRole: "coordinator" });
    const otherCoordinator = await account("uid-other-coordinator");
    await laboratory("lab-other");
    await grantRole("uid-other-coordinator", "lab_coordinator", "laboratory", "lab-other");
    expect(await codeOf(call(otherCoordinator, reviewLabClaimContract, { claimId, decision: "approve" }))).toBe(
      "permission-denied",
    );
    expect(await codeOf(call(ada, reviewLabClaimContract, { claimId, decision: "approve" }))).toBe("permission-denied");

    expect(await call(admin, reviewLabClaimContract, { claimId, decision: "approve" })).toEqual({
      claimId,
      status: "approved",
    });
    const created = laboratoryDocSchema.parse(await dataOf(COLLECTIONS.laboratories.docPath(LABORATORY_ID)));
    expect(created).toMatchObject({
      name: PROPOSAL.name,
      institutionId: INSTITUTION_ID,
      department: "Psychology",
      countryCode: "GB",
      city: "Exampleton",
      status: "active",
      dataOrigin: "live",
    });
    expect(await dataOf(COLLECTIONS.institutions.docPath(INSTITUTION_ID))).toMatchObject({
      name: NEW_INSTITUTION.name,
      countryCode: "GB",
      city: "Exampleton",
    });
    const labKey = organisationKey.laboratory(INSTITUTION_ID, PROPOSAL.name) ?? "";
    expect(await dataOf(keyPath("laboratory", "nameAffiliation", labKey))).toMatchObject({
      entityIds: [LABORATORY_ID],
      status: "active",
    });
    expect(await dataOf(keyPath("laboratory", "slug", created.slug))).toMatchObject({ entityIds: [LABORATORY_ID] });
    expect(await dataOf(COLLECTIONS.laboratoryMembers.docPath(LABORATORY_ID, "person-ada"))).toMatchObject({
      role: "coordinator",
      isAuthorisedRepresentative: true,
      status: "confirmed",
    });
    expect(
      await dataOf(
        COLLECTIONS.roleAssignments.docPath(
          roleAssignmentId("uid-ada", "lab_coordinator", "laboratory", LABORATORY_ID),
        ),
      ),
    ).toMatchObject({ status: "active" });
    expect((await dataOf(COLLECTIONS.access.docPath("uid-ada")))?.coordinatorLaboratoryIds).toEqual([LABORATORY_ID]);
    expect(await auditOf("laboratory.created", LABORATORY_ID)).toHaveLength(1);
    expect(await auditOf("institution.created", INSTITUTION_ID)).toHaveLength(1);
    expect(await auditOf("labClaim.approved", LABORATORY_ID)).toHaveLength(1);

    // A repeated decision changes nothing and creates nothing twice.
    expect(await call(admin, reviewLabClaimContract, { claimId, decision: "approve" })).toEqual({
      claimId,
      status: "approved",
    });
    expect(await auditOf("laboratory.created", LABORATORY_ID)).toHaveLength(1);
  });

  it("is a duplicate once the laboratory exists, and its approval joins the laboratory that exists", async () => {
    const ada = await member("uid-ada", "person-ada");
    const ben = await member("uid-ben", "person-ben");
    const admin = await administrator("uid-admin");
    const first = await call(ada, requestLabClaimContract, { proposal: PROPOSAL, requestedRole: "coordinator" });
    await call(admin, reviewLabClaimContract, { claimId: first.claimId, decision: "approve" });

    const second = await call(ben, requestLabClaimContract, { proposal: PROPOSAL, requestedRole: "representative" });
    expect(second).toMatchObject({ laboratoryId: LABORATORY_ID, duplicate: true });
    expect((await dataOf(COLLECTIONS.labClaimReview.docPath(second.claimId)))?.evidence).toMatchObject({
      proposal: true,
      duplicateOfLaboratoryId: LABORATORY_ID,
    });
    await call(admin, reviewLabClaimContract, { claimId: second.claimId, decision: "approve" });
    const laboratories = await adminDb.collection(COLLECTIONS.laboratories.collectionPath()).get();
    expect(laboratories.size).toBe(1);
    expect(await dataOf(COLLECTIONS.laboratoryMembers.docPath(LABORATORY_ID, "person-ben"))).toMatchObject({
      role: "representative",
      isAuthorisedRepresentative: true,
      status: "confirmed",
    });
    expect(await auditOf("laboratory.created", LABORATORY_ID)).toHaveLength(1);
  });

  it("finds a laboratory that an import created under its own identifier as a duplicate through its name key", async () => {
    await institution("inst-imported", []);
    await laboratory("lab__imported", { name: "Imported Laboratory", institutionId: "inst-imported" });
    const key = organisationKey.laboratory("inst-imported", "Imported Laboratory") ?? "";
    await adminDb.doc(keyPath("laboratory", "nameAffiliation", key)).set({
      ...standard(),
      entityType: "laboratory",
      keyKind: "nameAffiliation",
      entityIds: ["lab__imported"],
      status: "active",
      mergedIntoId: null,
    });
    const ada = await member("uid-ada", "person-ada");
    const answer = await call(ada, requestLabClaimContract, {
      proposal: { name: "imported laboratory", institution: { kind: "existing", institutionId: "inst-imported" } },
      requestedRole: "representative",
    });
    expect(answer.duplicate).toBe(true);
    expect((await dataOf(COLLECTIONS.labClaimReview.docPath(answer.claimId)))?.evidence).toMatchObject({
      duplicateOfLaboratoryId: "lab__imported",
    });
  });
});

describe("createLaboratory", () => {
  it("creates a laboratory for an administrator and the core team, and refuses everyone else", async () => {
    const admin = await administrator("uid-admin");
    const core = await coreTeamMember("uid-core");
    const coordinator = await account("uid-coordinator");
    await laboratory("lab-own");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-own");
    const adminWithoutFactor = await administrator("uid-admin-2", { secondFactor: false });

    expect(await codeOf(call(coordinator, createLaboratoryContract, PROPOSAL))).toBe("permission-denied");
    expect(await codeOf(call(adminWithoutFactor, createLaboratoryContract, PROPOSAL))).toBe("failed-precondition");
    expect(await call(admin, createLaboratoryContract, PROPOSAL)).toEqual({
      laboratoryId: LABORATORY_ID,
      institutionId: INSTITUTION_ID,
      institutionCreated: true,
    });
    const duplicate = await refusal(
      call(core, createLaboratoryContract, { ...PROPOSAL, name: "Synthetic  Vision laboratory" }),
    );
    expect(duplicate.code).toBe("already-exists");
    const another = await call(core, createLaboratoryContract, {
      name: "Synthetic Sleep Laboratory",
      institution: { kind: "existing", institutionId: INSTITUTION_ID },
      website: "https://example.org/sleep",
    });
    expect(another.institutionCreated).toBe(false);
    expect(await dataOf(COLLECTIONS.laboratories.docPath(another.laboratoryId))).toMatchObject({
      countryCode: "GB",
      city: "Exampleton",
      website: "https://example.org/sleep",
    });
    expect(await auditOf("laboratory.created")).toHaveLength(2);
    expect(await auditOf("institution.created")).toHaveLength(1);
  });
});

describe("saveEquipmentConfiguration", () => {
  const LAB = "lab-equipment";
  const FIRST = { name: "Main booth", channelCount: 64, samplingRatesHz: [500, 1000] };

  async function world() {
    await laboratory(LAB);
    await laboratory("lab-elsewhere");
    const coordinator = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", LAB);
    const labMember = await account("uid-lab-member");
    await grantRole("uid-lab-member", "lab_member", "laboratory", LAB);
    const elsewhere = await account("uid-elsewhere");
    await grantRole("uid-elsewhere", "lab_coordinator", "laboratory", "lab-elsewhere");
    return { coordinator, labMember, elsewhere };
  }

  const configurations = async () =>
    (await adminDb.collection(COLLECTIONS.laboratoryEquipment.collectionPath(LAB)).get()).docs.map((document) => ({
      id: document.id,
      updateTime: document.updateTime.toMillis(),
      data: laboratoryEquipmentDocSchema.parse(document.data()),
    }));

  it("lets a coordinator of the laboratory open a configuration, and refuses everyone else", async () => {
    const { coordinator, labMember, elsewhere } = await world();
    const input = { laboratoryId: LAB, replacesConfigurationId: null, configuration: FIRST };
    expect(await codeOf(call(labMember, saveEquipmentConfigurationContract, input))).toBe("permission-denied");
    expect(await codeOf(call(elsewhere, saveEquipmentConfigurationContract, input))).toBe("permission-denied");
    expect(await codeOf(call(null, saveEquipmentConfigurationContract, input))).toBe("unauthenticated");
    const saved = await call(coordinator, saveEquipmentConfigurationContract, input);
    expect(saved).toMatchObject({ laboratoryId: LAB, supersededId: null, changed: true });
    const [only] = await configurations();
    expect(only?.data).toMatchObject({ ...FIRST, isCurrent: true, validTo: null, supersedesId: null });
    expect(await auditOf("equipment.saved", `${LAB}__${saved.configurationId}`)).toHaveLength(1);
  });

  it("closes the current configuration and opens its successor, and never rewrites a closed one", async () => {
    const { coordinator } = await world();
    const first = await call(coordinator, saveEquipmentConfigurationContract, {
      laboratoryId: LAB,
      replacesConfigurationId: null,
      configuration: FIRST,
    });
    const second = await call(coordinator, saveEquipmentConfigurationContract, {
      laboratoryId: LAB,
      replacesConfigurationId: first.configurationId,
      configuration: { ...FIRST, channelCount: 128 },
    });
    expect(second).toMatchObject({ supersededId: first.configurationId, changed: true });
    const afterSecond = await configurations();
    const closed = afterSecond.find((entry) => entry.id === first.configurationId);
    const current = afterSecond.find((entry) => entry.id === second.configurationId);
    expect(closed?.data).toMatchObject({ isCurrent: false, channelCount: 64 });
    expect(closed?.data.validTo).not.toBeNull();
    expect(current?.data).toMatchObject({ isCurrent: true, channelCount: 128, supersedesId: first.configurationId });

    // The closed configuration cannot be edited again: the save is refused and it stays as it was.
    const stale = await refusal(
      call(coordinator, saveEquipmentConfigurationContract, {
        laboratoryId: LAB,
        replacesConfigurationId: first.configurationId,
        configuration: { ...FIRST, channelCount: 32 },
      }),
    );
    expect(stale.code).toBe("failed-precondition");
    const third = await call(coordinator, saveEquipmentConfigurationContract, {
      laboratoryId: LAB,
      replacesConfigurationId: second.configurationId,
      configuration: { ...FIRST, channelCount: 256, eyeTracker: "Example tracker" },
    });
    const all = await configurations();
    expect(all.find((entry) => entry.id === first.configurationId)?.updateTime).toBe(closed?.updateTime);
    expect(all.filter((entry) => entry.data.isCurrent).map((entry) => entry.id)).toEqual([third.configurationId]);
    expect(await auditOf("equipment.saved")).toHaveLength(3);
  });

  it("writes nothing for a save that changes nothing, and keeps separate chains apart", async () => {
    const { coordinator } = await world();
    const first = await call(coordinator, saveEquipmentConfigurationContract, {
      laboratoryId: LAB,
      replacesConfigurationId: null,
      configuration: FIRST,
    });
    const again = await call(coordinator, saveEquipmentConfigurationContract, {
      laboratoryId: LAB,
      replacesConfigurationId: first.configurationId,
      configuration: FIRST,
    });
    expect(again).toEqual({
      laboratoryId: LAB,
      configurationId: first.configurationId,
      supersededId: null,
      changed: false,
    });
    await call(coordinator, saveEquipmentConfigurationContract, {
      laboratoryId: LAB,
      replacesConfigurationId: null,
      configuration: { name: "Mobile kit", channelCount: 32 },
    });
    const all = await configurations();
    expect(all).toHaveLength(2);
    expect(all.every((entry) => entry.data.isCurrent)).toBe(true);
    expect(await auditOf("equipment.saved")).toHaveLength(2);
  });
});
