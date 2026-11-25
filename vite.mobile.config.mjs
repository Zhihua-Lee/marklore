import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "mobile", "public");
const swSource = path.join(root, "mobile", "sw.js");

// Writes the service worker (mobile/sw.js) with the list of every file of the
// build and a version derived from their names (hashed assets) and sw.js.
function precache() {
  return {
    name: "marklore-reader-precache",
    apply: "build",
    generateBundle(_, bundle) {
      const files = [
        "./",
        "index.html",
        ...Object.keys(bundle),
        ...fs.readdirSync(publicDir),
      ]
        .filter((f) => !f.endsWith(".map"))
        .filter((f, i, all) => all.indexOf(f) === i);
      const hash = crypto.createHash("sha256");
      for (const name of files.sort()) hash.update(name);
      const worker = fs.readFileSync(swSource, "utf8");
      hash.update(worker);
      const version = hash.digest("hex").slice(0, 12);
      if (!worker.includes("/* PRECACHE */"))
        throw new Error("mobile/sw.js lost its /* PRECACHE */ marker");
      const list = `self.PRECACHE = ${JSON.stringify({ version, files })};`;
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: worker.split("/* PRECACHE */").join(list),
      });
    },
  };
}

// The phone reader (mobile/). It imports the desktop renderer from src/.
export default defineConfig({
  root: path.join(root, "mobile"),
  base: "./",
  publicDir,
  plugins: [precache()],
  build: {
    outDir: path.join(root, "dist-mobile"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
  optimizeDeps: { entries: ["index.html"] },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    fs: { allow: [root] },
    watch: {
      ignored: ["**/release/**", "**/.local/**", "**/test-results/**"],
    },
  },
});
