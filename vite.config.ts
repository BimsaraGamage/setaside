import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Changes with every build: a phone's saved copy from another build is not used (src/client/offline-copy.ts). */
const buildId = String(Date.now());
/** The release, sent with feedback (ticket SAB-55). */
const appVersion: string = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "package.json"), "utf8"),
).version;

export default defineConfig({
  plugins: [serviceWorker(), react(), cloudflare()],
  define: { __BUILD_ID__: JSON.stringify(buildId), __APP_VERSION__: JSON.stringify(appVersion) },
});

/**
 * The service worker (item 23, spec 11) as /sw.js: src/service-worker.js with the files it keeps filled in.
 * A build lists every built file and public/ file; development lists none and keeps files as they load.
 */
function serviceWorker(): Plugin {
  const source = path.join(import.meta.dirname, "src/service-worker.js");
  const fill = (version: string, files: string[]) =>
    readFileSync(source, "utf8")
      .replace('"__VERSION__"', JSON.stringify(version))
      .replace('"__FILES__"', JSON.stringify(files));
  let publicDir = "";
  return {
    name: "setaside-service-worker",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server) {
      const version = `dev-${buildId}`;
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/sw.js") return next();
        res.setHeader("content-type", "text/javascript");
        res.setHeader("cache-control", "no-cache");
        res.end(fill(version, []));
      });
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const publicFiles = publicDir ? readdirSync(publicDir) : [];
      const files = [...Object.keys(bundle), ...publicFiles]
        .filter((f) => f !== "index.html" && !f.startsWith(".") && !f.endsWith(".map"))
        .map((f) => `/${f}`);
      const hash = createHash("sha256");
      for (const f of Object.keys(bundle).sort()) hash.update(f);
      for (const f of publicFiles.sort()) hash.update(f).update(readFileSync(path.join(publicDir, f)));
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: fill(hash.digest("hex").slice(0, 12), files),
      });
    },
  };
}
