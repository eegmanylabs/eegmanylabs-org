// The checks of the deployment preflight, fed planted defects. SYNTHETIC values only: every
// address, key and project below is invented.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ENVIRONMENTS } from "../../ops/environments.mjs";
import {
  artefactDifferences,
  artefactManifest,
  bundleImports,
  checkAppCheck,
  checkContentSecurityPolicy,
  checkDeployConfig,
  checkEnvironmentSupplied,
  checkFunctionsHttps,
  checkFunctionsPackage,
  checkFunctionsParameters,
  checkIndexes,
  checkMailDelivery,
  checkRegion,
  checkSecretsDeclared,
  checkServiceAccount,
  plainHttpHosts,
  scanBundle,
} from "../../scripts/deploy-checks";
import { deployPackageJson } from "../../scripts/functions-package.mjs";

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

  it.each([
    [
      "an inline source map",
      { "assets/index.js": `${clean["assets/index.js"]}\n//# sourceMappingURL=data:application/json;base64,e30=` },
      /source map/,
    ],
    [
      "an address in an image of text",
      { "logo.svg": `<svg><desc>${["owner", "university.invalid.edu"].join("@")}</desc></svg>` },
      /email-shaped/,
    ],
    [
      "an address in a manifest",
      { "site.webmanifest": `{"contact":"${["owner", "university.invalid.edu"].join("@")}"}` },
      /email-shaped/,
    ],
    ["an identifier of an import fixture", { "assets/extra.js": "const p='faye-notreal';" }, /fixture/],
  ])("finds %s in a file of any kind", (_label, planted, pattern) => {
    const result = scanBundle(bundle({ ...clean, ...planted }), expected);
    expect(result.passed).toBe(false);
    expect(result.details.join("\n")).toMatch(pattern);
  });

  it("leaves typefaces and images out of the scan", () => {
    expect(scanBundle(bundle({ ...clean, "fonts/dm-sans.woff2": "binary: 127.0.0.1" }), expected).passed).toBe(true);
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

describe("the artefact to publish", () => {
  it("is listed with the SHA-256 of every file, and any later change is found", () => {
    const directory = bundle(clean);
    const manifest = artefactManifest(directory);
    expect(Object.keys(manifest.files)).toEqual(["assets/index.js", "index.html"]);
    expect(artefactDifferences(manifest, directory)).toEqual([]);
    writeFileSync(path.join(directory, "assets/index.js"), "changed");
    writeFileSync(path.join(directory, "added.js"), "");
    expect(artefactDifferences(manifest, directory)).toEqual(["assets/index.js has changed.", "added.js was added."]);
  });
});

describe("the deployment of the functions", () => {
  function root(files: Record<string, string>): string {
    const directory = bundle(files);
    return directory;
  }
  const workspace = {
    engines: { node: "22" },
    dependencies: { "firebase-admin": "14.5.0", "firebase-functions": "7.4.0" },
    devDependencies: { "@eegml/shared": "0.0.0" },
  };
  const deployed = JSON.stringify(deployPackageJson(workspace));

  it("writes a package with the two runtime dependencies alone", () => {
    expect(JSON.parse(deployed)).toEqual({
      name: "eegml-portal-functions",
      version: "0.0.0",
      private: true,
      type: "module",
      main: "index.js",
      engines: { node: "22" },
      dependencies: { "firebase-admin": "14.5.0", "firebase-functions": "7.4.0" },
    });
  });

  it("passes a clean package and finds a workspace dependency, an import it does not install and a source map", () => {
    const files = (pkg: string, code: string) => ({
      "functions/package.json": JSON.stringify(workspace),
      ".run/deploy/functions/package.json": pkg,
      ".run/deploy/functions/index.js": code,
    });
    const good =
      'import { getApps } from "firebase-admin/app";\nimport { readFileSync } from "node:fs";\nimport path from "path";';
    expect(checkFunctionsPackage(root(files(deployed, good)))).toMatchObject({ passed: true, details: [] });
    const withWorkspace = JSON.stringify({ ...JSON.parse(deployed), devDependencies: { "@eegml/shared": "0.0.0" } });
    expect(checkFunctionsPackage(root(files(withWorkspace, good))).details.join()).toMatch(/development dependencies/);
    expect(checkFunctionsPackage(root(files(deployed, 'import y from "yjs";'))).details.join()).toMatch(/imports yjs/);
    expect(
      checkFunctionsPackage(root(files(deployed, `${good}\n//# sourceMappingURL=index.js.map`))).details.join(),
    ).toMatch(/source map/);
    expect(checkFunctionsPackage(root({ "functions/package.json": "{}" })).details.join()).toMatch(/functions:package/);
  });

  it("names the bare packages a bundle imports", () => {
    expect(
      bundleImports('import a from "@scope/pkg/sub"; const b = await import("other"); require("node:fs");'),
    ).toEqual(["@scope/pkg", "other"]);
  });

  it("runs every function as the runtime account, with a deployment configuration of its own", () => {
    expect(checkServiceAccount()).toMatchObject({ passed: true, details: [] });
    expect(checkDeployConfig()).toMatchObject({ passed: true, details: [] });
    const planted = root({ "functions/src/triggers/x.ts": "onSchedule({ region: FUNCTIONS_REGION, schedule: 'x' })" });
    expect(checkServiceAccount(planted).details.join()).toMatch(/without the service account/);
  });

  it("needs the origins, the address and a clear App Check switch in the parameters of the project", () => {
    const { projectId, siteOrigin } = ENVIRONMENTS.staging;
    const parameters = (text: string) => root({ [`functions/.env.${projectId}`]: text });
    const good = checkFunctionsParameters(
      "staging",
      parameters(`PORTAL_ORIGINS=${siteOrigin}\nPORTAL_URL=${siteOrigin}/\nENFORCE_APP_CHECK=false\n`),
    );
    expect(good).toMatchObject({ passed: true, details: [] });
    expect(good.notes?.join()).toMatch(/not yet enforced/);
    expect(checkFunctionsParameters("staging", parameters("PORTAL_ORIGINS=\n")).details.join()).toMatch(/empty/);
    expect(
      checkFunctionsParameters(
        "staging",
        parameters(`PORTAL_ORIGINS=http://insecure.example.org,${siteOrigin}\nPORTAL_URL=${siteOrigin}/`),
      ).details.join(),
    ).toMatch(/not HTTPS/);
    expect(checkFunctionsParameters("staging", root({})).details.join()).toMatch(/is missing/);
  });

  it("accepts mail disabled with no mail secret on staging and production, as the programme decided", () => {
    for (const name of ["staging", "production"] as const) {
      expect(ENVIRONMENTS[name].mail).toBe("disabled");
      const { projectId } = ENVIRONMENTS[name];
      // Absent, empty or disabled, the parameter agrees, and no mail secret or provider is asked for.
      for (const text of ["", "MAIL_DELIVERY=\n", "MAIL_DELIVERY=disabled\n"]) {
        const checked = checkMailDelivery(name, root({ [`functions/.env.${projectId}`]: text }), []);
        expect(checked).toMatchObject({ passed: true, details: [] });
        expect(checked.notes?.join()).toMatch(/stay in the portal, no mail provider or mail secret is needed/);
        expect(checked.notes?.join()).toContain("decision 7");
      }
      expect(checkMailDelivery(name, root({}), []).passed).toBe(true);
      // A project whose parameters switch mail on, against the decision, is refused, and so is a value that means nothing.
      const enabled = checkMailDelivery(name, root({ [`functions/.env.${projectId}`]: "MAIL_DELIVERY=enabled\n" }), []);
      expect(enabled.passed).toBe(false);
      expect(enabled.details.join()).toMatch(/says enabled, and ops\/environments\.mjs says disabled/);
      expect(
        checkMailDelivery(
          name,
          root({ [`functions/.env.${projectId}`]: "MAIL_DELIVERY=sometimes\n" }),
          [],
        ).details.join(),
      ).toMatch(/neither disabled nor enabled/);
    }
  });
});
