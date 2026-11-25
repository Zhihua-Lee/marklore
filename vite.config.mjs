import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Chromium always picks KaTeX's woff2; drop the woff/ttf fallbacks (~0.8 MB of
// bundled fonts). Export embeds woff2 from its own ?raw copy and is unaffected.
const katexWoff2Only = {
  name: "folio-katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id)) return null;
    const next = code.replace(
      /,url\([^)]*\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g,
      "",
    );
    if (next === code)
      this.warn("KaTeX font-face format changed; woff/ttf fallbacks kept");
    return { code: next, map: null };
  },
};

// URLs of the serif pairing's font files for src/reading-fonts.js, which
// builds its @font-face rules at run time: the dev server serves them from
// node_modules; a build emits them as assets (names keep the fontsource file
// name, which desktop/export.mjs looks up).
const SERIF_FONTS = [
  [
    "@fontsource-variable/source-serif-4/files",
    /-standard-(?:normal|italic)\.woff2$/,
  ],
  ["@fontsource-variable/noto-serif-sc/files", /-wght-normal\.woff2$/],
];
function serifFontUrls() {
  let build = false;
  return {
    name: "folio-serif-font-urls",
    configResolved(config) {
      build = config.command === "build";
    },
    resolveId: (id) =>
      id === "virtual:serif-font-urls" ? "\0virtual:serif-font-urls" : null,
    load(id) {
      if (id !== "\0virtual:serif-font-urls") return null;
      const entries = [];
      for (const [dir, pattern] of SERIF_FONTS) {
        const abs = path.join(here, "node_modules", dir);
        for (const name of fs.readdirSync(abs).filter((n) => pattern.test(n))) {
          if (!build) {
            entries.push(
              `${JSON.stringify(name)}: ${JSON.stringify(`/node_modules/${dir}/${name}`)}`,
            );
            continue;
          }
          const ref = this.emitFile({
            type: "asset",
            name,
            source: fs.readFileSync(path.join(abs, name)),
          });
          entries.push(
            `${JSON.stringify(name)}: import.meta.ROLLUP_FILE_URL_${ref}`,
          );
        }
      }
      return `export default {${entries.join(",\n")}};`;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [katexWoff2Only, serifFontUrls()],
  // Keep font assets on the app's own origin; the desktop CSP rejects data fonts.
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
  // Only the app's page is scanned for dependencies, not any other HTML file
  // lying in the folder (a second copy of a library would be loaded).
  optimizeDeps: { entries: ["index.html"] },
  server: {
    host: "127.0.0.1",
    watch: {
      ignored: [
        "**/release/**",
        "**/.claude/**",
        "**/dist-mobile/**",
        "**/.local/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
  },
});
