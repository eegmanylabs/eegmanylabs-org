import { describe, expect, it } from "vitest";
import { portsFor } from "../../scripts/ports.mjs";
import { REQUIRED_VARIABLES, resolveBuildConfig } from "./build-config.ts";
import { buildContentSecurityPolicy } from "./csp.ts";

const ports = portsFor(9300);

// Invented values in the shape the Firebase console gives. They name no real project.
const realEnvironment = {
  VITE_FIREBASE_API_KEY: "example-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "example-portal.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "example-portal",
  VITE_FIREBASE_STORAGE_BUCKET: "example-portal.firebasestorage.app",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
};

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
    expect(() => resolveBuildConfig("emulator", { VITE_ENABLE_GOOGLE_SIGN_IN: "yes" }, ports)).toThrow(
      /"true" or "false"/,
    );
  });
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
    ]);
    // The image Firestore loads to tell "network down" from "server down".
    expect(directive(policy, "img-src")).toContain("https://www.google.com/images/cleardot.gif");
    expect(directive(policy, "script-src")).toEqual(["'self'"]);
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("127.0.0.1");
  });

  it("adds Google's helper script and frame only when Google sign-in is built in", () => {
    const env = { ...realEnvironment, VITE_ENABLE_GOOGLE_SIGN_IN: "true" };
    const policy = buildContentSecurityPolicy(resolveBuildConfig("production", env, ports));
    expect(directive(policy, "script-src")).toEqual(["'self'", "https://apis.google.com"]);
    expect(directive(policy, "frame-src")).toEqual(["https://example-portal.firebaseapp.com"]);
  });
});
