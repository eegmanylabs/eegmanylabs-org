// The checks of the deployment preflight (`npm run deploy:check`, scripts/deploy-check.ts). Each
// check contacts no project: it reads the repository, a production build made in a temporary
// directory, and the local emulators, which compile the rules.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import {
  DECIDED_STUDY_IDENTIFIERS,
  FUNCTIONS_REGION,
  FUNCTIONS_SERVICE_ACCOUNT,
  MAIL_DISABLED_DECISION,
} from "@eegml/shared";
import { DEPLOY_CONFIG } from "../ops/deploy-plan.mjs";
import { ENVIRONMENTS, isPlaceholder, REGION } from "../ops/environments.mjs";
import { secretReferences } from "../ops/secret-references.mjs";
import { isDeclaredSecret, SERVICE_ACCOUNTS } from "../ops/service-accounts.mjs";
import { expectedIndexFile, type IndexFile } from "../tests/rules/indexes";
import { QUERY_CATALOGUE } from "../tests/rules/queries";
import { DEMO_ACCOUNTS } from "../tools/src/fixtures/demo-accounts";
import { DEMO_PERSONS } from "../tools/src/fixtures/demo-world";
import { deployPackageJson, RUNTIME_DEPENDENCIES } from "./functions-package.mjs";
import { PORTAL_ROOT } from "./paths.mjs";

export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  /** What was found. Names files and kinds of finding, never a value that was found. */
  readonly details: readonly string[];
  /** What the operator should know whether or not the item passes. */
  readonly notes?: readonly string[];
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
    ["Storage bucket", environment.storageBucket],
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

/** Files whose bytes are no text: typefaces and images, which the scan of a build leaves out. */
const BINARY_FILE = /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|ico)$/i;

/** The relative paths of the source files below a directory. */
export function textFiles(directory: string): string[] {
  return filesBelow(directory).filter((file) => /\.(ts|tsx|mjs|js|json|html|css)$/.test(file));
}

/** The relative paths of every file below a directory, node_modules apart, in a stable order. */
export function filesBelow(directory: string): string[] {
  const found: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(child);
      } else found.push(child);
    }
  };
  walk("");
  return found.sort();
}

/** Every file of a build to publish with its SHA-256, which binds what is published to what was scanned. */
export function artefactManifest(directory: string): { readonly files: Record<string, string> } {
  const files: Record<string, string> = {};
  for (const file of filesBelow(directory)) {
    files[file] = createHash("sha256")
      .update(readFileSync(path.join(directory, file)))
      .digest("hex");
  }
  return { files };
}

/** The differences between a build and the manifest the preflight wrote for it, by file. */
export function artefactDifferences(manifest: { readonly files: Record<string, string> }, directory: string): string[] {
  const now = artefactManifest(directory).files;
  const differences: string[] = [];
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (now[file] === undefined) differences.push(`${file} is missing.`);
    else if (now[file] !== hash) differences.push(`${file} has changed.`);
  }
  for (const file of Object.keys(now)) if (manifest.files[file] === undefined) differences.push(`${file} was added.`);
  return differences;
}

