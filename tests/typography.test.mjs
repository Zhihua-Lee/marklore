import test from "node:test";
import assert from "node:assert/strict";
import {
  readingWeight,
  bodyFontWeight,
  emphasisWeight,
  fluidFactor,
  noteSize,
} from "../src/typography.js";

test("automatic reading weight adapts to DPR and theme, and fixed weights avoid 600 collision", () => {
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
  for (const weight of [400, 450, 500]) {
    assert.equal(readingWeight({ weight, dpr: 1, theme: "light" }), weight);
    assert.equal(readingWeight({ weight, dpr: 2, theme: "dark" }), weight);
    assert.ok(emphasisWeight(weight) - weight >= 150);
    assert.ok(emphasisWeight(weight) <= 700);
  }
  assert.equal(bodyFontWeight(400), 400);
  assert.equal(bodyFontWeight(450), 400);
  assert.equal(bodyFontWeight(500), 500);
  assert.equal(readingWeight({ weight: 600, dpr: 1, theme: "light" }), 500);
});

test("fluid note size scales smoothly between 1366px and 1920px viewports", () => {
  assert.equal(fluidFactor(1024), 1);
  assert.equal(fluidFactor(1366), 1);
  assert.ok(Math.abs(fluidFactor(1643) - 1.045) < 1e-6);
  assert.ok(Math.abs(fluidFactor(1920) - 1.09) < 1e-6);
  assert.ok(Math.abs(fluidFactor(2560) - 1.09) < 1e-6);
  assert.equal(
    noteSize({ typeface: "literata", zoom: 100, viewportWidth: 1366 }),
    16,
  );
  assert.ok(
    Math.abs(
      noteSize({ typeface: "literata", zoom: 100, viewportWidth: 1920 }) -
        17.44,
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
