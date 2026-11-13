import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { runDirectory, webOutputDirectory } from "../scripts/paths.mjs";
import { LOCAL_HOST, portsFor, resolvePortBase } from "../scripts/ports.mjs";
import { resolveBuildConfig, resolvePublicPath } from "./config/build-config.ts";
import { portalHtml } from "./config/html-plugin.ts";

export default defineConfig(({ mode }) => {
  const ports = portsFor(resolvePortBase());
  // VITE_ variables are the Firebase web configuration. PORTAL_PUBLIC_PATH is read by the build
  // only and is not compiled into the application.
  const env = loadEnv(mode, import.meta.dirname, ["VITE_", "PORTAL_PUBLIC_PATH"]);
  const buildConfig = resolveBuildConfig(mode, env, ports);
  const publicPath = resolvePublicPath(mode, env);

  return {
    // Relative asset addresses and hash-based routes: the same files work at any address,
    // including a project site such as https://<owner>.github.io/<repository>/.
    base: "./",
    plugins: [react(), tailwindcss(), portalHtml(buildConfig, { publicPath })],
    resolve: { tsconfigPaths: true },
    // The development server's cache of pre-bundled dependencies, kept with the other files of
    // the run so that two servers on different port bases do not share one.
    cacheDir: path.join(runDirectory(ports.base), "vite"),
    define: { __PORTAL_BUILD_CONFIG__: JSON.stringify(buildConfig) },
    server: { host: LOCAL_HOST, port: ports.dev, strictPort: true },
    build: {
      // PORTAL_WEB_OUT_DIR lets a test build somewhere else, away from the builds in use.
      outDir: process.env.PORTAL_WEB_OUT_DIR?.trim() || webOutputDirectory(mode, ports.base),
      emptyOutDir: true,
      // Never inline fonts or images as data: addresses, so font-src can stay 'self'.
      assetsInlineLimit: 0,
      rolldownOptions: {
        output: {
          // What only the editor needs, the Yjs documents, presence and the file storage of pages
          // behind "@/data/collaboration", gets a chunk of its own, so that the modules the first
          // page shares with the editor do not pull it into the first load.
          // portal/tests/architecture/production-build.test.ts holds the first load to its budget.
          codeSplitting: {
            // A group holds the modules it names and not what they import, which stays shared.
            includeDependenciesRecursively: false,
            groups: [
              {
                name: "collaboration",
                test: /[\\/]node_modules[\\/](yjs|lib0|y-protocols|y-prosemirror|firebase[\\/]storage|@firebase[\\/]storage)[\\/]|[\\/]src[\\/]data[\\/](collaboration|page-files|page-presence|page-sync|awareness-wire|yjs-updates)\.ts$/,
              },
            ],
          },
        },
      },
    },
  };
});
