import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { webOutputDirectory } from "../scripts/paths.mjs";
import { LOCAL_HOST, portsFor, resolvePortBase } from "../scripts/ports.mjs";
import { resolveBuildConfig } from "./config/build-config.ts";
import { portalHtml } from "./config/html-plugin.ts";

export default defineConfig(({ mode }) => {
  const ports = portsFor(resolvePortBase());
  const buildConfig = resolveBuildConfig(mode, loadEnv(mode, import.meta.dirname, "VITE_"), ports);

  return {
    // Relative asset addresses and hash-based routes: the same files work at any address,
    // including a project site such as https://<owner>.github.io/<repository>/.
    base: "./",
    plugins: [react(), tailwindcss(), portalHtml(buildConfig)],
    resolve: { tsconfigPaths: true },
    define: { __PORTAL_BUILD_CONFIG__: JSON.stringify(buildConfig) },
    server: { host: LOCAL_HOST, port: ports.dev, strictPort: true },
    build: {
      outDir: webOutputDirectory(mode, ports.base),
      emptyOutDir: true,
      // Never inline fonts or images as data: addresses, so font-src can stay 'self'.
      assetsInlineLimit: 0,
    },
  };
});
