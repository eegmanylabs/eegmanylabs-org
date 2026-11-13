// The checks of the deployment preflight (`npm run deploy:check`, scripts/deploy-check.ts). Each
// check contacts no project: it reads the repository, a production build made in a temporary
// directory, and the local emulators, which compile the rules.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { FUNCTIONS_REGION } from "@eegml/shared";
import { ENVIRONMENTS, isPlaceholder, REGION } from "../ops/environments.mjs";
import { secretReferences } from "../ops/secret-references.mjs";
import { isDeclaredSecret } from "../ops/service-accounts.mjs";
import { expectedIndexFile, type IndexFile } from "../tests/rules/indexes";
import { QUERY_CATALOGUE } from "../tests/rules/queries";
import { DEMO_ACCOUNTS } from "../tools/src/fixtures/demo-accounts";
import { DEMO_PERSONS } from "../tools/src/fixtures/demo-world";
import { PORTAL_ROOT } from "./paths.mjs";

export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  /** What was found. Names files and kinds of finding, never a value that was found. */
  readonly details: readonly string[];
}

const result = (name: string, details: readonly string[]): CheckResult => ({
  name,
  passed: details.length === 0,
  details,
});

type DeployEnvironment = "staging" | "production";

/** The identifiers of the environment are supplied, and .firebaserc aliases the same project. */
export function checkEnvironmentSupplied(name: DeployEnvironment, root = PORTAL_ROOT): CheckResult {
  const environment = ENVIRONMENTS[name];
  const details: string[] = [];
  for (const [label, value] of [
    ["project", environment.projectId],
    ["backup bucket", environment.backupBucket],
    ["scratch project", environment.scratchProjectId],
    ["site origin", environment.siteOrigin],
  ] as const) {
    if (isPlaceholder(value)) details.push(`The ${label} of ${name} in ops/environments.mjs is a placeholder.`);
  }
  const aliases = (
    JSON.parse(readFileSync(path.join(root, ".firebaserc"), "utf8")) as { projects: Record<string, string> }
  ).projects;
  if (aliases[name] !== environment.projectId) details.push(`.firebaserc does not alias ${name} to its project.`);
  if (aliases.default !== "demo-eegml") details.push(".firebaserc no longer defaults to the demonstration project.");
  return result(`The ${name} environment is named, with no placeholder`, details);
}

/** Asks the Firestore and Storage emulators to compile the rules files, as a deployment would. */
export async function checkRulesCompile(
  hosts: { readonly firestore: string; readonly storage: string },
  files: { readonly firestore: string; readonly storage: string },
): Promise<CheckResult> {
  const details: string[] = [];
  const put = async (address: string, name: string, content: string) => {
    const response = await fetch(address, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: { files: [{ name, content }] } }),
    });
    const body = await response.text();
    if (!response.ok) details.push(`${name} does not compile: ${body.slice(0, 300)}`);
  };
  // A project of its own, so the check never replaces the rules that a test run is using.
  await put(
    `http://${hosts.firestore}/emulator/v1/projects/demo-eegml-deploy-check:securityRules`,
    "firestore.rules",
    files.firestore,
  );
  await put(`http://${hosts.storage}/internal/setRules`, "storage.rules", files.storage);
  return result("The Firestore and Storage rules compile", details);
}

/** The index file equals what the catalogue of queries and the registry call for. */
export function checkIndexes(root = PORTAL_ROOT): CheckResult {
  const declared = JSON.parse(readFileSync(path.join(root, "firestore.indexes.json"), "utf8")) as IndexFile;
  const expected = expectedIndexFile(QUERY_CATALOGUE);
  const key = (value: unknown) => JSON.stringify(value);
  const declaredKeys = new Set(declared.indexes.map(key));
  const missing = expected.indexes.filter((index) => !declaredKeys.has(key(index)));
  const details = missing.map((index) => `No composite index for ${index.collectionGroup} on ${key(index.fields)}.`);
  if (key(declared) !== key(expected) && missing.length === 0) {
    details.push("firestore.indexes.json differs from the catalogue: run the index test for the difference.");
  }
  return result(`The indexes cover the ${QUERY_CATALOGUE.length} catalogued queries`, details);
}

/** Every secret the functions code names is declared in the service-account specification. */
export function checkSecretsDeclared(root = PORTAL_ROOT): CheckResult {
  const undeclared = secretReferences(root).filter((reference) => !isDeclaredSecret(reference.secret));
  return result(
    "Every secret named by the functions is declared",
    undeclared.map((reference) => `functions/src/${reference.file} names an undeclared secret.`),
  );
}

