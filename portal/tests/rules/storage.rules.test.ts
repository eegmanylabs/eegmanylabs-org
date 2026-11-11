// Proves what portal/storage.rules allows: the files of a page are read by those who read the
// page and added by those who edit it, in their own name and within the size limit, and no file
// is ever replaced, changed or removed. Everything else is denied to every kind of caller. The
// rules read the page and the access document of the caller from Firestore. The Storage emulator
// reads them from the project it runs for, so this file uses that project and clears it at the
// end, and the suite of the tools, which uses it too, runs after the rules (vitest.config.ts).
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import { entityRefId, PAGE_FILE_MAX_BYTES, pageFilePath, userScopeKey } from "@eegml/shared";
import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, type Firestore, setDoc } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import {
  deleteObject,
  getBytes,
  getMetadata,
  listAll,
  ref,
  updateMetadata,
  uploadBytes,
  uploadString,
} from "firebase/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROJECT_ID, STORAGE_URL } from "../support/emulators";
import { seedWorld, trusted } from "./seed";
import { ACCOUNTS, type Caller, createRulesEnvironment, storageAs } from "./support";
import {
  actingUid,
  autoId,
  CALLER_KINDS,
  CALLERS,
  type CallerKind,
  MEMBER_UID,
  OWN_REPLICATION,
  STORED_AT,
  storageOf,
  stored,
} from "./world";

let environment: RulesTestEnvironment;

const EVERYONE: readonly Caller[] = ["owner", "other", "signedOut"];

/** A file that trusted code stored, so that a refusal is a refusal and not a file that is missing. */
const STORED_FILE = "attachments/replication/SyntheticStudy2001/synthetic-protocol.txt";

/** The body page of the owning replication in the world of the matrix, and a page restricted to the account `member`. */
const PAGE_ID = entityRefId("replication", OWN_REPLICATION);
const RESTRICTED_ID = "restricted-page-1";
const fileOf = (pageId: string, label: string, name = "synthetic-figure.png") =>
  pageFilePath(pageId, autoId(label), name);
/** A file of each page that trusted code stored. */
const PAGE_FILE = fileOf(PAGE_ID, "stored figure");
const RESTRICTED_FILE = fileOf(RESTRICTED_ID, "restricted figure");

/**
 * Removes every file the Storage emulator holds. `clearStorage` of the test library removes only
 * the files at the top of a bucket, and an upload to a path that holds a file is refused.
 */
async function resetStorage(): Promise<void> {
  const response = await fetch(`${STORAGE_URL}/internal/reset`, { method: "POST" });
  if (!response.ok) throw new Error(`Could not reset the Storage emulator: ${response.status}`);
}

beforeAll(async () => {
  await resetStorage();
  environment = await createRulesEnvironment(PROJECT_ID);
  await seedWorld(environment);
  await trusted(environment, async (db: Firestore) => {
    await setDoc(doc(db, `pages/${RESTRICTED_ID}`), {
      ...stored(),
      parentPageId: null,
      ancestorPageIds: [],
      kind: "custom",
      title: "Restricted synthetic notes",
      order: "i",
      isTemplate: false,
      accessMode: "restricted",
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [userScopeKey(MEMBER_UID)],
      levelKeys: { comment: [], edit: [], full: [] },
      contentHead: null,
      mentionUids: [],
      tagIds: [],
      lastEditedBy: null,
      updatedAt: STORED_AT,
    });
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const storage = context.storage() as unknown as FirebaseStorage;
    await uploadString(ref(storage, STORED_FILE), "A synthetic file.");
    await uploadString(ref(storage, PAGE_FILE), "A synthetic figure.");
    await uploadString(ref(storage, RESTRICTED_FILE), "A synthetic restricted figure.");
  });
});

afterAll(async () => {
  await resetStorage();
  await environment.clearFirestore();
  await environment.cleanup();
});

/** An upload of a small file to a page, in the name of the caller unless told otherwise. */
function upload(kind: CallerKind, path: string, uploadedBy?: string, bytes = new Uint8Array([137, 80, 78, 71])) {
  return uploadBytes(ref(storageOf(environment, CALLERS[kind]), path), bytes, {
    contentType: "image/png",
    customMetadata: { uploadedBy: uploadedBy ?? actingUid(CALLERS[kind]) },
  });
}

