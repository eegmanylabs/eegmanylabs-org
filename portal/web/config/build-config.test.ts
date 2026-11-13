import { describe, expect, it } from "vitest";
import { ENVIRONMENTS } from "../../ops/environments.mjs";
import { portsFor } from "../../scripts/ports.mjs";
import { REQUIRED_VARIABLES, resolveBuildConfig, resolvePublicPath } from "./build-config.ts";
import { buildContentSecurityPolicy } from "./csp.ts";

const ports = portsFor(9300);

// Invented values in the shape the Firebase console gives. They name no real project.
const realEnvironment = {
  VITE_FIREBASE_API_KEY: "example-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "example-portal.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "example-portal",
  VITE_FIREBASE_STORAGE_BUCKET: "example-portal.firebasestorage.app",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
  VITE_APP_CHECK_SITE_KEY: "example-recaptcha-enterprise-site-key",
};

describe("the separation of the environments", () => {
  it("refuses a production build without App Check and carries the site key with it", () => {
    const { VITE_APP_CHECK_SITE_KEY: _key, ...withoutKey } = realEnvironment;
    expect(() => resolveBuildConfig("production", withoutKey, ports)).toThrow(/VITE_APP_CHECK_SITE_KEY is not set/);
    expect(resolveBuildConfig("staging", withoutKey, ports).appCheck).toBeNull();
    expect(resolveBuildConfig("production", realEnvironment, ports).appCheck).toEqual({
      siteKey: "example-recaptcha-enterprise-site-key",
    });
    expect(resolveBuildConfig("emulator", realEnvironment, ports).appCheck).toBeNull();
  });

  it("refuses an emulator setting in a staging or production build", () => {
    for (const mode of ["staging", "production"]) {
      expect(() =>
        resolveBuildConfig(mode, { ...realEnvironment, VITE_FIRESTORE_EMULATOR_HOST: "127.0.0.1:9180" }, ports),
      ).toThrow(/emulator settings belong to the emulator mode/);
    }
  });

  it("never points a production build at staging, nor a staging build at production", () => {
    const staging = { ...realEnvironment, VITE_FIREBASE_PROJECT_ID: ENVIRONMENTS.staging.projectId };
    const production = { ...realEnvironment, VITE_FIREBASE_PROJECT_ID: ENVIRONMENTS.production.projectId };
    expect(() => resolveBuildConfig("production", staging, ports)).toThrow(/project of staging/);
    expect(() => resolveBuildConfig("staging", production, ports)).toThrow(/project of production/);
    expect(() =>
      resolveBuildConfig("production", { ...realEnvironment, VITE_FIREBASE_PROJECT_ID: "eegml-staging" }, ports),
    ).toThrow(/staging/);
    expect(() =>
      resolveBuildConfig(
        "staging",
        { ...realEnvironment, VITE_FIREBASE_AUTH_DOMAIN: `${ENVIRONMENTS.production.projectId}.firebaseapp.com` },
        ports,
      ),
    ).toThrow(/names the project of production/);
  });

  it("widens the policy for App Check only where it is configured", () => {
    const production = buildContentSecurityPolicy(resolveBuildConfig("production", realEnvironment, ports));
    expect(production).toContain("https://content-firebaseappcheck.googleapis.com");
    expect(production).toMatch(/script-src 'self' https:\/\/www\.google\.com\/recaptcha\//);
    const emulator = buildContentSecurityPolicy(resolveBuildConfig("emulator", {}, ports));
    expect(emulator).not.toContain("recaptcha");
  });
});

describe("resolveBuildConfig", () => {
  it("needs no variables in emulator mode and takes the emulator ports from the port base", () => {
    const config = resolveBuildConfig("emulator", {}, ports);
    expect(config.firebase.projectId).toBe("demo-eegml");
    expect(config.emulators).toEqual({
      host: "127.0.0.1",
      auth: 9399,
      firestore: 9380,
      functions: 9301,
      storage: 9397,
    });
    expect(config.functionsRegion).toBe("europe-west2");
    expect(config.googleSignIn).toBe(false);
  });

  it.each(["staging", "production"])("fails with a clear message when the %s variables are missing", (mode) => {
    const attempt = () => resolveBuildConfig(mode, { VITE_FIREBASE_API_KEY: "example-api-key" }, ports);
    expect(attempt).toThrow(`Cannot build the portal in "${mode}" mode`);
    expect(attempt).toThrow(/VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, .* are not set/);
    expect(attempt).toThrow(/\.env\.example/);
  });

  it("names every required variable when none is set", () => {
    for (const name of REQUIRED_VARIABLES) {
      expect(() => resolveBuildConfig("production", {}, ports)).toThrow(name);
    }
  });

  it("reads the web configuration from the variables and connects to no emulator", () => {
    const config = resolveBuildConfig("production", realEnvironment, ports);
    expect(config.mode).toBe("production");
    expect(config.emulators).toBeNull();
    expect(config.firebase).toEqual({
      apiKey: "example-api-key",
      projectId: "example-portal",
      appId: "1:000000000000:web:0000000000000000",
      authDomain: "example-portal.firebaseapp.com",
      storageBucket: "example-portal.firebasestorage.app",
    });
  });

  it("refuses to point a staging or production build at a demonstration project", () => {
    const env = { ...realEnvironment, VITE_FIREBASE_PROJECT_ID: "demo-eegml" };
    expect(() => resolveBuildConfig("staging", env, ports)).toThrow(/only exist in the emulators/);
  });

  it("refuses a mode it does not know", () => {
    expect(() => resolveBuildConfig("development", {}, ports)).toThrow(/Unknown build mode "development"/);
  });

  it("builds Google sign-in in only when the flag says so", () => {
    expect(resolveBuildConfig("emulator", { VITE_ENABLE_GOOGLE_SIGN_IN: "true" }, ports).googleSignIn).toBe(true);
    expect(resolveBuildConfig("emulator", { VITE_ENABLE_GOOGLE_SIGN_IN: "false" }, ports).googleSignIn).toBe(false);
    expect(resolveBuildConfig("emulator", {}, ports).presence).toBe("cursor");
    expect(resolveBuildConfig("emulator", { VITE_PRESENCE: "presence" }, ports).presence).toBe("presence");
    expect(() => resolveBuildConfig("emulator", { VITE_PRESENCE: "carets" }, ports)).toThrow(/VITE_PRESENCE/);
    expect(() => resolveBuildConfig("emulator", { VITE_ENABLE_GOOGLE_SIGN_IN: "yes" }, ports)).toThrow(
      /"true" or "false"/,
    );
  });
});

describe("resolvePublicPath", () => {
  it("is the path of the preview server for emulator builds, which the tests and the preview use", () => {
    expect(resolvePublicPath("emulator", {})).toBe("/portal/");
  });

  it.each(["staging", "production"])(
    "is the root of a domain of its own for a %s build unless told otherwise",
    (mode) => {
      expect(resolvePublicPath(mode, {})).toBe("/");
      expect(resolvePublicPath(mode, { PORTAL_PUBLIC_PATH: "  " })).toBe("/");
      expect(resolvePublicPath(mode, { PORTAL_PUBLIC_PATH: "/eegmanylabs-org/" })).toBe("/eegmanylabs-org/");
    },
  );

  it("can be set for an emulator build as well", () => {
    expect(resolvePublicPath("emulator", { PORTAL_PUBLIC_PATH: "/" })).toBe("/");
  });

  it.each(["portal/", "/portal", "//example.org/", "https://example.org/", "/a b/", '/"/', "/../"])(
    "refuses %j, which is no path with a slash at both ends",
    (value) => {
      expect(() => resolvePublicPath("production", { PORTAL_PUBLIC_PATH: value })).toThrow(/PORTAL_PUBLIC_PATH/);
    },
  );
});

describe("buildContentSecurityPolicy", () => {
  const directive = (policy: string, name: string) =>
    policy
      .split("; ")
      .find((part) => part.startsWith(`${name} `) || part === name)
      ?.split(" ")
      .slice(1);

  it("denies by default and never allows inline or evaluated scripts", () => {
    for (const env of [{}, { VITE_ENABLE_GOOGLE_SIGN_IN: "true" }]) {
      for (const mode of ["emulator", "production"]) {
        const policy = buildContentSecurityPolicy(resolveBuildConfig(mode, { ...realEnvironment, ...env }, ports));
        expect(directive(policy, "default-src")).toEqual(["'none'"]);
        expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
        expect(policy).not.toContain("unsafe-eval");
        expect(directive(policy, "font-src")).toEqual(["'self'"]);
        expect(directive(policy, "object-src")).toEqual(["'none'"]);
      }
    }
  });

  it("allows inline styles, which Radix needs for its scroll lock", () => {
    const policy = buildContentSecurityPolicy(resolveBuildConfig("emulator", {}, ports));
    expect(directive(policy, "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("lets an emulator build connect to the emulators of its port base and to nothing else", () => {
    const policy = buildContentSecurityPolicy(resolveBuildConfig("emulator", {}, ports));
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "http://127.0.0.1:9399",
      "http://127.0.0.1:9380",
      "http://127.0.0.1:9301",
      "http://127.0.0.1:9397",
    ]);
    expect(directive(policy, "frame-src")).toEqual(["'none'"]);
    expect(policy).not.toContain("https://");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("lets a production build reach the Firebase services of its own project, in London", () => {
    const policy = buildContentSecurityPolicy(resolveBuildConfig("production", realEnvironment, ports));
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
      "https://firestore.googleapis.com",
      "https://europe-west2-example-portal.cloudfunctions.net",
      "https://firebasestorage.googleapis.com",
      "https://content-firebaseappcheck.googleapis.com",
      "https://www.google.com/recaptcha/",
    ]);
    // The image Firestore loads to tell "network down" from "server down".
    expect(directive(policy, "img-src")).toContain("https://www.google.com/images/cleardot.gif");
    expect(directive(policy, "script-src")).toEqual([
      "'self'",
      "https://www.google.com/recaptcha/",
      "https://www.gstatic.com/recaptcha/",
    ]);
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("127.0.0.1");
  });

  it("adds Google's helper script and frame only when Google sign-in is built in", () => {
    const env = { ...realEnvironment, VITE_ENABLE_GOOGLE_SIGN_IN: "true" };
    const policy = buildContentSecurityPolicy(resolveBuildConfig("production", env, ports));
    expect(directive(policy, "script-src")).toEqual([
      "'self'",
      "https://www.google.com/recaptcha/",
      "https://www.gstatic.com/recaptcha/",
      "https://apis.google.com",
    ]);
    expect(directive(policy, "frame-src")).toEqual([
      "https://www.google.com/recaptcha/",
      "https://recaptcha.google.com/recaptcha/",
      "https://example-portal.firebaseapp.com",
    ]);
  });
});
