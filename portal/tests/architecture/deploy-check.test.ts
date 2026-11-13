// The checks of the deployment preflight, fed planted defects. SYNTHETIC values only: every
// address, key and project below is invented.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkAppCheck,
  checkContentSecurityPolicy,
  checkEnvironmentSupplied,
  checkFunctionsHttps,
  checkIndexes,
  checkRegion,
  checkSecretsDeclared,
  plainHttpHosts,
  scanBundle,
} from "../../scripts/deploy-checks";

const API_KEY = "AIzaInventedInventedInventedInventedKey0";
const SITE_KEY = "invented-recaptcha-enterprise-site-key";
const POLICY =
  "default-src &#39;none&#39;; script-src &#39;self&#39; https://www.google.com/recaptcha/; style-src &#39;self&#39; &#39;unsafe-inline&#39;; " +
  "img-src &#39;self&#39;; font-src &#39;self&#39;; connect-src &#39;self&#39; https://firestore.googleapis.com " +
  "https://europe-west2-invented.cloudfunctions.net https://content-firebaseappcheck.googleapis.com; frame-src &#39;none&#39;; " +
  "object-src &#39;none&#39;; base-uri &#39;self&#39;; form-action &#39;self&#39;; upgrade-insecure-requests";
const page = (policy = POLICY, extra = "") =>
  `<!doctype html><html><head>\n    <meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n` +
  `<meta name="referrer" content="strict-origin-when-cross-origin" /><script src="./frame-guard.js"></script>${extra}</head></html>`;

const directories: string[] = [];
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function bundle(files: Record<string, string>): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "eegml-bundle-"));
  directories.push(directory);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    writeFileSync(path.join(directory, name), text);
  }
  return directory;
}

const expected = { apiKey: API_KEY, projectId: "invented", appCheckSiteKey: SITE_KEY };
const clean = { "index.html": page(), "assets/index.js": `const c={apiKey:"${API_KEY}",site:"${SITE_KEY}"};` };

describe("the scan of a production bundle", () => {
  it("passes a clean bundle", () => {
    expect(scanBundle(bundle(clean), expected)).toMatchObject({ passed: true, details: [] });
  });

  it.each([
    ["an emulator host", "fetch('http://127.0.0.1:9180')", /emulator setting/],
    ["the demonstration project", "projectId:'demo-eegml'", /emulator setting/],
    ["a test account", "uid:'demo-account-one'", /test account/],
    ["a fixture of the demonstration world", "id:'demo-person-ivy'", /fixture/],
    // Joined at run time, so that the source of this test holds no address outside example.org.
    ["an email address", `to:'${["member", "university.invalid.edu"].join("@")}'`, /email-shaped/],
    ["a private key", "-----BEGIN PRIVATE KEY-----", /private key/],
    ["a GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", /GitHub token/],
    ["another API key", "k:'AIzaAnotherAnotherAnotherAnotherAnothe1'", /Google API key other/],
    ["a plain HTTP endpoint", "fetch('http://api.invented.net/x')", /plain HTTP/],
  ])("finds %s", (_label, planted, pattern) => {
    const result = scanBundle(bundle({ ...clean, "assets/extra.js": planted }), expected);
    expect(result.passed).toBe(false);
    expect(result.details.join("\n")).toMatch(pattern);
    // A finding names its kind and file, never the value it found.
    expect(result.details.join("\n")).not.toContain(planted);
  });

  it("finds a source map and a bundle without the App Check key", () => {
    expect(scanBundle(bundle({ ...clean, "assets/index.js.map": "{}" }), expected).details.join()).toMatch(/\.map/);
    const withoutKey = scanBundle(bundle({ ...clean, "assets/index.js": `const c={apiKey:"${API_KEY}"}` }), expected);
    expect(withoutKey.details).toContain("The build does not carry the App Check site key.");
  });

  it("tells namespace names from endpoints", () => {
    expect(
      plainHttpHosts('xmlns="http://www.w3.org/2000/svg" base="http://localhost" x="http://evil.example.net"'),
    ).toEqual(["evil.example.net"]);
  });
});

describe("the policy check", () => {
  it("passes a strict policy and App Check", () => {
    expect(checkContentSecurityPolicy(page()).passed).toBe(true);
    expect(checkAppCheck(page(), SITE_KEY).passed).toBe(true);
  });

  it.each([
    ["no policy", page().replace(/<meta http-equiv[^>]+>/, ""), /no policy meta element/],
    ["an inline script", page(POLICY, "<script>alert(1)</script>"), /inline script/],
    [
      "unsafe-eval",
      page(POLICY.replace("script-src &#39;self&#39;", "script-src &#39;self&#39; &#39;unsafe-eval&#39;")),
      /inline or evaluated/,
    ],
    ["any host", page(POLICY.replace("img-src &#39;self&#39;", "img-src *")), /allows any host/],
    ["a plain HTTP source", page(POLICY.replace("https://firestore", "http://firestore")), /plain HTTP/],
    ["no upgrade", page(POLICY.replace("; upgrade-insecure-requests", "")), /upgrade-insecure-requests/],
    [
      "a default other than none",
      page(POLICY.replace("default-src &#39;none&#39;", "default-src &#39;self&#39;")),
      /default-src/,
    ],
  ])("fails %s", (_label, html, pattern) => {
    const result = checkContentSecurityPolicy(html);
    expect(result.passed).toBe(false);
    expect(result.details.join("\n")).toMatch(pattern);
  });

  it("fails a production build without App Check", () => {
    const html = page(POLICY.replace(" https://content-firebaseappcheck.googleapis.com", ""));
    expect(checkAppCheck(html, null).details).toHaveLength(2);
  });
});

describe("the checks of the repository", () => {
  it("pass for the indexes, the secrets, the region and the HTTPS endpoints of the functions", () => {
    for (const result of [checkIndexes(), checkSecretsDeclared(), checkRegion(page()), checkFunctionsHttps()]) {
      expect(result, result.name).toMatchObject({ passed: true, details: [] });
    }
  });

  it("fails a policy whose functions are in another region", () => {
    expect(checkRegion(page(POLICY.replace("europe-west2", "us-central1"))).passed).toBe(false);
  });

  it("fails while the environments are placeholders, which is the truth until an administrator names them", () => {
    const result = checkEnvironmentSupplied("production");
    expect(result.passed).toBe(false);
    expect(result.details.join("\n")).toMatch(/placeholder/);
  });
});