describe("the files of a page", () => {
  it("are added by its editors, its managers and the programme, in their own name", async () => {
    for (const kind of ["ownTeam", "ownLead", "ownCoordinator", "admin"] as const) {
      await upload(kind, fileOf(PAGE_ID, `upload of ${kind}`));
    }
    expect(await refusalOf(upload("ownTeam", fileOf(PAGE_ID, "forged uploader"), MEMBER_UID))).toBe(
      "storage/unauthorized",
    );
  });

  it("are refused to whoever may only comment on or read the page, and to everyone outside it", async () => {
    const refused = ["ownLabMember", "member", "otherLead", "noMembership", "suspended", "adminWithoutFactor"] as const;
    for (const kind of [...refused, "signedOut"] as const) {
      expect(await refusalOf(upload(kind, fileOf(PAGE_ID, `refused upload of ${kind}`))), kind).toBe(
        "storage/unauthorized",
      );
    }
  });

  it("are never replaced, larger than the limit, or stored under a name of the client's choosing", async () => {
    expect(await refusalOf(upload("admin", PAGE_FILE))).toBe("storage/unauthorized");
    const tooLarge = new Uint8Array(PAGE_FILE_MAX_BYTES + 1);
    expect(await refusalOf(upload("ownTeam", fileOf(PAGE_ID, "too large"), undefined, tooLarge))).toBe(
      "storage/unauthorized",
    );
    expect(await refusalOf(upload("ownTeam", `pages/${PAGE_ID}/files/my-own-name/figure.png`))).toBe(
      "storage/unauthorized",
    );
    expect(await refusalOf(upload("admin", fileOf("no-such-page", "nowhere")))).toBe("storage/unauthorized");
  });

  it("are read by whoever reads the page, and by nobody else", async () => {
    const read = (kind: CallerKind, path: string) => getBytes(ref(storageOf(environment, CALLERS[kind]), path));
    expect(new TextDecoder().decode(await read("member", PAGE_FILE))).toBe("A synthetic figure.");
    expect(new TextDecoder().decode(await read("member", RESTRICTED_FILE))).toBe("A synthetic restricted figure.");
    await read("admin", RESTRICTED_FILE);
    for (const kind of ["noMembership", "suspended", "signedOut"] as const) {
      expect(await refusalOf(read(kind, PAGE_FILE)), kind).toBe("storage/unauthorized");
    }
    for (const kind of ["ownLead", "ownTeam", "otherLead", "adminWithoutFactor"] as const) {
      expect(await refusalOf(read(kind, RESTRICTED_FILE)), kind).toBe("storage/unauthorized");
    }
  });

  it("are never changed, listed or removed by a client, an editor and an administrator included", async () => {
    for (const kind of ["ownTeam", "admin"] as const) {
      const storage = storageOf(environment, CALLERS[kind]);
      expect(await refusalOf(updateMetadata(ref(storage, PAGE_FILE), { contentType: "text/html" }))).toBe(
        "storage/unauthorized",
      );
      expect(await refusalOf(deleteObject(ref(storage, PAGE_FILE)))).toBe("storage/unauthorized");
      expect(await refusalOf(listAll(ref(storage, `pages/${PAGE_ID}/files`)))).toBe("storage/unauthorized");
    }
  });
});

/** The error code of a request that must fail. */
async function refusalOf(request: Promise<unknown>): Promise<string> {
  try {
    await request;
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
  return "(allowed)";
}

describe("Cloud Storage", () => {
  it.each(EVERYONE)("denies an upload to: %s", async (caller) => {
    const storage = storageAs(environment, caller);
    await assertFails(uploadString(ref(storage, "notes/hello.txt"), "hello"));
    await assertFails(uploadString(ref(storage, `uploads/${ACCOUNTS.owner.uid}/hello.txt`), "hello"));
  });

  it.each(EVERYONE)("denies a download to: %s", async (caller) => {
    const storage = storageAs(environment, caller);
    await assertFails(getBytes(ref(storage, `uploads/${ACCOUNTS.owner.uid}/hello.txt`)));
  });

  it.each(EVERYONE)("denies listing to: %s", async (caller) => {
    await assertFails(listAll(ref(storageAs(environment, caller), "uploads")));
  });

  it("holds a file that trusted code stored, which the refusals below are about", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const bytes = await getBytes(ref(context.storage() as unknown as FirebaseStorage, STORED_FILE));
      expect(new TextDecoder().decode(bytes)).toBe("A synthetic file.");
    });
  });

  describe.each(CALLER_KINDS)("for the caller: %s", (kind) => {
    const caller = CALLERS[kind];
    const storage = () => storageOf(environment, caller);

    it("refuses a download and the metadata of a stored file", async () => {
      expect(await refusalOf(getBytes(ref(storage(), STORED_FILE)))).toBe("storage/unauthorized");
      expect(await refusalOf(getMetadata(ref(storage(), STORED_FILE)))).toBe("storage/unauthorized");
    });

    it("refuses a list of a folder and of the whole bucket", async () => {
      expect(await refusalOf(listAll(ref(storage(), "attachments/replication/SyntheticStudy2001")))).toBe(
        "storage/unauthorized",
      );
      expect(await refusalOf(listAll(ref(storage())))).toBe("storage/unauthorized");
    });

    it("refuses an upload anywhere, a folder of the caller's own included", async () => {
      const own = `attachments/user/${actingUid(caller)}/synthetic-note.txt`;
      expect(await refusalOf(uploadString(ref(storage(), own), "A synthetic note."))).toBe("storage/unauthorized");
      expect(await refusalOf(uploadString(ref(storage(), "synthetic-note.txt"), "A synthetic note."))).toBe(
        "storage/unauthorized",
      );
      expect(await refusalOf(uploadString(ref(storage(), STORED_FILE), "Overwritten."))).toBe("storage/unauthorized");
    });

    it("refuses a change of metadata and a removal of a stored file", async () => {
      expect(await refusalOf(updateMetadata(ref(storage(), STORED_FILE), { contentType: "text/html" }))).toBe(
        "storage/unauthorized",
      );
      expect(await refusalOf(deleteObject(ref(storage(), STORED_FILE)))).toBe("storage/unauthorized");
    });
  });
});
