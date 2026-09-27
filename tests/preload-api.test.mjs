import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { FOLIO_API } from "./ui/fixtures.js";

// UI specs mock window.folio through tests/ui/fixtures.js; keep its method list
// identical to what the real preload bridge exposes.
test("UI test harness mirrors the preload bridge", async () => {
  const source = await fs.readFile(
    new URL("../desktop/preload.cjs", import.meta.url),
    "utf8",
  );
  const listed = source
    .match(/for \(const name of \[([\s\S]*?)\]\)/)[1]
    .match(/"([^"]+)"/g)
    .map((s) => s.slice(1, -1));
  const assigned = [...source.matchAll(/^api\.(\w+) =/gm)].map((m) => m[1]);
  assert.deepEqual([...FOLIO_API].sort(), [...listed, ...assigned].sort());
});
