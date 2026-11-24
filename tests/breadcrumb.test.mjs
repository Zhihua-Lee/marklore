import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildBreadcrumb,
  folderDisplayName,
  matchingRoot,
} from "../desktop/breadcrumb.mjs";
import { FileStore } from "../desktop/files.mjs";

const LIB = "C:/Notes/Calculus";
const roots = [{ id: "r1", name: "微积分", path: LIB, indexName: "_目录.md" }];

function chainFixture() {
  const ch1Index = [
    "# 第一章 实数",
    "",
    "- [引言](Intro.md)",
    "- [第一节 实数系](Section%201.md)",
    "  - [确界定理](Supremum.md)",
    "    - [例题](Example.md)",
    "  - [进阶阅读](Advanced/)",
    "- [第二节 极限](Section%202.md)",
    "",
  ].join("\n");

  const rootFolder = {
    id: "r1",
    name: "微积分",
    path: LIB,
    indexName: "_目录.md",
    indexText: [
      "# 微积分",
      "",
      "- [第一章](Chapter1/_目录.md)",
      "- [前言](Preface.md)",
      "- [第二章](Chapter2/)",
      "",
    ].join("\n"),
    children: [
      {
        name: "Chapter2",
        path: `${LIB}/Chapter2`,
        id: "f-ch2",
        directory: true,
        indexName: null,
      },
      {
        name: "Chapter1",
        path: `${LIB}/Chapter1`,
        id: "f-ch1",
        directory: true,
        indexName: "_目录.md",
      },
      {
        name: "Preface.md",
        path: `${LIB}/Preface.md`,
        directory: false,
        title: "写在前面",
      },
      {
        name: "Unlisted.md",
        path: `${LIB}/Unlisted.md`,
        directory: false,
        title: "未收录说明",
      },
      {
        name: "_目录.md",
        path: `${LIB}/_目录.md`,
        directory: false,
        title: "微积分",
      },
    ],
  };

  const ch1Folder = {
    id: "f-ch1",
    name: "Chapter1",
    path: `${LIB}/Chapter1`,
    indexName: "_目录.md",
    indexText: ch1Index,
    children: [
      {
        name: "Intro.md",
        path: `${LIB}/Chapter1/Intro.md`,
        directory: false,
        title: "导言",
      },
      {
        name: "Section 1.md",
        path: `${LIB}/Chapter1/Section 1.md`,
        directory: false,
        title: "第一节 实数系",
      },
      {
        name: "Supremum.md",
        path: `${LIB}/Chapter1/Supremum.md`,
        directory: false,
        title: "确界原理",
      },
      {
        name: "Example.md",
        path: `${LIB}/Chapter1/Example.md`,
        directory: false,
        title: "典型例题",
      },
      {
        name: "Advanced",
        path: `${LIB}/Chapter1/Advanced`,
        id: "f-adv",
        directory: true,
        indexName: "SUMMARY.md",
      },
      {
        name: "Section 2.md",
        path: `${LIB}/Chapter1/Section 2.md`,
        directory: false,
        title: "第二节 极限",
      },
      {
        name: "_目录.md",
        path: `${LIB}/Chapter1/_目录.md`,
        directory: false,
        title: "第一章 实数",
      },
    ],
  };

  return { rootFolder, ch1Folder };
}

test("returns null outside library roots", () => {
  const { rootFolder } = chainFixture();
  assert.equal(matchingRoot(roots, "D:/Other/Note.md"), null);
  assert.equal(
    buildBreadcrumb({
      kind: "note",
      targetPath: "D:/Other/Note.md",
      roots,
      chain: [rootFolder],
    }),
    null,
  );
});

