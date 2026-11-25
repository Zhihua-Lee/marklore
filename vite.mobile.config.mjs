import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "mobile", "public");

// Writes precache.js for the service worker (public/sw.js): every file of the
// build and a version derived from their names (hashed assets) and contents.
function precache() {
  return {
    name: "marklore-reader-precache",
    apply: "build",
    generateBundle(_, bundle) {
      const files = [
        "./",
        "index.html",
        ...Object.keys(bundle),
        ...fs.readdirSync(publicDir).filter((f) => f !== "sw.js"),
      ]
        .filter((f) => !f.endsWith(".map"))
        .filter((f, i, all) => all.indexOf(f) === i);
      const hash = crypto.createHash("sha256");
      for (const name of files.sort()) hash.update(name);
      hash.update(fs.readFileSync(path.join(publicDir, "sw.js")));
      const version = hash.digest("hex").slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "precache.js",
        source: `self.PRECACHE = ${JSON.stringify({ version, files })};\n`,
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
