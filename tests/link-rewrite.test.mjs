import test from "node:test";
import assert from "node:assert/strict";
import {
  rewriteLinks,
  findDestinations,
  linkedPaths,
  isUnder,
  movedPathOf,
  unlinkTarget,
  linkTarget,
} from "../desktop/link-rewrite.mjs";
import MarkdownIt from "markdown-it";

// A note in C:/kb/notes linking to Plan.md, renamed to Roadmap.md.
const rename = (text, opts = {}) =>
  rewriteLinks(text, {
    file: "C:/kb/notes/Index.md",
    moves: [["C:/kb/notes/Plan.md", "C:/kb/notes/Roadmap.md"]],
    ...opts,
  });

test("a renamed note: links to it follow, the rest stays byte for byte", () => {
  const text =
    "See [the plan](Plan.md) and [other](Other.md).\n\n![pic](assets/a.png)\n";
  const out = rename(text);
  assert.equal(
    out.text,
    "See [the plan](Roadmap.md) and [other](Other.md).\n\n![pic](assets/a.png)\n",
  );
  assert.equal(out.count, 1);
  assert.deepEqual(out.edits, [{ from: 15, to: 22, insert: "Roadmap.md" }]);
  assert.equal(rename("No links here.\n").count, 0);
});

test("anchors, titles, angle brackets and ./ are kept", () => {
  assert.equal(
    rename("[a](Plan.md#goals) [b](./Plan.md 'T') [c](<Plan.md#x> \"Title\")")
      .text,
    "[a](Roadmap.md#goals) [b](./Roadmap.md 'T') [c](<Roadmap.md#x> \"Title\")",
  );
  // A query, and an anchor-only link to the same note, stay.
  assert.equal(
    rename("[q](Plan.md?x=1) [s](#top)").text,
    "[q](Roadmap.md?x=1) [s](#top)",
  );
  // Line and column anchors.
  assert.equal(rename("[l](Plan.md#L40C5)").text, "[l](Roadmap.md#L40C5)");
});

test("relative paths from other folders, up and down", () => {
  const moves = [["C:/kb/notes/Plan.md", "C:/kb/archive/2024/Plan.md"]];
  assert.equal(
    rewriteLinks("[p](../notes/Plan.md)", {
      file: "C:/kb/other/A.md",
      moves,
    }).text,
    "[p](../archive/2024/Plan.md)",
  );
  assert.equal(
    rewriteLinks("[p](notes/Plan.md)", { file: "C:/kb/Top.md", moves }).text,
    "[p](archive/2024/Plan.md)",
  );
  assert.equal(
    rewriteLinks("[p](../../notes/Plan.md)", {
      file: "C:/kb/archive/2024/Sibling.md",
      moves,
    }).text,
    "[p](Plan.md)",
  );
});

test("percent-encoding follows how the link was written", () => {
  const moves = [["C:/kb/My Plan.md", "C:/kb/Our plan (v2).md"]];
  const at = { file: "C:/kb/A.md", moves };
  assert.equal(
    rewriteLinks("[p](My%20Plan.md)", at).text,
    "[p](Our%20plan%20%28v2%29.md)",
  );
  // In angle brackets: plain spaces stay plain.
  assert.equal(
    rewriteLinks("[p](<My Plan.md>)", at).text,
    "[p](<Our plan (v2).md>)",
  );
  assert.equal(
    rewriteLinks("[p](<My%20Plan.md>)", at).text,
    "[p](<Our%20plan%20(v2).md>)",
  );
  // A literal % in a name is encoded, so the link still decodes.
  assert.equal(
    rewriteLinks("[p](My%20Plan.md)", {
      file: "C:/kb/A.md",
      moves: [["C:/kb/My Plan.md", "C:/kb/50% #1.md"]],
    }).text,
    "[p](50%25%20%231.md)",
  );
});

test("CJK names: plain stays plain, encoded stays encoded", () => {
  const moves = [["C:/kb/笔记/计划.md", "C:/kb/归档/计划 一.md"]];
  assert.equal(
    rewriteLinks("[计划](笔记/计划.md)", { file: "C:/kb/首页.md", moves }).text,
    "[计划](归档/计划%20一.md)",
  );
  assert.equal(
    rewriteLinks("[计划](%E7%AC%94%E8%AE%B0/%E8%AE%A1%E5%88%92.md)", {
      file: "C:/kb/首页.md",
      moves,
    }).text,
    "[计划](%E5%BD%92%E6%A1%A3/%E8%AE%A1%E5%88%92%20%E4%B8%80.md)",
  );
});

test("reference definitions, images and HTML tags", () => {
  const text = [
    "Read [the plan][p] and ![chart](Plan.md).",
    "",
    '[p]: Plan.md#top "The plan"',
    "   [q]: <Plan.md>",
    "[^n]: Plan.md is a footnote, not a link.",
    '<a href="Plan.md">x</a> <img src=\'Plan.md\' alt="">',
  ].join("\n");
  assert.equal(
    rename(text).text,
    [
      "Read [the plan][p] and ![chart](Roadmap.md).",
      "",
      '[p]: Roadmap.md#top "The plan"',
      "   [q]: <Roadmap.md>",
      "[^n]: Plan.md is a footnote, not a link.",
      '<a href="Roadmap.md">x</a> <img src=\'Roadmap.md\' alt="">',
    ].join("\n"),
  );
});

