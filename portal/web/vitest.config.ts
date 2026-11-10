import { defineProject } from "vitest/config";
import { portsFor, resolvePortBase } from "../scripts/ports.mjs";
import { resolveBuildConfig } from "./config/build-config.ts";

// Component and hook tests. They run in jsdom with the emulator build configuration compiled
// in, and never touch Firebase: tests replace "@/data" where a component needs it.
export default defineProject({
  resolve: { tsconfigPaths: true },
  define: {
    __PORTAL_BUILD_CONFIG__: JSON.stringify(resolveBuildConfig("emulator", {}, portsFor(resolvePortBase()))),
  },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-support/setup.ts"],
  },
});
