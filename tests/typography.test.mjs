import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WEIGHT_STEPS,
  readingWeight,
  bodyFontWeight,
  emphasisWeight,
  fluidFactor,
  noteSize,
  subsetFontCss,
} from "../src/typography.js";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("automatic reading weight adapts to DPR and theme, supports 300-550, and migrates 600 -> 550", () => {
  assert.deepEqual(WEIGHT_STEPS, [300, 350, 400, 450, 500, 550]);
  assert.equal(readingWeight({ weight: "auto", dpr: 1, theme: "light" }), 450);
  assert.equal(
    readingWeight({ weight: "auto", dpr: 1.25, theme: "light" }),
    450,
  );
  assert.equal(
    readingWeight({ weight: "auto", dpr: 1.5, theme: "light" }),
    400,
  );
  assert.equal(readingWeight({ weight: "auto", dpr: 2, theme: "light" }), 400);
  assert.equal(readingWeight({ weight: "auto", dpr: 1, theme: "dark" }), 400);
  assert.equal(readingWeight({ weight: "auto", dpr: 2, theme: "dark" }), 400);
  assert.equal(
    readingWeight({ weight: "auto", dpr: 1, theme: "light", autoRule: "v064" }),
    400,
  );
  for (const weight of [300, 350, 400, 450, 500, 550]) {
    assert.equal(readingWeight({ weight, dpr: 1, theme: "light" }), weight);
    assert.equal(readingWeight({ weight, dpr: 2, theme: "dark" }), weight);
    assert.ok(emphasisWeight(weight) - weight >= 150);
    assert.ok(emphasisWeight(weight) <= 800);
  }
  assert.equal(bodyFontWeight(300), 400);
  assert.equal(bodyFontWeight(400), 400);
  assert.equal(bodyFontWeight(450), 400);
  assert.equal(bodyFontWeight(500), 500);
  assert.equal(bodyFontWeight(550), 500);
  assert.equal(readingWeight({ weight: 600, dpr: 1, theme: "light" }), 550);
  assert.equal(
    readingWeight({ weight: "unknown", dpr: 1, theme: "light" }),
    450,
  );
});

test("subsetFontCss keeps only @font-face subsets matching characters in the note", () => {
  const notoCss = fs.readFileSync(
    path.join(
      project,
      "node_modules/@fontsource-variable/noto-sans-sc/wght.css",
    ),
    "utf8",
  );
  const allFaces = (notoCss.match(/@font-face\s*\{/g) || []).length;
  assert.ok(allFaces > 80);
  const smallCss = subsetFontCss(notoCss, "测试排版\nHello 123");
  const keptFaces = (smallCss.match(/@font-face\s*\{/g) || []).length;
  assert.ok(keptFaces >= 1 && keptFaces < 10);
  assert.equal(subsetFontCss(notoCss, ""), "");
});

test("fluid note size scales smoothly between 1366px and 1920px viewports", () => {
  assert.equal(fluidFactor(1024), 1);
  assert.equal(fluidFactor(1366), 1);
  assert.ok(Math.abs(fluidFactor(1643) - 1.045) < 1e-6);
  assert.ok(Math.abs(fluidFactor(1920) - 1.09) < 1e-6);
  assert.ok(Math.abs(fluidFactor(2560) - 1.09) < 1e-6);
  assert.equal(
    noteSize({ typeface: "serif", zoom: 100, viewportWidth: 1366 }),
    16,
  );
  assert.ok(
    Math.abs(
      noteSize({ typeface: "serif", zoom: 100, viewportWidth: 1920 }) - 17.44,
    ) < 1e-6,
  );
  assert.equal(
    noteSize({ typeface: "balanced", zoom: 100, viewportWidth: 1366 }),
    18,
  );
  assert.ok(
    Math.abs(
      noteSize({ typeface: "classic", zoom: 125, viewportWidth: 1366 }) - 22.5,
    ) < 1e-6,
  );
});

test("auto weight reads 100 heavier for the serif pairing; chosen steps stay as chosen", () => {
  for (const [dpr, theme, base] of [
    [1, "light", 450],
    [2, "light", 400],
    [3.5, "dark", 400],
  ]) {
    assert.equal(
      readingWeight({ weight: "auto", dpr, theme, typeface: "serif" }),
      base + 100,
    );
    assert.equal(
      readingWeight({ weight: "auto", dpr, theme, typeface: "balanced" }),
      base,
    );
  }
  assert.equal(readingWeight({ weight: 400, dpr: 2, typeface: "serif" }), 400);
});
