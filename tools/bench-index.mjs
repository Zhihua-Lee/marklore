// Times the library index on a synthetic library: full indexing, one note
// changed, backlinks and full-text searches, with a breakdown of where full
// indexing spends its time (disk, parsing, lower-casing).
//   node tools/bench-index.mjs <folder> [notes=5000]
// The folder is (re)written with tools/synthetic-library.mjs unless it holds
// the notes already. MARKLORE_INDEX=js forces the JavaScript index.
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createLinkIndex, parseNote } from "../desktop/link-index.mjs";
import { searchNotes } from "../desktop/note-search.mjs";
import { writeLibrary, notePath } from "./synthetic-library.mjs";
import { NOTE } from "../desktop/scan-rules.mjs";

const [rootArg, totalArg = "5000"] = process.argv.slice(2);
if (!rootArg) throw Error("usage: bench-index.mjs <folder> [notes]");
const root = path.resolve(rootArg),
  total = Number(totalArg);
try {
  await fs.access(notePath(root, total - 1));
} catch {
  await writeLibrary(root, total);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function time(label, runs, fn) {
  const ms = [];
  let result;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = await fn();
    ms.push(performance.now() - t0);
  }
  console.log(`${label.padEnd(36)} ${median(ms).toFixed(1).padStart(8)} ms`);
  return result;
}

async function listNotes(dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listNotes(full, out);
    else if (NOTE.test(e.name)) out.push(full);
  }
  return out;
}

const { createIndex, kind } = await import("../desktop/native-index.mjs").then(
  (m) => ({ createIndex: m.createIndex, kind: m.indexKind() }),
  () => ({ createIndex: createLinkIndex, kind: "js" }),
);
console.log(
  `index: ${kind}, ${total} notes, ${process.platform}-${process.arch}`,
);

// Where full indexing spends its time, measured piece by piece (JavaScript).
const files = await time("breakdown: walk", 3, () => listNotes(root));
const texts = await time("breakdown: stat+read (sequential)", 3, async () => {
  const out = [];
  for (const f of files) {
    await fs.stat(f);
    out.push((await fs.readFile(f, "utf8")).replace(/^﻿/, ""));
  }
  return out;
});
await time("breakdown: read (parallel)", 3, () =>
  Promise.all(files.map((f) => fs.readFile(f, "utf8"))),
);
await time("breakdown: parseNote (JS)", 3, () =>
  texts.map((t, i) => parseNote(t, files[i])),
);
await time("breakdown: toLowerCase", 3, () =>
  texts.map((t) => t.toLowerCase()),
);
console.log(
  `library: ${files.length} notes, ${(texts.reduce((n, t) => n + t.length, 0) / 1e6).toFixed(1)} M chars`,
);

let index;
await time("full index (follow)", 3, async () => {
  index = createIndex();
  await index.follow([root]);
});
const one = notePath(root, 1234);
const original = await fs.readFile(one, "utf8");
await time("one note changed", 10, async () => {
  await fs.writeFile(one, original + "\nedited [x](../area-0/note-0000.md)\n");
  await index.changed(one);
});
await fs.writeFile(one, original);
await index.changed(one);
const popular = notePath(root, 0);
const back = await time("backlinks (popular note)", 10, () =>
  index.backlinks(popular),
);
await time("backlinks (ordinary note)", 10, () =>
  index.backlinks(notePath(root, 4321)),
);
console.log(`  popular note has ${back.length} backlinks`);
for (const q of [
  "the",
  "zyzzogeton",
  "收敛",
  '"proof measure"',
  "kernel 矩阵",
]) {
  const r = await time(`search ${q}`, 10, () => index.search(q));
  console.log(`  ${r.total} notes`);
}
// The search function alone, on texts already in memory (JavaScript).
const list = files.map((f, i) => ({
  path: f,
  name: path.basename(f),
  text: texts[i],
  lower: texts[i].toLowerCase(),
}));
await time("searchNotes alone: the", 10, () => searchNotes(list, "the"));
await time("searchNotes alone: 收敛", 10, () => searchNotes(list, "收敛"));
