// The functions code asks each adapter for its own secrets and for no other, as the reviewed
// specification of ops/service-accounts.mjs states.
import { describe, expect, it } from "vitest";
import { secretReferences } from "../../ops/secret-references.mjs";
import { declaredSecrets, isDeclaredSecret, SERVICE_ACCOUNTS } from "../../ops/service-accounts.mjs";

const references = secretReferences();
const accounts = Object.values(SERVICE_ACCOUNTS);

/** The account whose specification declares a secret, exactly or by prefix. */
function ownerOf(secret: string) {
  return accounts.find(
    (account) =>
      account.secrets.includes(secret) || (account.secretPrefix !== null && secret.startsWith(account.secretPrefix)),
  );
}

describe("the secrets of the functions", () => {
  it("are found where the code asks for them", () => {
    expect(references.map((reference) => reference.secret).sort()).toEqual(
      ["IDENTITY_HASH_KEY", "PUBLISHING_GITHUB_TOKEN", "STORAGE_"].sort(),
    );
  });

  it("are each declared in the specification", () => {
    expect(references.filter((reference) => !isDeclaredSecret(reference.secret))).toEqual([]);
  });

  it("are asked for only by the code of the account that may read them", () => {
    const strays = references.filter((reference) => {
      const owner = ownerOf(reference.secret);
      return !owner?.sourceDirectories.some((directory) => reference.file.startsWith(`${directory}/`));
    });
    expect(strays).toEqual([]);
  });

  it("give the integrations without a credential no secret at all", () => {
    for (const key of ["drive", "osf", "mail"] as const) {
      const account = SERVICE_ACCOUNTS[key];
      expect(account.secrets).toEqual([]);
      expect(account.secretPrefix).toBeNull();
      const named = references.filter((reference) =>
        account.sourceDirectories.some((directory) => reference.file.startsWith(`${directory}/`)),
      );
      expect(named).toEqual([]);
    }
  });

  it("read an endpoint's secret from the environment only behind the storage prefix", () => {
    expect(references.filter((reference) => reference.how === "prefix")).toEqual([
      { file: "integrations/storage/real/credentials.ts", secret: "STORAGE_", how: "prefix" },
    ]);
  });

  it("are declared once, and no account but the runtime holds a project role", () => {
    const secrets = declaredSecrets();
    expect(new Set(secrets).size).toBe(secrets.length);
    for (const account of accounts) {
      if (account !== SERVICE_ACCOUNTS.runtime) expect(account.projectRoles).toEqual([]);
    }
    expect(SERVICE_ACCOUNTS.runtime.projectRoles.filter((role) => /owner|editor|admin$/.test(role))).toEqual([
      "roles/firebaseauth.admin",
    ]);
  });
});
