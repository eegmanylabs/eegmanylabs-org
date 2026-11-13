import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// One configuration, five projects. `npm run test:unit` runs the first two, which need nothing
// running. The other three expect the emulators and are started through
// `node scripts/emulators.mjs exec`, which is what the test:* scripts in package.json do.
//
// `rules` and `tools` run without the functions emulator. The functions emulator runs the
// Firestore triggers for every write to the demonstration project, and the tools tests count
// exactly what a tool writes, so `npm test` starts the emulators twice: once without the
// functions for those two projects, and once with them for `functions` and the browser tests.
const emulated = {
  environment: "node",
  // No Google credentials exist locally: skip the metadata-server probe of the Admin SDK.
  env: { METADATA_SERVER_DETECTION: "none" },
  testTimeout: 30_000,
  hookTimeout: 60_000,
  // Files in one project share emulator state, so they run one after another.
  fileParallelism: false,
} as const;

/**
 * The order of the test files. A file of the functions suite that needs the Firestore triggers
 * declares it with `withTriggers()`, and those files run after every other file, so the suite
 * switches the triggers on once (tests/support/triggers.ts explains why each switch on costs
 * every later write). Within each group the default order holds.
 */
class TriggerSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const later = new Set(sorted.filter((file) => /^withTriggers\(\);$/m.test(readFileSync(file.moduleId, "utf8"))));
    return [...sorted.filter((file) => !later.has(file)), ...sorted.filter((file) => later.has(file))];
  }
}

export default defineConfig({
  test: {
    // The files of the functions suite that need the triggers run last.
    sequence: { sequencer: TriggerSequencer },
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [
            "shared/src/**/*.test.ts",
            "functions/src/**/*.test.ts",
            "tools/src/**/*.test.ts",
            "web/config/**/*.test.ts",
            "scripts/**/*.test.mjs",
            "tests/architecture/**/*.test.ts",
            "tests/editor/**/*.test.ts",
          ],
        },
      },
      "web/vitest.config.ts",
      // The Storage emulator reads Firestore in the project it runs for, which the tests of the
      // storage rules therefore use, and so do the tools: the tools run after the rules.
      { test: { ...emulated, name: "rules", include: ["tests/rules/**/*.test.ts"], sequence: { groupOrder: 0 } } },
      {
        test: {
          ...emulated,
          name: "functions",
          include: ["tests/functions/**/*.test.ts"],
          // A test may wait for a trigger, whose first run after the emulator has loaded takes seconds,
          // and `eventually` in tests/functions/support.ts waits longer while the emulator is busy
          // with the events of other triggers, up to six times its own time.
          testTimeout: 240_000,
          hookTimeout: 240_000,
        },
      },
      { test: { ...emulated, name: "tools", include: ["tests/tools/**/*.test.ts"], sequence: { groupOrder: 1 } } },
    ],
  },
});