test("builds nested parent-page breadcrumb and per-level siblings for a note", () => {
  const { rootFolder, ch1Folder } = chainFixture();
  const crumb = buildBreadcrumb({
    kind: "note",
    targetPath: `${LIB}/Chapter1/Example.md`,
    roots,
    chain: [rootFolder, ch1Folder],
  });
  assert.ok(crumb);
  assert.deepEqual(
    crumb.segments.map((s) => ({
      kind: s.kind,
      name: s.name,
      clickable: s.clickable,
      current: s.current,
    })),
    [
      { kind: "root", name: "微积分", clickable: true, current: false },
      { kind: "folder", name: "第一章", clickable: true, current: false },
      { kind: "note", name: "第一节 实数系", clickable: true, current: false },
      { kind: "note", name: "确界原理", clickable: true, current: false },
      { kind: "note", name: "典型例题", clickable: false, current: true },
    ],
  );

  // Single root has no siblings; Chapter1 lists root's index order then unlisted.
  assert.equal(crumb.segments[0].siblings.length, 0);
  assert.deepEqual(
    crumb.segments[1].siblings.map((s) => `${s.kind}:${s.name}:${s.current}`),
    [
      "folder:第一章:true",
      "note:写在前面:false",
      "folder:第二章:false",
      "note:未收录说明:false",
    ],
  );

  // Parent page `第一节 实数系` has top-level siblings of Chapter1 in index order.
  assert.deepEqual(
    crumb.segments[2].siblings.map((s) => s.name),
    ["导言", "第一节 实数系", "第二节 极限"],
  );

  // Parent page `确界原理` has siblings nested directly under `第一节 实数系`.
  assert.deepEqual(
    crumb.segments[3].siblings.map((s) => `${s.kind}:${s.name}`),
    ["note:确界原理", "folder:进阶阅读"],
  );

  // Leaf note `典型例题` has only itself at its level (only 1 sibling -> hidden chevron in UI).
  assert.deepEqual(
    crumb.segments[4].siblings.map((s) => s.name),
    ["典型例题"],
  );
});

test("builds index view breadcrumb up to current folder without note segment", () => {
  const { rootFolder, ch1Folder } = chainFixture();
  const crumb = buildBreadcrumb({
    kind: "index",
    targetPath: `${LIB}/Chapter1/_目录.md`,
    roots,
    chain: [rootFolder, ch1Folder],
  });
  assert.deepEqual(
    crumb.segments.map((s) => ({
      kind: s.kind,
      name: s.name,
      clickable: s.clickable,
      current: s.current,
    })),
    [
      { kind: "root", name: "微积分", clickable: true, current: false },
      { kind: "folder", name: "第一章", clickable: false, current: true },
    ],
  );
  assert.deepEqual(
    crumb.segments[1].siblings.map((s) => s.name),
    ["第一章", "写在前面", "第二章", "未收录说明"],
  );
});

test("falls back to tree order when folder has no index file", () => {
  const plainFolder = {
    id: "r1",
    name: "PlainLib",
    path: "C:\\Notes\\Plain",
    indexName: null,
    indexText: null,
    children: [
      {
        name: "b.md",
        path: "C:\\Notes\\Plain\\b.md",
        directory: false,
        title: "Second",
      },
      {
        name: "Sub",
        path: "C:\\Notes\\Plain\\Sub",
        id: "sub",
        directory: true,
        indexName: null,
      },
      {
        name: "a.md",
        path: "C:\\Notes\\Plain\\a.md",
        directory: false,
        title: "First",
      },
    ],
  };
  const crumb = buildBreadcrumb({
    kind: "note",
    targetPath: "c:/notes/plain/b.md",
    roots: [
      { id: "r1", name: "PlainLib", path: "C:\\Notes\\Plain" },
      { id: "r2", name: "OtherLib", path: "C:\\Notes\\Other" },
    ],
    chain: [plainFolder],
  });
  assert.ok(crumb);
  assert.equal(crumb.segments.length, 2);
  // Multiple roots expose root siblings.
  assert.deepEqual(
    crumb.segments[0].siblings.map((s) => `${s.name}:${s.current}`),
    ["PlainLib:true", "OtherLib:false"],
  );
  // Folders first, then notes in zh-CN numeric order.
  assert.deepEqual(
    crumb.segments[1].siblings.map((s) => `${s.kind}:${s.name}:${s.current}`),
    ["folder:Sub:false", "note:First:false", "note:Second:true"],
  );
});

test("deepest matching root wins when roots overlap", () => {
  const outer = { id: "r1", name: "All", path: "C:/Vault" };
  const inner = { id: "r2", name: "Sub", path: "C:/Vault/Sub" };
  const matched = matchingRoot([outer, inner], "C:/Vault/Sub/note.md");
  assert.equal(matched.id, "r2");
});