/** Identifiers and labels of the synthetic fixtures of the importers, which no build may carry. */
function importFixtureMarkers(root: string): string[] {
  const directory = path.join(root, "tools", "src", "import", "fixtures");
  const markers = new Set<string>();
  for (const file of textFiles(directory)) {
    const text = readFileSync(path.join(directory, file), "utf8");
    for (const match of text.matchAll(/"([a-z]+(?:-[a-z0-9]+){1,}|[A-Z][a-z]+[A-Z][a-z]+\d{4})"/g)) {
      const value = match[1] ?? "";
      // The programme's own study identifiers that a decision names are public and belong in the build.
      if (value.length > 8 && /-|\d{4}$/.test(value) && !DECIDED_STUDY_IDENTIFIERS.includes(value)) markers.add(value);
    }
  }
  return [...markers];
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
  const files = filesBelow(directory).filter((file) => !BINARY_FILE.test(file));
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
    ...importFixtureMarkers(PORTAL_ROOT),
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
    if (/sourceMappingURL=/.test(text)) finding("a reference to a source map");
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
  return result("App Check is built into the web application", details);
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

/** The configuration of a deployment: no emulator block, the deployed package of the functions, existing rules. */
export function checkDeployConfig(root = PORTAL_ROOT): CheckResult {
  const details: string[] = [];
  const file = path.join(root, DEPLOY_CONFIG);
  if (!existsSync(file)) return result("The deployment configuration is complete", [`${DEPLOY_CONFIG} is missing.`]);
  const config = JSON.parse(readFileSync(file, "utf8")) as {
    emulators?: unknown;
    firestore?: { rules?: string; indexes?: string };
    storage?: { rules?: string };
    functions?: { source?: string }[];
  };
  if (config.emulators !== undefined) details.push(`${DEPLOY_CONFIG} holds an emulator block.`);
  for (const named of [config.firestore?.rules, config.firestore?.indexes, config.storage?.rules]) {
    if (named === undefined || !existsSync(path.join(root, named)))
      details.push(`${DEPLOY_CONFIG} names a missing rules or index file.`);
  }
  const source = config.functions?.[0]?.source;
  if (source !== ".run/deploy/functions")
    details.push(`${DEPLOY_CONFIG} does not deploy the package of npm run functions:package.`);
  return result("The deployment configuration is complete", details);
}

/** The bare package names a bundle imports, apart from Node's own modules. */
export function bundleImports(code: string): string[] {
  const names = new Set<string>();
  for (const match of code.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'./][^"']*)["']/g,
  )) {
    const specifier = match[1] ?? "";
    if (specifier.startsWith("node:") || builtinModules.includes(specifier.split("/")[0] ?? "")) continue;
    const parts = specifier.split("/");
    names.add(specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] ?? specifier));
  }
  return [...names].sort();
}

/**
 * The package of the functions that a deployment uploads installs from the public registry
 * alone: exactly the two runtime dependencies at the pinned versions, no development
 * dependency, no workspace package, and a bundle that imports nothing else and names no source map.
 */
export function checkFunctionsPackage(root = PORTAL_ROOT): CheckResult {
  const name = "The deployed package of the functions installs without workspace packages";
  const directory = path.join(root, ".run", "deploy", "functions");
  const packageFile = path.join(directory, "package.json");
  const bundleFile = path.join(directory, "index.js");
  if (!existsSync(packageFile) || !existsSync(bundleFile)) {
    return result(name, ["The package is missing. Run `npm run functions:package` first."]);
  }
  const details: string[] = [];
  const deployed = JSON.parse(readFileSync(packageFile, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: unknown;
  };
  const workspace = JSON.parse(readFileSync(path.join(root, "functions", "package.json"), "utf8"));
  if (JSON.stringify(deployed) !== JSON.stringify(deployPackageJson(workspace))) {
    details.push("package.json differs from what functions:package writes. Run it again.");
  }
  if (deployed.devDependencies !== undefined) details.push("package.json lists development dependencies.");
  if (Object.keys(deployed.dependencies ?? {}).some((dependency) => dependency.startsWith("@eegml/"))) {
    details.push("package.json names a workspace package, which no registry holds.");
  }
  const code = readFileSync(bundleFile, "utf8");
  const unknown = bundleImports(code).filter((imported) => !RUNTIME_DEPENDENCIES.includes(imported));
  if (unknown.length > 0) details.push(`The bundle imports ${unknown.join(", ")}, which the package does not install.`);
  if (/sourceMappingURL=/.test(code)) details.push("The bundle names a source map.");
  return result(name, details);
}

/** Every function runs as the runtime account of the specification, never the default account. */
export function checkServiceAccount(root = PORTAL_ROOT): CheckResult {
  const details: string[] = [];
  if (FUNCTIONS_SERVICE_ACCOUNT !== `${SERVICE_ACCOUNTS.runtime.id}@`) {
    details.push("FUNCTIONS_SERVICE_ACCOUNT is not the runtime account of ops/service-accounts.mjs.");
  }
  const directory = path.join(root, "functions", "src");
  for (const file of textFiles(directory)) {
    if (/\.test\.ts$/.test(file)) continue;
    const text = readFileSync(path.join(directory, file), "utf8");
    const regions = [...text.matchAll(/region: FUNCTIONS_REGION(,\s*serviceAccount: FUNCTIONS_SERVICE_ACCOUNT)?/g)];
    if (regions.some((match) => match[1] === undefined)) {
      details.push(`functions/src/${file} declares a function without the service account.`);
    }
  }
  return result("Every function runs as its own least-privilege account", details);
}

/** Reads `NAME=value` lines of an environment file of the functions. */
export function parameterValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] !== undefined) values.set(match[1], (match[2] ?? "").replace(/^"(.*)"$/, "$1"));
  }
  return values;
}

