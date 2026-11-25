import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  decide,
  parseAppliedDpi,
  readTextRenderingSync,
  writeTextRendering,
  createTextRenderingStore,
} from "../desktop/text-rendering.mjs";

test("decide selects grayscale or subpixel by mode and scale", () => {
  assert.equal(decide({ mode: "auto", scale: 1 }), "subpixel");
  assert.equal(decide({ mode: "auto", scale: 1.5 }), "subpixel");
  assert.equal(decide({ mode: "auto", scale: 2 }), "grayscale");
  assert.equal(decide({ mode: "auto", scale: 3.5 }), "grayscale");
  assert.equal(decide({ mode: "grayscale", scale: 1 }), "grayscale");
  assert.equal(decide({ mode: "subpixel", scale: 3.5 }), "subpixel");
  // Missing or invalid mode defaults to auto; missing or invalid scale defaults to 1.
  assert.equal(decide(), "subpixel");
  assert.equal(decide({ mode: "invalid", scale: 2 }), "grayscale");
  assert.equal(decide({ mode: "auto", scale: NaN }), "subpixel");
  assert.equal(decide({ mode: "auto", scale: 0 }), "subpixel");
  assert.equal(decide({ mode: "auto", scale: "3" }), "subpixel");
});

test("parseAppliedDpi reads hex and decimal Windows DPI registry output", () => {
  assert.equal(
    parseAppliedDpi(
      "HKEY_CURRENT_USER\\Control Panel\\Desktop\\WindowMetrics\n    AppliedDPI    REG_DWORD    0x78\n",
    ),
    1.25,
  );
  assert.equal(parseAppliedDpi("    AppliedDPI    REG_DWORD    0x150\n"), 3.5);
  assert.equal(parseAppliedDpi("    AppliedDPI    REG_DWORD    192\n"), 2);
  assert.equal(parseAppliedDpi(""), null);
});

test("readTextRenderingSync falls back to auto on missing or damaged files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-text-render-"));
  try {
    const missing = path.join(dir, "missing.json");
    assert.deepEqual(readTextRenderingSync(missing, { platform: "linux" }), {
      mode: "auto",
      scale: null,
      effective: "subpixel",
      persisted: null,
    });

    const damaged = path.join(dir, "text-rendering.json");
    await fs.writeFile(damaged, "{not-valid-json", "utf8");
    const winRead = readTextRenderingSync(damaged, {
      platform: "win32",
      exec: () => "    AppliedDPI    REG_DWORD    0x150\n",
    });
    assert.deepEqual(winRead, {
      mode: "auto",
      scale: 3.5,
      effective: "grayscale",
      persisted: null,
    });

    await fs.writeFile(
      damaged,
      JSON.stringify({ mode: "subpixel", scale: 2.5 }),
      "utf8",
    );
    const valid = readTextRenderingSync(damaged, {
      platform: "win32",
      exec: () => {
        throw Error("should not query registry when scale is saved");
      },
    });
    assert.deepEqual(valid, {
      mode: "subpixel",
      scale: 2.5,
      effective: "subpixel",
      persisted: { mode: "subpixel", scale: 2.5 },
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("createTextRenderingStore writes only when mode or scale changes and keeps effective until restart", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-tr-store-"));
  try {
    const file = path.join(dir, "text-rendering.json");
    let writes = 0;
    const initial = readTextRenderingSync(file, { platform: "linux" });
    const store = createTextRenderingStore({
      file,
      initial,
      write: async (target, next) => {
        writes++;
        return writeTextRendering(target, next);
      },
    });
    assert.deepEqual(store.status(), {
      mode: "auto",
      effective: "subpixel",
      scale: null,
    });
    assert.equal(store.recordScale(1.25), true);
    await store.flush();
    assert.equal(writes, 1);
    assert.equal(store.recordScale(1.25), false);
    await store.flush();
    assert.equal(writes, 1);

    const afterMode = await store.setMode("grayscale");
    assert.deepEqual(afterMode, {
      mode: "grayscale",
      effective: "subpixel",
      scale: 1.25,
    });
    assert.equal(writes, 2);
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
      mode: "grayscale",
      scale: 1.25,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
