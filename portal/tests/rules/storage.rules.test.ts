// Proves that portal/storage.rules denies everything, to every kind of caller. Attachments are
// built in a later phase, which adds narrowly scoped paths with tests of their own.
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import type { FirebaseStorage } from "firebase/storage";
import { deleteObject, getBytes, getMetadata, listAll, ref, updateMetadata, uploadString } from "firebase/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNTS, type Caller, createRulesEnvironment, storageAs } from "./support";
import { actingUid, CALLER_KINDS, CALLERS, storageOf } from "./world";

let environment: RulesTestEnvironment;

const EVERYONE: readonly Caller[] = ["owner", "other", "signedOut"];

/** A file that trusted code stored, so that a refusal is a refusal and not a file that is missing. */
const STORED_FILE = "attachments/replication/SyntheticStudy2001/synthetic-protocol.txt";

beforeAll(async () => {
  environment = await createRulesEnvironment();
  await environment.withSecurityRulesDisabled(async (context) => {
    await uploadString(ref(context.storage() as unknown as FirebaseStorage, STORED_FILE), "A synthetic file.");
  });
});

afterAll(async () => {
  await environment.clearStorage();
  await environment.cleanup();
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