/** The region is europe-west2 in the shared constants, the functions, the procedures and the policy. */
export function checkRegion(indexHtml: string | null, root = PORTAL_ROOT): CheckResult {
  const details: string[] = [];
  if (FUNCTIONS_REGION !== "europe-west2") details.push("FUNCTIONS_REGION is not europe-west2.");
  if (REGION !== "europe-west2") details.push("ops/environments.mjs names another region.");
  const otherRegion = /\b(?:us|europe|asia|australia|northamerica|southamerica|me|africa)-[a-z]+\d\b/g;
  for (const directory of ["functions/src", "ops", "shared/src"]) {
    for (const file of textFiles(path.join(root, directory))) {
      if (/\.test\.ts$/.test(file)) continue;
      const text = readFileSync(path.join(root, directory, file), "utf8");
      const others = [...text.matchAll(otherRegion)].map((match) => match[0]).filter((name) => name !== "europe-west2");
      if (others.length > 0) details.push(`${directory}/${file} names a region other than europe-west2.`);
      if (directory === "functions/src" && /\bregion:(?!\s*FUNCTIONS_REGION\b)/.test(text)) {
        details.push(`${directory}/${file} sets a region without FUNCTIONS_REGION.`);
      }
    }
  }
  if (indexHtml !== null && !/https:\/\/europe-west2-[a-z0-9-]+\.cloudfunctions\.net/.test(indexHtml)) {
    details.push("The policy of the build does not name the functions in europe-west2.");
  }
  return result("The region is europe-west2 throughout", details);
}

/** The relative paths of the text files below a directory. */
export function textFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(child);
      } else if (/\.(ts|tsx|mjs|js|json|html|css)$/.test(entry.name)) found.push(child);
    }
  };
  walk("");
  return found;
}

/** Hosts of namespace names and of the metadata server, which are identifiers, never requests over the internet. */
const PLAIN_HTTP_ALLOWED = [
  /^www\.w3\.org$/,
  /^schemas\.openxmlformats\.org$/,
  /^schemas\.microsoft\.com$/,
  /^purl\.org$/,
  /^ns\.adobe\.com$/,
  /^metadata\.google\.internal$/,
  /^json-schema\.org$/,
  // A base for parsing relative addresses in libraries; with no port it names no server.
  /^localhost$/,
];

/** Addresses in a text that a plain HTTP request would go to, by host. */
export function plainHttpHosts(text: string): string[] {
  return [...text.matchAll(/http:\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)/gi)]
    .map((match) => (match[1] ?? "").toLowerCase())
    .filter((host) => !PLAIN_HTTP_ALLOWED.some((pattern) => pattern.test(host)));
}

export interface BundleExpectations {
  /** The public web API key of the build, the one key-shaped string that belongs in it. */
  readonly apiKey: string;
  readonly projectId: string;
  readonly appCheckSiteKey: string | null;
}

const SECRET_PATTERNS: readonly [string, RegExp][] = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a service-account key file", /"private_key"\s*:|"client_email"\s*:\s*"[^"]+gserviceaccount/],
  ["a GitHub token", /\b(?:ghp|gho|ghs|ghu|github_pat)_[0-9A-Za-z_]{20,}/],
  ["a cloud access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a Slack token", /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ["a payment or API secret key", /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}/],
];

/**
 * What a production bundle must never carry: an emulator address or project, a test account, a
 * fixture of the demonstration world, an email address, a secret-shaped string, a plain HTTP
 * endpoint, a source map or an environment file.
 */
export function scanBundle(directory: string, expected: BundleExpectations): CheckResult {
  const details: string[] = [];
  const files = textFiles(directory);
  const all = readdirSync(directory, { recursive: true, withFileTypes: true });
  for (const entry of all) {
    if (entry.isFile() && /\.map$|^\.env/.test(entry.name)) details.push(`The build holds ${entry.name}.`);
  }
  const accounts = DEMO_ACCOUNTS.flatMap((account) => [account.uid, account.email]);
  // Every identifier and every name of the demonstration world, and the marker of synthetic files.
  const world = readFileSync(path.join(PORTAL_ROOT, "tools", "src", "fixtures", "demo-world.ts"), "utf8");
  const fixtures = [
    ...new Set([...world.matchAll(/"(demo-[a-z0-9-]+)"/g)].map((match) => match[1] ?? "")),
    ...DEMO_PERSONS.map((person) => `${person.givenName} ${person.familyName}`),
    "SYNTHETIC",
  ].filter((value) => value.length > 6);
  const emulator = [/127\.0\.0\.1/, /\blocalhost:\d/, /demo-eegml/, /FIRESTORE_EMULATOR_HOST/, /fake-api-key/];
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  let carriesApiKey = false;
  let carriesSiteKey = false;
  for (const file of files) {
    const text = readFileSync(path.join(directory, file), "utf8");
    const finding = (what: string) => details.push(`${file} contains ${what}.`);
    if (emulator.some((pattern) => pattern.test(text))) finding("an emulator setting");
    if (accounts.some((value) => text.includes(value))) finding("a test account");
    if (fixtures.some((value) => text.includes(value))) finding("a fixture of the demonstration world");
    const addresses = [...text.matchAll(email)]
      .map((match) => match[0])
      .filter((value) => !/@\d/.test(value) && !/@example\.org$/i.test(value));
    if (addresses.length > 0) finding(`${addresses.length} email-shaped strings`);
    for (const [what, pattern] of SECRET_PATTERNS) if (pattern.test(text)) finding(what);
    const keys = [...text.matchAll(/AIza[0-9A-Za-z_-]{35,}/g)].map((match) => match[0]);
    if (keys.some((key) => key !== expected.apiKey)) finding("a Google API key other than the web configuration's");
    if (text.includes(expected.apiKey)) carriesApiKey = true;
    if (expected.appCheckSiteKey !== null && text.includes(expected.appCheckSiteKey)) carriesSiteKey = true;
    const plain = plainHttpHosts(text);
    if (plain.length > 0) finding(`${plain.length} plain HTTP addresses (${[...new Set(plain)].join(", ")})`);
  }
  if (!carriesApiKey) details.push("The build does not carry the web configuration it was made with.");
  if (expected.appCheckSiteKey !== null && !carriesSiteKey)
    details.push("The build does not carry the App Check site key.");
  return result("The production bundle carries no emulator, test account, fixture, address or secret", details);
}

