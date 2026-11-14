import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readProperties,
  setProperty,
  addProperty,
  removeProperty,
  yamlScalar,
  formatDate,
  splitFront,
  withFront,
  expandTemplate,
  mergeTemplate,
  templateNote,
  restampValue,
  restampNote,
  DEFAULT_TEMPLATE,
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

// 2026-03-14 09:05:07.250 local time.
const now = new Date(2026, 2, 14, 9, 5, 7, 250);
const zone = (() => {
  const offset = -now.getTimezoneOffset();
  const abs = Math.abs(offset);
  const two = (n) => String(n).padStart(2, "0");
  return [(offset < 0 ? "-" : "+") + two(Math.floor(abs / 60)), two(abs % 60)];
})();
const utc = now.toISOString(); // 2026-03-14T..:..:..Z

test("the front matter of a note is found as the reading view finds it", () => {
  assert.equal(splitFront("# no\n"), null);
  assert.equal(splitFront("---\n---\n"), null);
  assert.deepEqual(splitFront("---\na: 1\n---\nbody"), {
    yaml: "a: 1",
    from: 4,
    to: 8,
    open: "---\n",
    close: "---",
  });
  assert.equal(
    splitFront("---\r\na: 1\r\nb: 2\r\n...\r\n").yaml,
    "a: 1\r\nb: 2",
  );
  assert.equal(
    withFront("---\na: 1\n---\nx", "a: 2\nb: 3"),
    "---\na: 2\nb: 3\n---\nx",
  );
  assert.equal(withFront("# T\n", "a: 1"), "---\na: 1\n---\n\n# T\n");
  assert.equal(withFront("", "a: 1"), "---\na: 1\n---\n");
  // A note with Windows line breaks keeps them.
  assert.equal(
    withFront("---\r\na: 1\r\n---\r\nx", "a: 1\nb: 2"),
    "---\r\na: 1\r\nb: 2\r\n---\r\nx",
  );
});

test("a template's values are filled in local time", () => {
  assert.equal(
    expandTemplate("{title} {date} {time} {datetime} {other}", {
      now,
      title: "周会",
    }),
    "周会 2026-03-14 09:05 2026-03-14 09:05 {other}",
  );
  // A title with $ signs is put in as it is.
  assert.equal(expandTemplate("{title}", { title: "a $& $1 b" }), "a $& $1 b");
  assert.equal(
    templateNote(DEFAULT_TEMPLATE, { now, title: "周会: 第 3 次" }),
    '---\ntitle: "周会: 第 3 次"\ncreated: 2026-03-14 09:05\ntags: []\n---\n\n',
  );
  // No name yet (a new untitled note): the title waits empty.
  assert.equal(
    templateNote(
      'title: {title}\ndraft: true\nweight: 3\ntags: [a, "{date}"]',
      { now },
    ),
    "---\ntitle:\ndraft: true\nweight: 3\ntags: [a, 2026-03-14]\n---\n\n",
  );
  assert.equal(templateNote("", { now }), "");
  assert.equal(templateNote("just words", { now }), "");
});

test("the template adds only the properties a note does not have", () => {
  const yaml = "Title: 已有\ntags:\n  - x\nmodified: 2020-01-01";
  assert.equal(
    mergeTemplate(
      yaml,
      "title: {title}\ncreated: {date}\ntags: [a]\nmeta:\n  k: v",
      { now, title: "新" },
    ),
    yaml + "\ncreated: 2026-03-14\nmeta:\n  k: v",
  );
  // All there already: unchanged.
  assert.equal(mergeTemplate(yaml, "title: x\ntags: []", { now }), yaml);
  assert.equal(mergeTemplate("", "a: {date}", { now }), "a: 2026-03-14");
});

test("a modified time is written the way it was written", () => {
  const [sign, minutes] = zone;
  const off = sign + ":" + minutes;
  for (const [was, is] of [
    ["2020-01-02", "2026-03-14"],
    ["2020-01-02 03:04", "2026-03-14 09:05"],
    ["2020-01-02T03:04", "2026-03-14T09:05"],
    ["2020-01-02T03:04:05", "2026-03-14T09:05:07"],
    ["2020-01-02 03:04:05.1", "2026-03-14 09:05:07.2"],
    // OneNote's export: seven decimals and an offset.
    ["2020-01-02T03:04:05.0000000+08:00", `2026-03-14T09:05:07.2500000${off}`],
    ["2020-01-02T03:04:05+0800", `2026-03-14T09:05:07${sign}${minutes}`],
    ["2020-01-02 03:04 +08:00", `2026-03-14 09:05 ${off}`],
    ["2020-01-02T03:04:05Z", utc.slice(0, 19) + "Z"],
    ["2020-01-02T03:04:05.000Z", utc],
  ])
    assert.equal(restampValue(was, now), is, was);
  for (const odd of [
    "2020/01/02",
    "2020年1月2日",
    "yesterday",
    "",
    "2020-01-02Z",
    "1700000000",
  ])
    assert.equal(restampValue(odd, now), null, odd);
});

test("saving stamps a modified time the note has, only when it changed", () => {
  const base = "---\ntitle: T\nmodified: 2020-01-02 03:04\n---\n\nText.\n";
  const edited = base.replace("Text.", "Text, more.");
  const stamped = edited.replace("2020-01-02 03:04", "2026-03-14 09:05");
  assert.equal(restampNote(edited, base, now), stamped);
  // Nothing changed (or changed back): nothing to stamp, nothing to write.
  assert.equal(restampNote(base, base, now), base);
  // Once saved, the stamped note is the base: saving again changes nothing.
  assert.equal(restampNote(stamped, stamped, now), stamped);
  // `updated` too, quoted or not; an unreadable value stays.
  const two = '---\nupdated: "2020-01-02"\nlastmod: 2020年1月2日\n---\nA\n';
  assert.equal(
    restampNote(two.replace("A", "B"), two, now),
    "---\nupdated: 2026-03-14\nlastmod: 2020年1月2日\n---\nB\n",
  );
  // No modified time: none is added; no front matter: unchanged.
  const plain = "---\ntitle: T\n---\nA\n";
  assert.equal(
    restampNote(plain.replace("A", "B"), plain, now),
    plain.replace("A", "B"),
  );
  assert.equal(restampNote("B\n", "A\n", now), "B\n");
  // A time changed by hand is kept.
  const byHand = edited.replace("2020-01-02 03:04", "2019-05-05 05:05");
  assert.equal(restampNote(byHand, base, now), byHand);
  // A new note whose template gave it a modified time.
  assert.equal(
    restampNote(
      "---\nmodified: 2020-01-02\n---\nA",
      "---\nmodified: 2020-01-02\n---\n",
      now,
    ),
    "---\nmodified: 2026-03-14\n---\nA",
  );
  // Windows line breaks stay.
  const crlf = base.replace(/\n/g, "\r\n");
  assert.equal(
    restampNote(crlf.replace("Text.", "X"), crlf, now),
    stamped.replace("Text, more.", "X").replace(/\n/g, "\r\n"),
  );
});
