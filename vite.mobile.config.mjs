import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// The phone reader (mobile/). It imports the desktop renderer from src/.
export default defineConfig({
  root: path.join(root, "mobile"),
  base: "./",
  publicDir: path.join(root, "mobile", "public"),
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
