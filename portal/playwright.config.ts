import path from "node:path";
import { defineConfig } from "@playwright/test";
import { DEFAULT_MOUNT } from "./scripts/pages-server.mjs";
import { runDirectory } from "./scripts/paths.mjs";
import { LOCAL_HOST, portsFor, resolvePortBase } from "./scripts/ports.mjs";

// End-to-end tests run against the built application, served the way GitHub Pages serves it,
// with the emulators behind it. Start them with `npm run test:e2e`, which builds, starts the
// emulators and then runs Playwright. Everything derives from PORTAL_PORT_BASE.
const ports = portsFor(resolvePortBase());
const baseURL = `http://${LOCAL_HOST}:${ports.preview}${DEFAULT_MOUNT}`;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: path.join(runDirectory(ports.base), "playwright"),
  globalSetup: "./tests/e2e/global-setup.ts",
  // The tests share one set of emulators, so they run one after another.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
  },
  webServer: {
    name: "pages",
    command: "node scripts/pages-server.mjs --stop-with-emulators",
    url: baseURL,
    // Never attach to a server that another run started with a different build.
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
