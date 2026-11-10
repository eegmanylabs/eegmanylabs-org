// Proves that portal/storage.rules denies everything.
// Fixtures are synthetic: fictitious accounts on the example.org domain.
import { assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { getBytes, listAll, ref, uploadString } from "firebase/storage";
import { afterAll, beforeAll, describe, it } from "vitest";
import { ACCOUNTS, type Caller, createRulesEnvironment, storageAs } from "./support";

let environment: RulesTestEnvironment;

const EVERYONE: readonly Caller[] = ["owner", "other", "signedOut"];

beforeAll(async () => {
  environment = await createRulesEnvironment();
});

afterAll(async () => {
  await environment.cleanup();
});

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
});
