import test from "node:test";
import assert from "node:assert/strict";
import {
  t,
  setLanguage,
  getLanguage,
  resolveLanguage,
} from "../desktop/i18n.mjs";
import en from "../desktop/locales/en.mjs";
import { check, sourceFiles, literals } from "../tools/i18n-check.mjs";

test("every interface string in src and desktop has an English entry", async () => {
  const problems = await check(sourceFiles());
  assert.deepEqual(problems, []);
});

test("the English dictionary has no Chinese and matching placeholders", () => {
  for (const [key, value] of Object.entries(en)) {
    assert.doesNotMatch(value, /[㐀-鿿]/, key);
    const names = (text) =>
      [...text.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",");
    assert.equal(names(value), names(key), key);
  }
});

test("t() returns the source in Chinese, the entry in English, and fills values", () => {
  const key = Object.keys(en).find((k) => !k.includes("{"));
  try {
    setLanguage("zh");
    assert.equal(t(key), key);
    setLanguage("en");
    assert.equal(getLanguage(), "en");
    assert.equal(t(key), en[key]);
    assert.equal(t("未收录的文字"), "未收录的文字");
    assert.equal(t("{a} 与 {b}", { a: 1, b: "x" }), "1 与 x");
    assert.equal(t("{a} {missing}", { a: 1 }), "1 {missing}");
  } finally {
    setLanguage("zh");
  }
});

test("a stored choice wins; otherwise the system locale decides", () => {
  assert.equal(resolveLanguage("en", "zh-CN"), "en");
  assert.equal(resolveLanguage("zh", "en-US"), "zh");
  assert.equal(resolveLanguage("auto", "zh-CN"), "zh");
  assert.equal(resolveLanguage(undefined, "zh-TW"), "zh");
  assert.equal(resolveLanguage("auto", "en-GB"), "en");
  assert.equal(resolveLanguage(null, "fr-FR"), "en");
});

test("the checker scanner separates strings, templates, comments and regexes", () => {
  const found = literals(
    'const a = "中文"; // 注释 "不算"\n/* "也不算" */ const r = /["中"]/; const b = `x${t("内")}尾`;',
  ).map((l) => [l.kind, l.text]);
  assert.deepEqual(found, [
    ["string", "中文"],
    ["template", "x"],
    ["string", "内"],
    ["template", "尾"],
  ]);
});
