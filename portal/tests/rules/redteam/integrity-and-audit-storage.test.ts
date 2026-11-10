// Red-team attacks on Cloud Storage from each of the five attackers: a file of a type that no
// attachment may have, a file far beyond any size limit, a file over one that exists, a change
// of the type of a stored file, its removal, and an upload by the resumable protocol. Nothing
// is stored through the portal yet, so the secure behaviour is that every request is refused
// and the stored file stays as it was.
// Everything here is synthetic: fictitious accounts on the example.org domain.
import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  deleteObject,
  type FirebaseStorage,
  getBytes,
  getDownloadURL,
  getMetadata,
  list,
  ref,
  updateMetadata,
  uploadBytes,
  uploadBytesResumable,
  uploadString,
} from "firebase/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRulesEnvironment } from "../support";
import { actingUid, CALLERS, OWN_REPLICATION, storageOf } from "../world";
import { ATTACKERS } from "./integrity-and-audit-support";

let environment: RulesTestEnvironment;

/** A file that trusted code stored, so that an overwrite and a removal have something to hit. */
const STORED_FILE = `attachments/replication/${OWN_REPLICATION}/synthetic-protocol.pdf`;
const STORED_TEXT = "A synthetic protocol.";

const trustedStorage = <T>(run: (storage: FirebaseStorage) => Promise<T>): Promise<T> => {
  const results: T[] = [];
  return environment
    .withSecurityRulesDisabled(async (context) => {
      results.push(await run(context.storage() as unknown as FirebaseStorage));
    })
    .then(() => results[0] as T);
};

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-storage");
  await trustedStorage((storage) =>
    uploadString(ref(storage, STORED_FILE), STORED_TEXT, "raw", { contentType: "application/pdf" }),
  );
});

afterAll(async () => {
  await environment.clearStorage();
  await environment.cleanup();
});

describe.each(ATTACKERS)("Cloud Storage, attacked by: %s", (attacker) => {
  const caller = CALLERS[attacker];
  const storage = () => storageOf(environment, caller);
  const own = `attachments/user/${actingUid(caller)}`;

  it("takes no file of a type that runs in a browser or on a machine", async () => {
    const page = "<script>document.location='https://example.org/'</script>";
    await assertFails(uploadString(ref(storage(), `${own}/page.html`), page, "raw", { contentType: "text/html" }));
    await assertFails(
      uploadString(ref(storage(), `${own}/drawing.svg`), "<svg onload='alert(1)'/>", "raw", {
        contentType: "image/svg+xml",
      }),
    );
    await assertFails(
      uploadBytes(ref(storage(), `${own}/tool.exe`), new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), {
        contentType: "application/x-msdownload",
      }),
    );
    // A page that says it is a picture.
    await assertFails(uploadString(ref(storage(), `${own}/picture.png`), page, "raw", { contentType: "image/png" }));
    // A file with no type at all.
    await assertFails(uploadBytes(ref(storage(), `${own}/untyped`), new Uint8Array([1, 2, 3])));
  });

  it("takes no oversized file", async () => {
    const sixMebibytes = new Uint8Array(6 * 1024 * 1024);
    await assertFails(uploadBytes(ref(storage(), `${own}/recording.bin`), sixMebibytes));
    await assertFails(
      uploadBytes(ref(storage(), `attachments/replication/${OWN_REPLICATION}/recording.bin`), sixMebibytes, {
        contentType: "application/pdf",
      }),
    );
  });

  it("takes no file by the resumable protocol", async () => {
    const task = uploadBytesResumable(ref(storage(), `${own}/notes.pdf`), new Uint8Array(300_000), {
      contentType: "application/pdf",
    });
    await assertFails(
      new Promise<void>((resolve, reject) => {
        task.then(() => resolve(), reject);
      }),
    );
  });

  it("neither overwrites, retypes, removes, reads nor lists a file that exists", async () => {
    await assertFails(
      uploadString(ref(storage(), STORED_FILE), "Overwritten.", "raw", { contentType: "application/pdf" }),
    );
    await assertFails(uploadString(ref(storage(), STORED_FILE), "<html></html>", "raw", { contentType: "text/html" }));
    await assertFails(updateMetadata(ref(storage(), STORED_FILE), { contentType: "text/html" }));
    await assertFails(
      updateMetadata(ref(storage(), STORED_FILE), { customMetadata: { uploadedBy: "uid-someone-else" } }),
    );
    await assertFails(deleteObject(ref(storage(), STORED_FILE)));
    await assertFails(getBytes(ref(storage(), STORED_FILE)));
    await assertFails(getMetadata(ref(storage(), STORED_FILE)));
    await assertFails(getDownloadURL(ref(storage(), STORED_FILE)));
    await assertFails(list(ref(storage(), `attachments/replication/${OWN_REPLICATION}`), { maxResults: 5 }));
    await assertFails(list(ref(storage()), { maxResults: 5 }));
  });

  it("leaves the stored file as trusted code wrote it, and nothing of its own", async () => {
    const bytes = await trustedStorage((trusted) => getBytes(ref(trusted, STORED_FILE)));
    expect(new TextDecoder().decode(bytes)).toBe(STORED_TEXT);
    const metadata = await trustedStorage((trusted) => getMetadata(ref(trusted, STORED_FILE)));
    expect(metadata.contentType).toBe("application/pdf");
    const mine = await trustedStorage((trusted) => list(ref(trusted, own), { maxResults: 5 }));
    expect(mine.items.map((item) => item.fullPath)).toEqual([]);
  });
});
