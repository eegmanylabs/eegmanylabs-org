// @ts-check
// Bundles the functions into out/index.js.
//
// Cloud Functions installs the dependencies named in this package's package.json and nothing
// else, so code from the workspace (@eegml/shared and what it depends on) has to be inside the
// deployed file. firebase-admin and firebase-functions stay external: the platform and the
// emulator both expect to load those themselves.
//
//   node bundle.mjs           build once
//   node bundle.mjs --watch   rebuild when a source file changes
//
// Output files are replaced only when their content changes, and then atomically. The functions
// emulator reloads whenever a file in this directory changes, so an unchanged rebuild must not
// disturb an emulator that another run is using.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").Plugin} */
const writeWhenChanged = {
  name: "write-when-changed",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      let written = 0;
      for (const file of result.outputFiles ?? []) {
        if (existsSync(file.path) && readFileSync(file.path).equals(file.contents)) continue;
        mkdirSync(path.dirname(file.path), { recursive: true });
        const temporary = `${file.path}.${process.pid}.tmp`;
        writeFileSync(temporary, file.contents);
        renameSync(temporary, file.path);
        written += 1;
      }
      console.log(written > 0 ? `functions: wrote ${written} file(s) to out/` : "functions: out/ is up to date");
    });
  },
};

const bundler = await context({
  absWorkingDir: here,
  entryPoints: ["src/index.ts"],
  outfile: "out/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  sourcesContent: false,
  legalComments: "none",
  external: ["firebase-admin", "firebase-admin/*", "firebase-functions", "firebase-functions/*"],
  write: false,
  logLevel: "warning",
  plugins: [writeWhenChanged],
});

if (watch) {
  await bundler.watch();
} else {
  try {
    await bundler.rebuild();
  } finally {
    await bundler.dispose();
  }
}
