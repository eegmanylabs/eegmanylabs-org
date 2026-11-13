// The preflight's compilation of the rules, against the emulators that the rules suite runs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkRulesCompile } from "../../scripts/deploy-checks";
import { HOST, PORTAL_ROOT, PORTS } from "../support/emulators";

const hosts = { firestore: `${HOST}:${PORTS.firestore}`, storage: `${HOST}:${PORTS.storage}` };
const files = {
  firestore: readFileSync(path.join(PORTAL_ROOT, "firestore.rules"), "utf8"),
  storage: readFileSync(path.join(PORTAL_ROOT, "storage.rules"), "utf8"),
};

describe("the compilation of the rules", () => {
  it("accepts the rules of the repository", async () => {
    expect(await checkRulesCompile(hosts, files)).toMatchObject({ passed: true, details: [] });
  });

  it("refuses rules that do not compile, and the storage rules in use stay those of the repository", async () => {
    const broken = await checkRulesCompile(hosts, {
      firestore: `${files.firestore}\n match {`,
      storage: `${files.storage}\n broken {`,
    });
    expect(broken.passed).toBe(false);
    expect(broken.details).toHaveLength(2);
    expect(await checkRulesCompile(hosts, files)).toMatchObject({ passed: true });
  });
});
