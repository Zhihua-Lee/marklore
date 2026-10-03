import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseNote, createLinkIndex } from "../desktop/link-index.mjs";
import { headingSlug, createSlugger } from "../desktop/slug.mjs";

test("heading slugs match the reader's anchors", () => {
  assert.equal(headingSlug("Parseval's identity"), "parsevals-identity");
  assert.equal(
    headingSlug("Lemma B.7 — Hoeffding’s Lemma"),
    "lemma-b7-hoeffdings-lemma",
  );
  assert.equal(headingSlug("常用 性质"), "常用-性质");
  assert.equal(headingSlug("!!!"), "section");
  const slug = createSlugger();
  assert.deepEqual(["定义", "定义", "定义"].map(slug), [
    "定义",
    "定义-1",
    "定义-2",
  ]);
});

const note = [
  "# Sep 29 — Hoeffding’s Lemma",
  "",
  "此前的 [Hoeffding 不等式](./Sep01.md#hoeffding)控制样本平均偏离期望的概率。",
  "",
  '<a id="hoeffding-lemma"></a>',
  "",
  "## Lemma B.7 — Hoeffding’s Lemma",
  "",
  '<a id="erm"></a>',
  "",
  "**Definition（ERM）。** 经验风险最小化选取 $h_S$，见 [Sep27](Sep27.md)。",
  "",
  "```markdown",
  "[not a link](Ignored.md)",
  "```",
  "",
  "Code `[inline](Nope.md)`, an ![image](pic.md), [web](https://example.com) and [mail](mailto:a@b.c).",
  "",
  "Setext heading",
  "--------------",
  "",
  "Back to [the lemma](#hoeffding-lemma) and [space](<My Note.md#Part%20Two>).",
].join("\n");

test("links: local notes and anchors only, with where they are", () => {
  const file = path.resolve("C:/kb/Sep29.md");
  const { links } = parseNote(note, file);
  assert.deepEqual(
    links.map((l) => [path.basename(l.target), l.fragment, l.text, l.line]),
    [
      ["Sep01.md", "hoeffding", "Hoeffding 不等式", 3],
      ["Sep27.md", "", "Sep27", 11],
      ["Sep29.md", "hoeffding-lemma", "the lemma", 22],
      ["My Note.md", "Part Two", "space", 22],
    ],
  );
  assert.equal(links[0].column, 5);
  assert.equal(links[1].section, "Lemma B.7 — Hoeffding’s Lemma");
  assert.match(
    links[0].snippet,
    /^此前的 <mark class="backlink-hit">Hoeffding 不等式<\/mark>控制/,
  );
  // Other links in the snippet read as their text; formulas stay whole.
  assert.match(links[1].snippet, /选取 \$h_S\$，见 <mark/);
});

test("anchors: headings, explicit ids and what they mark", () => {
  const { anchors } = parseNote(note, path.resolve("C:/kb/Sep29.md"));
  const byId = Object.fromEntries(anchors.map((a) => [a.id, a]));
  assert.equal(byId["sep-29-hoeffdings-lemma"].kind, "heading");
  assert.equal(byId["setext-heading"].kind, "heading");
  // An anchor above a heading marks that heading.
  assert.equal(byId["hoeffding-lemma"].heading, "lemma-b7-hoeffdings-lemma");
  // An anchor above a bold-led paragraph is named after the bold lead.
  assert.equal(byId.erm.kind, "explicit");
  assert.equal(byId.erm.label, "Definition（ERM）");
  assert.equal(byId.erm.heading, undefined);
  assert.equal(byId.erm.section, "Lemma B.7 — Hoeffding’s Lemma");
});

test("the index finds backlinks, follows changes and checks links", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-links-"));
  const write = (name, text) =>
    fs.writeFile(path.join(root, name), text, "utf8");
  try {
    await fs.mkdir(path.join(root, "sub"));
    await fs.mkdir(path.join(root, ".git"));
    await write(
      "B.md",
      '# B\n\n<a id="def"></a>\n\n**Definition（X）。** text\n',
    );
    await write("A.md", "See [the definition](B.md#def).\n");
    await write("sub/C.md", "Also [B](../B.md) and [gone](Missing.md).\n");
    await write(".git/D.md", "[hidden](../B.md)\n");
    const index = createLinkIndex();
    await index.follow([root]);
    assert.equal(index.size, 3);
    // Every note with its anchors, for the link picker; headings know their level.
    const listed = await index.notes();
    assert.equal(listed.length, 3);
    const bNote = listed.find((n) => n.path.endsWith("B.md"));
    assert.deepEqual(
      bNote.anchors.map((a) => [a.id, a.kind, a.level ?? null, a.label]),
      [
        ["b", "heading", 1, "B"],
        ["def", "explicit", null, "Definition（X）"],
      ],
    );
    const b = path.join(root, "B.md");
    let back = await index.backlinks(b);
    assert.deepEqual(
      back.map((l) => [path.basename(l.source), l.fragment]).sort(),
      [
        ["A.md", "def"],
        ["C.md", ""],
      ],
    );
    // Another program adds a link; the index follows.
    await write("E.md", "Uses [X](B.md#def) twice: [again](./B.md#def).\n");
    assert.equal(await index.changed(path.join(root, "E.md")), true);
    back = await index.backlinks(b);
    assert.equal(back.filter((l) => l.fragment === "def").length, 3);
    await fs.rm(path.join(root, "A.md"));
    await index.changed(path.join(root, "A.md"));
    assert.equal((await index.backlinks(b)).length, 3);
    // Outside the library: ignored.
    assert.equal(await index.changed(path.join(os.tmpdir(), "x.md")), false);

    const from = path.join(root, "sub", "C.md");
    assert.equal(await index.status(from, "../B.md#def"), "ok");
    assert.equal(await index.status(from, "../B.md#nope"), "missing-anchor");
    assert.equal(await index.status(from, "Missing.md"), "missing-file");
    assert.equal(await index.status(from, "../B.md#L3"), "ok");
    assert.equal(await index.status(from, "https://example.com"), "ok");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