/**
 * The parameters of the functions for the project, in functions/.env.<project>: the origins
 * that may call, which must hold the site's origin and nothing over plain HTTP, and the portal's
 * address for links in messages. Whether App Check is enforced is reported either way.
 */
export function checkFunctionsParameters(name: DeployEnvironment, root = PORTAL_ROOT): CheckResult {
  const environment = ENVIRONMENTS[name];
  const label = "The parameters of the functions are set for the project";
  const file = path.join(root, "functions", `.env.${environment.projectId}`);
  if (!existsSync(file)) return result(label, [`functions/.env.${environment.projectId} is missing.`]);
  const values = parameterValues(readFileSync(file, "utf8"));
  const details: string[] = [];
  const origins = (values.get("PORTAL_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) details.push("PORTAL_ORIGINS is empty, so every browser would be refused.");
  if (origins.some((origin) => !origin.startsWith("https://")))
    details.push("PORTAL_ORIGINS holds an origin that is not HTTPS.");
  if (!origins.includes(environment.siteOrigin))
    details.push("PORTAL_ORIGINS does not hold the site origin of the environment.");
  if (
    (values.get("PORTAL_URL") ?? "").replace(/\/$/, "") !== environment.siteOrigin.replace(/\/$/, "") &&
    !(values.get("PORTAL_URL") ?? "").startsWith(`${environment.siteOrigin}/`)
  ) {
    details.push("PORTAL_URL is not an address on the site origin of the environment.");
  }
  const enforced = values.get("ENFORCE_APP_CHECK");
  if (enforced !== undefined && enforced !== "true" && enforced !== "false")
    details.push("ENFORCE_APP_CHECK is neither true nor false.");
  return {
    ...result(label, details),
    notes: [`App Check is ${enforced === "true" ? "enforced" : "not yet enforced"} on the functions of ${name}.`],
  };
}

/**
 * Whether notification email is off or on for the environment, as ops/environments.mjs records
 * it, and whether the functions' parameter `MAIL_DELIVERY` agrees. The programme decided that no
 * notification email is sent for now, so `disabled` is the configured state: it needs no mail
 * provider and no mail secret, and the absence of both passes. `enabled` passes only once the
 * mail account of ops/service-accounts.mjs declares the secret of a provider, which no decision
 * has chosen yet.
 */
export function checkMailDelivery(
  name: DeployEnvironment,
  root = PORTAL_ROOT,
  mailSecrets: readonly string[] = SERVICE_ACCOUNTS.mail.secrets,
): CheckResult {
  const environment = ENVIRONMENTS[name];
  const label = "Notification email is configured as decided";
  const file = path.join(root, "functions", `.env.${environment.projectId}`);
  const configured = existsSync(file) ? parameterValues(readFileSync(file, "utf8")).get("MAIL_DELIVERY") : undefined;
  const parameter = configured === undefined || configured === "" ? "disabled" : configured;
  const details: string[] = [];
  if (parameter !== "disabled" && parameter !== "enabled")
    details.push("MAIL_DELIVERY is neither disabled nor enabled.");
  else if (parameter !== environment.mail) {
    details.push(`MAIL_DELIVERY says ${parameter}, and ops/environments.mjs says ${environment.mail} for ${name}.`);
  }
  if (environment.mail === "disabled") {
    return {
      ...result(label, details),
      notes: [
        `Notification email is disabled for ${name} (${MAIL_DISABLED_DECISION.reference}): notifications and digests stay ` +
          "in the portal, no mail provider or mail secret is needed, and Firebase's sign-in links are unaffected.",
      ],
    };
  }
  if (mailSecrets.length === 0) {
    details.push(
      `Notification email is enabled for ${name}, but no mail provider is chosen: the mail account declares no secret.`,
    );
  }
  return result(label, details);
}
