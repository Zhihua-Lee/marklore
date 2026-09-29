import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, normalizeSettings } from "../src/settings.js";

test("defaults are fresh objects so tab groups are never shared", () => {
  const first = defaultSettings(),
    second = defaultSettings();
  assert.notEqual(first, second);
  assert.notEqual(first.tabGroups, second.tabGroups);
  first.tabGroups.push({ id: "g" });
  assert.deepEqual(defaultSettings().tabGroups, []);
});

test("empty or missing settings normalize to the defaults", () => {
  const expected = { ...defaultSettings(), typographyVersion: 1 };
  assert.deepEqual(normalizeSettings(), expected);
  assert.deepEqual(normalizeSettings({}), expected);
});

test("normalizing returns a new object and keeps the input untouched", () => {
  const saved = { zoom: 999, theme: "sepia" };
  const result = normalizeSettings(saved);
  assert.notEqual(result, saved);
  assert.deepEqual(saved, { zoom: 999, theme: "sepia" });
});

test("numeric settings are clamped and fall back when invalid", () => {
  for (const [key, min, max, fallback] of [
    ["zoom", 50, 200, 100],
    ["previewZoom", 50, 200, 100],
    ["navigationSize", 10, 14, 12],
    ["tabSize", 10, 13, 11],
  ]) {
    assert.equal(normalizeSettings({ [key]: min - 1 })[key], min, key);
    assert.equal(normalizeSettings({ [key]: max + 1 })[key], max, key);
    assert.equal(normalizeSettings({ [key]: String(min + 1) })[key], min + 1);
    for (const invalid of ["abc", null, 0, NaN, undefined])
      assert.equal(normalizeSettings({ [key]: invalid })[key], fallback, key);
  }
});

test("enumerated settings reject unknown values", () => {
  const result = normalizeSettings({
    typeface: "comic",
    tableStyle: "zebra",
    tableWidth: "wide",
    navigationScope: "window",
    librarySide: "top",
    outlineSide: "bottom",
    theme: "sepia",
    weight: 700,
    wide: "true",
    showHistoryButtons: 1,
    smoothScroll: "fast",
    tabGroups: "none",
  });
  assert.equal(result.typeface, "literata");
  assert.equal(result.tableStyle, "soft");
  assert.equal(result.tableWidth, "auto");
  assert.equal(result.navigationScope, "all");
  assert.equal(result.librarySide, "left");
  assert.equal(result.outlineSide, "right");
  assert.equal(result.theme, "light");
  assert.equal(result.weight, "auto");
  assert.equal(result.wide, false);
  assert.equal(result.showHistoryButtons, false);
  assert.equal(result.smoothScroll, "off");
  assert.deepEqual(result.tabGroups, []);
});

test("valid stored choices survive normalization", () => {
  const groups = [{ id: "g1", name: "Work" }];
  const result = normalizeSettings({
    typeface: "book",
    tableStyle: "grid",
    tableWidth: "full",
    navigationScope: "current",
    librarySide: "right",
    outlineSide: "left",
    theme: "dark",
    weight: "500",
    wide: true,
    showHistoryButtons: true,
    smoothScroll: "all",
    tabGroups: groups,
    sidebar: false,
    split: 40,
  });
  assert.equal(result.typeface, "book");
  assert.equal(result.tableStyle, "grid");
  assert.equal(result.tableWidth, "full");
  assert.equal(result.navigationScope, "current");
  assert.equal(result.librarySide, "right");
  assert.equal(result.outlineSide, "left");
  assert.equal(result.theme, "dark");
  assert.equal(result.weight, 500);
  assert.equal(result.wide, true);
  assert.equal(result.showHistoryButtons, true);
  assert.equal(result.smoothScroll, "all");
  assert.equal(result.tabGroups, groups);
  assert.equal(result.sidebar, false);
  assert.equal(result.split, 40);
});

test("legacy balanced typeface migrates once to literata", () => {
  assert.equal(
    normalizeSettings({ typeface: "balanced" }).typeface,
    "literata",
  );
  // A choice stored after the typography migration is an explicit preference.
  const current = normalizeSettings({
    typeface: "balanced",
    typographyVersion: 1,
  });
  assert.equal(current.typeface, "balanced");
  assert.equal(current.typographyVersion, 1);
  assert.equal(normalizeSettings({ typeface: "classic" }).typeface, "classic");
});

test("the unreleased touchpad smoothing choice carries over", () => {
  const result = normalizeSettings({ touchpadScroll: "smooth" });
  assert.equal(result.smoothScroll, "touchpad");
  // As app.js boots: stored values merged over the current defaults.
  const merged = normalizeSettings({
    ...normalizeSettings(),
    touchpadScroll: "smooth",
  });
  assert.equal(merged.smoothScroll, "touchpad");
  assert.equal("touchpadScroll" in result, false);
});