test("links in code blocks, code spans and comments are left alone", () => {
  const text = [
    "Use `[x](Plan.md)` in text.",
    "",
    "```md",
    "[x](Plan.md)",
    "```",
    "",
    "~~~",
    "[x](Plan.md)",
    "~~~",
    "<!-- [x](Plan.md) -->",
    "Real: [x](Plan.md)",
  ].join("\n");
  const out = rename(text);
  assert.equal(out.count, 1);
  assert.equal(
    out.text,
    text.replace("Real: [x](Plan.md)", "Real: [x](Roadmap.md)"),
  );
});

test("letter case: Windows paths match whatever the case", () => {
  assert.equal(rename("[p](plan.MD)").text, "[p](Roadmap.md)");
  // A change of case only is a rename too.
  assert.equal(
    rewriteLinks("[p](plan.md)", {
      file: "C:/kb/notes/A.md",
      moves: [["c:\\KB\\notes\\plan.md", "C:\\kb\\notes\\Plan.md"]],
    }).text,
    "[p](Plan.md)",
  );
  // Backslashes and drive letters of either case.
  assert.equal(
    rewriteLinks("[p](../Notes/Plan.md)", {
      file: "c:\\kb\\other\\A.md",
      moves: [["C:/KB/notes", "C:/KB/Journal"]],
    }).text,
    "[p](../Journal/Plan.md)",
  );
});

test("a renamed folder: links into it and to it follow", () => {
  const moves = [["C:/kb/Topics", "C:/kb/Subjects"]];
  const at = { file: "C:/kb/Home.md", moves };
  assert.equal(
    rewriteLinks(
      "[a](Topics/a.md) [i](Topics/_目录.md) [f](Topics/) [x](Topicsx/a.md) ![](Topics/assets/p.png)",
      at,
    ).text,
    "[a](Subjects/a.md) [i](Subjects/_目录.md) [f](Subjects/) [x](Topicsx/a.md) ![](Subjects/assets/p.png)",
  );
});

test("a moved note's own links are written for its new folder", () => {
  const text = [
    "![img](assets/a.png) [sib](Sibling.md#h) [up](../Top.md)",
    "[web](https://example.com) [abs](C:/x.md) [root](/x.md) [self](#s) [me](Plan.md#s)",
    "[ref]: ./assets/b.png",
  ].join("\n");
  const out = rewriteLinks(text, {
    from: "C:/kb/notes/Plan.md",
    file: "C:/kb/archive/Plan.md",
    moves: [["C:/kb/notes/Plan.md", "C:/kb/archive/Plan.md"]],
  });
  assert.equal(
    out.text,
    [
      "![img](../notes/assets/a.png) [sib](../notes/Sibling.md#h) [up](../Top.md)",
      "[web](https://example.com) [abs](C:/x.md) [root](/x.md) [self](#s) [me](Plan.md#s)",
      "[ref]: ../notes/assets/b.png",
    ].join("\n"),
  );
  assert.equal(out.count, 3);
  // Moved together with what it links to: nothing changes.
  assert.equal(
    rewriteLinks("[sib](Sibling.md) ![](assets/a.png)", {
      from: "C:/kb/notes/Plan.md",
      file: "C:/kb/archive/Plan.md",
      moves: [
        ["C:/kb/notes/Plan.md", "C:/kb/archive/Plan.md"],
        ["C:/kb/notes/Sibling.md", "C:/kb/archive/Sibling.md"],
        ["C:/kb/notes/assets", "C:/kb/archive/assets"],
      ],
    }).count,
    0,
  );
});

test("odd links: nested images, parentheses, titles over lines, bad encoding", () => {
  assert.equal(
    rename("[![badge](Plan.md)](Plan.md)").text,
    "[![badge](Roadmap.md)](Roadmap.md)",
  );
  assert.equal(
    rewriteLinks("[p](a(1).md)", {
      file: "C:/kb/A.md",
      moves: [["C:/kb/a(1).md", "C:/kb/b(2).md"]],
    }).text,
    "[p](b%282%29.md)",
  );
  assert.equal(
    rename('[p](Plan.md\n"over a line")').text,
    '[p](Roadmap.md\n"over a line")',
  );
  // Not decodable: left as written.
  assert.equal(rename("[p](Plan%ZZ.md)").count, 0);
  // Escaped brackets are not links; an unclosed link is not either.
  assert.equal(rename("\\[p](Plan.md) [q](Plan.md").count, 0);
  // POSIX and UNC paths.
  assert.equal(
    rewriteLinks("[p](Plan.md)", {
      file: "/home/u/kb/A.md",
      moves: [["/home/u/kb/Plan.md", "/home/u/kb/B.md"]],
    }).text,
    "[p](B.md)",
  );
  assert.equal(
    rewriteLinks("[p](Plan.md)", {
      file: "//srv/share/kb/A.md",
      moves: [["\\\\srv\\share\\kb\\Plan.md", "//srv/share/kb/B.md"]],
    }).text,
    "[p](B.md)",
  );
  // Another drive: cannot be relative, so left as written.
  assert.equal(
    rewriteLinks("[p](Plan.md)", {
      file: "C:/kb/A.md",
      moves: [["C:/kb/Plan.md", "D:/kb/Plan.md"]],
    }).count,
    0,
  );
});

