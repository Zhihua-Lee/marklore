import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readProperties,
  setProperty,
  addProperty,
  removeProperty,
  yamlScalar,
  formatDate,
} from "../src/properties.js";

const yaml = [
  "title: 会议记录",
  "created: 2026-03-14T14:32:00+08:00",
  "tags: [a, 'b c']",
  "aliases:",
  "  - one",
  "  - two",
  "draft: true",
  "url: https://example.com/a:b",
  "notes: |",
  "  line one",
  "作者: 李",
  "# a comment",
  "onenote_id: abc",
].join("\n");

test("properties are read by kind", () => {
  const fields = readProperties(yaml);
  const by = Object.fromEntries(fields.map((f) => [f.key, f]));
  assert.deepEqual(
    fields.map((f) => f.key),
    [
      "title",
      "created",
      "tags",
      "aliases",
      "draft",
      "url",
      "notes",
      "作者",
      "onenote_id",
    ],
  );
  assert.equal(by.title.kind, "text");
  assert.equal(by.created.kind, "date");
  assert.deepEqual(by.tags.items, ["a", "b c"]);
  assert.equal(by.aliases.block, true);
  assert.deepEqual(by.aliases.items, ["one", "two"]);
  assert.equal(by.draft.kind, "bool");
  assert.equal(by.url.kind, "url");
  assert.equal(by.url.text, "https://example.com/a:b");
  assert.equal(by.notes.kind, "complex");
  assert.equal(by["作者"].text, "李");
});

test("a value changes on its own lines only", () => {
  const out = setProperty(yaml, "title", "周会: 第 3 次");
  assert.equal(out, yaml.replace("title: 会议记录", 'title: "周会: 第 3 次"'));
  assert.equal(
    setProperty(yaml, "aliases", "one, 三"),
    yaml.replace("  - two", "  - 三"),
  );
  assert.equal(
    setProperty(yaml, "tags", "a, b c, d"),
    yaml.replace("tags: [a, 'b c']", "tags: [a, b c, d]"),
  );
  assert.equal(
    setProperty(yaml, "draft", "false"),
    yaml.replace("draft: true", "draft: false"),
  );
});

test("properties are added at the end and removed whole", () => {
  assert.equal(addProperty("a: 1\n", "b", "x"), "a: 1\nb: x");
  assert.equal(addProperty("", "b", ""), "b:");
  assert.equal(addProperty("a: 1", "a", "2"), "a: 2");
  assert.equal(
    removeProperty(yaml, "aliases"),
    yaml.replace("aliases:\n  - one\n  - two\n", ""),
  );
});

test("values that YAML would read otherwise are quoted", () => {
  assert.equal(yamlScalar("plain"), "plain");
  assert.equal(yamlScalar("true"), '"true"');
  assert.equal(yamlScalar("42"), '"42"');
  assert.equal(yamlScalar("- x"), '"- x"');
  assert.equal(yamlScalar("a: b"), '"a: b"');
  assert.equal(yamlScalar("2026-03-14"), "2026-03-14");
});

test("dates show as written, without a time zone shift", () => {
  assert.equal(formatDate("2026-03-14T23:32:00-08:00"), "2026年3月14日 23:32");
  assert.equal(formatDate("2026-11-06", true), "2026年11月6日星期五");
  assert.equal(formatDate("not a date"), "not a date");
});
