// The deployed functions are one bundled file. These tests prove that workspace code is inside
// it, because Cloud Functions cannot install @eegml/shared from a registry.
import { readFileSync } from "node:fs";
import path from "node:path";
import { FUNCTIONS_REGION } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { FUNCTIONS_URL, PORTAL_ROOT, PROJECT_ID } from "../support/emulators";

const bundle = readFileSync(path.join(PORTAL_ROOT, "functions", "out", "index.js"), "utf8");

describe("the functions bundle", () => {
  it("contains @eegml/shared instead of importing it", () => {
    expect(bundle).not.toMatch(/from\s*["']@eegml\/shared["']|require\(["']@eegml\/shared["']\)/);
    expect(bundle).not.toMatch(/from\s*["']zod["']/);
    expect(bundle).toContain(`"${FUNCTIONS_REGION}"`);
  });

  it("leaves the Firebase server packages for the platform to provide", () => {
    expect(bundle).toMatch(/from\s*["']firebase-functions\/https["']/);
    expect(bundle).toMatch(/from\s*["']firebase-admin\/firestore["']/);
  });

  it("is what the emulator serves, in the region taken from the shared constant", async () => {
    // A callable answers a request without a body with an error payload. A 404 would mean that
    // no function is deployed under this region and name.
    const response = await fetch(`${FUNCTIONS_URL}/${PROJECT_ID}/${FUNCTIONS_REGION}/sessionStart`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { status: "UNAUTHENTICATED" } });
  });
});