test("destinations and linked paths are found where Markdown has them", () => {
  const text = "[a](x.md) `[b](y.md)` [c]: <z w.md>\n\n[d]: q%20r.md\n";
  assert.deepEqual(
    findDestinations(text).map((d) => [text.slice(d.from, d.to), d.kind]),
    [
      ["x.md", "inline"],
      ["q%20r.md", "reference"],
    ],
  );
  assert.deepEqual(linkedPaths(text, "C:/kb/n/A.md"), [
    "C:/kb/n/x.md",
    "C:/kb/n/q r.md",
  ]);
  assert.equal(isUnder("C:/KB/a/b.md", "c:\\kb\\a"), true);
  assert.equal(isUnder("C:/kb/ab.md", "C:/kb/a"), false);
});

test("a path after moves keeps the new path's separators", () => {
  const moves = [["C:\\kb\\Topics", "C:\\kb\\Subjects"]];
  assert.equal(
    movedPathOf("c:\\KB\\topics\\a\\b.md", moves),
    "C:\\kb\\Subjects\\a\\b.md",
  );
  assert.equal(movedPathOf("C:\\kb\\Topics", moves), "C:\\kb\\Subjects");
  assert.equal(
    movedPathOf("C:\\kb\\Topicsx\\a.md", moves),
    "C:\\kb\\Topicsx\\a.md",
  );
  assert.equal(
    movedPathOf("/home/u/kb/a.md", [["/home/u/kb/a.md", "/home/u/kb/b.md"]]),
    "/home/u/kb/b.md",
  );
});

// Review finding 5: code in quotes and lists, indented code, code spans
// over lines, escapes, definitions over lines, ">" in HTML attributes.
test("code in block quotes, list items and indented blocks is left alone", () => {
  const quoted = "> ```\n> [x](Plan.md)\n> ```\n> [y](Plan.md)\n";
  assert.equal(
    rename(quoted).text,
    "> ```\n> [x](Plan.md)\n> ```\n> [y](Roadmap.md)\n",
  );
  const listed = "- item\n\n    ```\n    [x](Plan.md)\n    ```\n";
  assert.equal(rename(listed).count, 0);
  // An indented code block after a paragraph: code; a list item's own
  // indented paragraph: text.
  assert.equal(rename("Text.\n\n    [x](Plan.md)\n").count, 0);
  assert.equal(
    rename("- a\n\n    [x](Plan.md)\n").text,
    "- a\n\n    [x](Roadmap.md)\n",
  );
  // A code span over two lines of one paragraph.
  assert.equal(rename("`a\n[x](Plan.md)` b\n").count, 0);
});

test("a stray backtick is read as Markdown reads it", () => {
  const text = "x`y `[z](Plan.md)`\n";
  const html = new MarkdownIt().render(text);
  assert.equal(rename(text).count, html.includes('href="Plan.md"') ? 1 : 0);
});

test("escapes, definitions over two lines and '>' inside HTML attributes", () => {
  assert.equal(
    rewriteLinks("[p](a\\(1\\).md)", {
      file: "C:/kb/A.md",
      moves: [["C:/kb/a(1).md", "C:/kb/b.md"]],
    }).text,
    "[p](b.md)",
  );
  assert.equal(
    rename("[p]:\n  Plan.md 'T'\n").text,
    "[p]:\n  Roadmap.md 'T'\n",
  );
  assert.equal(
    rename('<img alt="a > b" src="Plan.md">').text,
    '<img alt="a > b" src="Roadmap.md">',
  );
});

test("links to a missing note are taken away, keeping their text", () => {
  const text =
    "See [the plan](Plan.md#goals), ![chart](Plan.md) and [other](Other.md).\n`[x](Plan.md)`\n[r]: Plan.md\n";
  const out = unlinkTarget(text, {
    file: "C:/kb/notes/A.md",
    target: "c:\\KB\\notes\\plan.md",
  });
  assert.equal(
    out.text,
    "See the plan,  and [other](Other.md).\n`[x](Plan.md)`\n[r]: Plan.md\n",
  );
  assert.equal(out.count, 2);
  assert.equal(
    linkTarget("../Topics/a%20b.md#x", "C:/kb/notes/A.md"),
    "C:/kb/Topics/a b.md",
  );
  assert.equal(linkTarget("https://example.com", "C:/kb/A.md"), null);
  assert.equal(linkTarget("#top", "C:/kb/A.md"), null);
});
