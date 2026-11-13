// Integration tests of editReplicationCitation, run against the emulators: a change to a citation
// that has been checked returns it to unverified, with its audit entry, and is refused outside
// the replication.
// Fixtures are synthetic: fictitious accounts and studies on the example.org domain.
import { COLLECTIONS, editReplicationCitationContract } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../support/admin";
import { account, auditOf, call, codeOf, dataOf, grantRole, replication, resetWorld, withoutTriggers } from "./support";

withoutTriggers();
beforeEach(resetWorld);

const STUDY = "SyntheticStudy2001";
const PATH = COLLECTIONS.replications.docPath(STUDY);

async function world() {
  await replication(STUDY);
  await adminDb.doc(PATH).update({
    originalTitle: "A synthetic original study",
    originalDoi: "10.5555/synthetic.2001",
    citationStatus: "verified",
    citationCheckedAt: Timestamp.now(),
    citationSource: "Synthetic registry",
  });
  const lead = await account("uid-lead");
  await grantRole("uid-lead", "replication_lead", "replication", STUDY);
  const otherLead = await account("uid-other-lead");
  await grantRole("uid-other-lead", "replication_lead", "replication", "SyntheticStudy2002");
  return { lead, otherLead };
}

describe("editReplicationCitation", () => {
  it("changes a checked citation and marks it as unverified, with the check removed and an audit entry", async () => {
    const { lead } = await world();
    expect(
      await call(lead, editReplicationCitationContract, {
        replicationId: STUDY,
        field: "originalTitle",
        value: "A corrected synthetic title",
      }),
    ).toEqual({ replicationId: STUDY, citationStatus: "unverified" });
    const stored = await dataOf(PATH);
    expect(stored).toMatchObject({ originalTitle: "A corrected synthetic title", citationStatus: "unverified" });
    expect(stored?.citationCheckedAt).toBeUndefined();
    expect(stored?.citationSource).toBeUndefined();
    const [audit] = await auditOf("replication.citationEdited", STUDY);
    expect(audit?.changes).toEqual(
      expect.arrayContaining([
        { field: "originalTitle", before: "A synthetic original study", after: "A corrected synthetic title" },
        { field: "citationStatus", before: "verified", after: "unverified" },
      ]),
    );
    expect(stored?.writeContext.auditEventId).toBe(audit?.writeContext.auditEventId);
  });

  it("removes a field when the value is null, and refuses a value its schema does not accept", async () => {
    const { lead } = await world();
    expect(
      await codeOf(
        call(lead, editReplicationCitationContract, { replicationId: STUDY, field: "originalDoi", value: "x" }),
      ),
    ).toBe("invalid-argument");
    expect((await dataOf(PATH))?.citationStatus).toBe("verified");
    await call(lead, editReplicationCitationContract, { replicationId: STUDY, field: "originalDoi", value: null });
    expect((await dataOf(PATH))?.originalDoi).toBeUndefined();
  });

  it("is refused to a lead of another replication, a member and a caller who is not signed in", async () => {
    const { otherLead } = await world();
    const member = await account("uid-member");
    const input = { replicationId: STUDY, field: "originalTitle", value: "Forged" } as const;
    expect(await codeOf(call(otherLead, editReplicationCitationContract, input))).toBe("permission-denied");
    expect(await codeOf(call(member, editReplicationCitationContract, input))).toBe("permission-denied");
    expect(await codeOf(call(null, editReplicationCitationContract, input))).toBe("unauthenticated");
    expect(await dataOf(PATH)).toMatchObject({
      originalTitle: "A synthetic original study",
      citationStatus: "verified",
    });
  });
});
