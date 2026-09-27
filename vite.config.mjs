import { defineConfig } from "vite";

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

export default defineConfig({
  base: "./",
  plugins: [katexWoff2Only],
  // Keep font assets on the app's own origin; the desktop CSP rejects data fonts.
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0,
  },
  server: {
    host: "127.0.0.1",
    watch: {
      ignored: [
        "**/release/**",
        "**/.local/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
  },
});
