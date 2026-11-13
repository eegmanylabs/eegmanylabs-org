// Red team, Google integration: the portal's Drive account as a confused deputy. The account can
// read every file that owners shared with it for one purpose (a synchronised source, the shared
// drive of generated documents, another laboratory's folder). A link is created by whoever
// manages a record, and is then browsed and previewed by every member who reads the link. Each
// test states the secure behaviour: a link never opens to its readers what the portal's account
// was given for another purpose.
// Fixtures are synthetic: fictitious accounts, laboratories and files on the example.org domain.
import {
  browseDriveFolderContract,
  linkDriveResourceContract,
  previewDriveFileContract,
  saveSyncMappingContract,
  sourceTabKey,
} from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FAKE_FILES } from "../../../functions/src/integrations/google/fake/fixtures";
import { DIRECTORY_MAPPING, resetWorkspace, seedWorkspaceWorld, workspaceFake } from "../integrations-world";
import {
  account,
  administrator,
  type Caller,
  call,
  codeOf,
  grantRole,
  person,
  replication,
  resetWorld,
  settle,
  withTriggers,
} from "../support";

const ALPHA = "DemoAlpha2001";
const folderAddress = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const sheetAddress = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

withTriggers();
beforeEach(async () => {
  await resetWorld();
  resetWorkspace();
  await seedWorkspaceWorld({ directoryMode: "dryRun" });
  await replication(ALPHA);
  await settle();
});

afterAll(async () => {
  resetWorkspace();
});

async function member(uid: string): Promise<Caller> {
  await person(`person-${uid}`, [], { displayName: `Synthetic ${uid}`, userId: uid });
  return account(uid, { personId: `person-${uid}` });
}

async function lead(uid: string): Promise<Caller> {
  const caller = await member(uid);
  await grantRole(uid, "replication_lead", "replication", ALPHA);
  return caller;
}

describe("Drive links as a confused deputy", () => {
  it("never let a replication lead open a registered synchronised source to every member through a link", async () => {
    // The laboratory directory is a registered source: the data model keeps its address in a
    // document no client reads, and only administrators read the source registry.
    const attacker = await lead("uid-redteam-lead");
    const reader = await member("uid-redteam-reader");
    const linked = await call(attacker, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: sheetAddress(FAKE_FILES.laboratoryDirectory),
      restricted: false,
    }).catch(() => null);
    const preview =
      linked === null
        ? "(refused at linking)"
        : await codeOf(call(reader, previewDriveFileContract, { linkId: linked.linkId }));
    expect(preview).not.toBe("(no error)");
  });

  it("never let a replication lead list the shared drive of generated documents to every member", async () => {
    const attacker = await lead("uid-redteam-lead");
    const reader = await member("uid-redteam-reader");
    const linked = await call(attacker, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.sharedDriveRoot),
      restricted: false,
    }).catch(() => null);
    const listing =
      linked === null
        ? "(refused at linking)"
        : await codeOf(
            call(reader, browseDriveFolderContract, { linkId: linked.linkId, folderId: FAKE_FILES.generatedFolder }),
          );
    expect(listing).not.toBe("(no error)");
  });

  it("never let a replication lead open another laboratory's folder to every member", async () => {
    const attacker = await lead("uid-redteam-lead");
    const reader = await member("uid-redteam-reader");
    const linked = await call(attacker, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.cognitionFolder),
      restricted: false,
    }).catch(() => null);
    const listing =
      linked === null
        ? "(refused at linking)"
        : await codeOf(call(reader, browseDriveFolderContract, { linkId: linked.linkId }));
    expect(listing).not.toBe("(no error)");
  });

  it("relay no rows of a sheet to a reader, since the design says the portal never relays file content", async () => {
    const attacker = await lead("uid-redteam-lead");
    const reader = await member("uid-redteam-reader");
    // The lead may edit the team folder in Drive, so the link itself is legitimate.
    workspaceFake().shareWithEditor(FAKE_FILES.alphaFolder, attacker.email);
    const { linkId } = await call(attacker, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.alphaFolder),
      restricted: false,
    });
    const preview = await call(reader, previewDriveFileContract, { linkId, fileId: FAKE_FILES.alphaTracker });
    // docs/INTEGRATIONS.md, section 3.2: "the portal never relays file content".
    expect(preview).not.toHaveProperty("sheets");
    expect(preview).not.toHaveProperty("excerpt");
    expect(JSON.stringify(preview)).not.toContain("Demo Memory Laboratory");
  });
});

describe("sheet mappings", () => {
  it("refuse a field that is no field of the target, such as a name inherited from Object.prototype", async () => {
    const admin = await administrator("uid-redteam-admin");
    const outcomes: [string, string][] = [];
    for (const field of ["constructor", "toString", "__proto__"]) {
      const code = await codeOf(
        call(admin, saveSyncMappingContract, {
          mappingId: DIRECTORY_MAPPING,
          name: "Synthetic laboratory directory",
          sourceKey: "demo-laboratory-directory",
          tabKey: sourceTabKey("Laboratories"),
          collectionKey: "core:laboratories",
          keyColumn: "Laboratory key",
          columns: [{ field, column: `Column ${field}`, direction: "appAuthoritative" }],
          sheetOnlyRows: "propose",
          appOnlyRecords: "ignore",
          cellCeiling: 50,
        }),
      );
      outcomes.push([field, code]);
    }
    expect(outcomes).toEqual([
      ["constructor", "invalid-argument"],
      ["toString", "invalid-argument"],
      ["__proto__", "invalid-argument"],
    ]);
  });
});
