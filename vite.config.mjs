import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
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