/** The value of each directive of a policy. */
export function policyDirectives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0] !== undefined && parts[0] !== "")
      .map(([name, ...values]) => [name ?? "", values]),
  );
}

/** The policy of a page: a meta element directly after the character set, and strict. */
export function checkContentSecurityPolicy(indexHtml: string): CheckResult {
  const details: string[] = [];
  const meta = /<meta charset="UTF-8" \/>\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i.exec(
    indexHtml,
  );
  if (meta?.[1] === undefined) {
    return result("The Content-Security-Policy is present and strict", [
      "index.html has no policy meta element directly after the character set.",
    ]);
  }
  const directives = policyDirectives(meta[1].replaceAll("&#39;", "'"));
  const value = (name: string) => directives.get(name) ?? [];
  if (value("default-src").join(" ") !== "'none'") details.push("default-src is not 'none'.");
  for (const name of ["script-src", "connect-src", "img-src", "font-src", "frame-src", "style-src"]) {
    if (value(name).some((source) => source === "*" || source === "https:" || source === "http:")) {
      details.push(`${name} allows any host.`);
    }
  }
  const script = value("script-src");
  if (script.some((source) => /unsafe-inline|unsafe-eval|data:|blob:/.test(source))) {
    details.push("script-src allows inline or evaluated scripts.");
  }
  if (value("object-src").join(" ") !== "'none'") details.push("object-src is not 'none'.");
  if (value("base-uri").join(" ") !== "'self'") details.push("base-uri is not 'self'.");
  if (value("form-action").join(" ") !== "'self'") details.push("form-action is not 'self'.");
  if (!directives.has("upgrade-insecure-requests")) details.push("upgrade-insecure-requests is missing.");
  for (const [name, sources] of directives) {
    if (sources.some((source) => source.startsWith("http://"))) details.push(`${name} names a plain HTTP source.`);
  }
  if ([...indexHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].length > 0)
    details.push("index.html has an inline script.");
  if (!/<meta name="referrer" content="strict-origin-when-cross-origin"/.test(indexHtml)) {
    details.push("The referrer policy is missing.");
  }
  if (!indexHtml.includes('src="./frame-guard.js"'))
    details.push("The guard against frames and plain HTTP is missing.");
  return result("The Content-Security-Policy is present and strict", details);
}

/** App Check is built in: the site key, the reCAPTCHA hosts and the exchange endpoint. */
export function checkAppCheck(indexHtml: string, siteKey: string | null): CheckResult {
  const details: string[] = [];
  if (siteKey === null) details.push("VITE_APP_CHECK_SITE_KEY is not set for the build.");
  if (!indexHtml.includes("https://content-firebaseappcheck.googleapis.com")) {
    details.push("The policy does not allow the App Check exchange, so App Check is not built in.");
  }
  if (!indexHtml.includes("https://www.google.com/recaptcha/"))
    details.push("The policy does not allow reCAPTCHA Enterprise.");
  return result("App Check is configured for production", details);
}

/** Every endpoint of the functions code and the policy is HTTPS, apart from namespace names and the metadata server. */
export function checkFunctionsHttps(root = PORTAL_ROOT): CheckResult {
  const details: string[] = [];
  const directory = path.join(root, "functions", "src");
  for (const file of textFiles(directory)) {
    if (/\.test\.ts$/.test(file) || /(^|\/)fake(\/|\.ts$)/.test(file)) continue;
    const plain = plainHttpHosts(readFileSync(path.join(directory, file), "utf8"));
    if (plain.length > 0)
      details.push(`functions/src/${file} reaches ${[...new Set(plain)].join(", ")} over plain HTTP.`);
  }
  return result("Every endpoint of the functions is HTTPS", details);
}