test("folderDisplayName resolves parent entry text, own index heading, then folder name", () => {
  assert.equal(
    folderDisplayName({
      folderName: "Part1",
      parentEntryText: "第一部分 \\[基础\\]",
      indexText: "# Part One\n",
    }),
    "第一部分 [基础]",
  );
  assert.equal(
    folderDisplayName({
      folderName: "Part1",
      parentEntryText: null,
      indexText: "# 第一部分\n\n- [A](A.md)\n",
    }),
    "第一部分",
  );
  assert.equal(
    folderDisplayName({
      folderName: "Plain",
      parentEntryText: "",
      indexText: "## Not Level One\n",
    }),
    "Plain",
  );
});

test("FileStore resolves folderIndexText, previewChild and live disk breadcrumbs", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-crumb-"));
  try {
    const lib = path.join(tmp, "Lib");
    const part = path.join(lib, "Part1");
    const unlistedHead = path.join(lib, "Extra");
    const unlistedPlain = path.join(lib, "PlainSub");
    const outside = path.join(tmp, "Outside");
    await fs.mkdir(part, { recursive: true });
    await fs.mkdir(unlistedHead, { recursive: true });
    await fs.mkdir(unlistedPlain, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(
      path.join(lib, "_目录.md"),
      "# Library\n\n- [First Part](Part1/_目录.md)\n- [Intro](Intro.md)\n",
    );
    await fs.writeFile(
      path.join(lib, "Intro.md"),
      "# Library Intro\n\nHello.\n",
    );
    await fs.writeFile(
      path.join(part, "_目录.md"),
      "# Part One\n\n- [Chapter A](A.md)\n  - [Detail](Detail.md)\n- [Chapter B](B.md)\n",
    );
    await fs.writeFile(path.join(part, "A.md"), "# Alpha Title\n\nBody.\n");
    await fs.writeFile(
      path.join(part, "Detail.md"),
      "# Deep Detail\n\nBody.\n",
    );
    await fs.writeFile(path.join(part, "B.md"), "# Beta Title\n\nBody.\n");
    await fs.writeFile(
      path.join(unlistedHead, "_目录.md"),
      "# Unlisted Heading\n\n- [One](One.md)\n",
    );
    await fs.writeFile(path.join(outside, "Free.md"), "# Outside\n\nBody.\n");

    const store = new FileStore();
    const rootDir = await store.directory(lib);
    const partDir = await store.directory(part);
    store.roots = [rootDir.path];

    const rootInfo = await store.folderIndexText(rootDir.id);
    assert.equal(rootInfo.folder.title, "Library");
    assert.equal(rootInfo.index.name, "_目录.md");
    assert.match(rootInfo.text, /First Part/);
    assert.equal(
      rootInfo.items.find((i) => i.name === "Extra")?.title,
      "Unlisted Heading",
    );
    assert.equal(
      rootInfo.items.find((i) => i.name === "Part1")?.title,
      "First Part",
    );

    const previewed = await store.previewChild(partDir.id, "Detail.md");
    assert.match(previewed.text, /# Deep Detail/);
    await assert.rejects(() => store.previewChild(partDir.id, "../Intro.md"));

    const openedDetail = await store.open(path.join(part, "Detail.md"));
    const noteCrumb = await store.breadcrumb({ fileId: openedDetail.id });
    assert.deepEqual(
      noteCrumb.segments.map((s) => `${s.kind}:${s.name}:${s.clickable}`),
      [
        "root:Library:true",
        "folder:First Part:true",
        "note:Alpha Title:true",
        "note:Deep Detail:false",
      ],
    );
    assert.deepEqual(
      noteCrumb.segments[1].siblings.map((s) => `${s.kind}:${s.name}`),
      [
        "folder:First Part",
        "note:Library Intro",
        "folder:Unlisted Heading",
        "folder:PlainSub",
      ],
    );
    assert.deepEqual(
      noteCrumb.segments[2].siblings.map((s) => s.name),
      ["Alpha Title", "Beta Title"],
    );

    const folderCrumb = await store.breadcrumb({ folderId: partDir.id });
    assert.deepEqual(
      folderCrumb.segments.map((s) => `${s.kind}:${s.name}:${s.current}`),
      ["root:Library:false", "folder:First Part:true"],
    );

    const unlistedCrumb = await store.breadcrumb({
      folderId: (await store.directory(unlistedHead)).id,
    });
    assert.deepEqual(
      unlistedCrumb.segments.map((s) => `${s.kind}:${s.name}:${s.current}`),
      ["root:Library:false", "folder:Unlisted Heading:true"],
    );

    const openedOut = await store.open(path.join(outside, "Free.md"));
    assert.equal(await store.breadcrumb({ fileId: openedOut.id }), null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
