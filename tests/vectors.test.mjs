// Checks the language-neutral test vectors (tests/vectors, format in its
// README) against the JavaScript implementation. The data never names a
// function: each file's path is its rule, and the adapters below turn a
// case's input into a call and the result into the vector's terms (lines
// and columns counted from 1, columns in Unicode code points).
//
// VECTORS_FILL=1 writes the current result into cases that have no
// "expected" yet (new cases), leaving every other case as it is. Read what
// it wrote before keeping it: it records what the code does, right or not.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  leadingHeading,
  plainTitle,
  headingText,
  safeBase,
  safeFileName,
  numberedName,
  fileMatches,
  headingAnchor,
  frontTitle,
  setNoteName,
  baseName,
  NOTE_EXTENSION,
} from "../desktop/note-names.mjs";
import { headingSlug, createSlugger } from "../desktop/slug.mjs";
import {
  findIndexName,
  childName,
  parseIndex,
  indexOrder,
  applyIndexOp,
  hrefFor,
  titleFor,
  newIndexText,
  subtreeOf,
  checkableEntries,
  removeEntriesTo,
} from "../desktop/folder-index.mjs";
import {
  rewriteLinks,
  findDestinations,
  movedPathOf,
  linkedPaths,
  linkTarget,
  unlinkTarget,
  pathKey,
  isUnder,
} from "../desktop/link-rewrite.mjs";
import {
  locateEdits,
  applyChanges,
  changedRanges,
  words,
  revisions,
  diffSequence,
  unifiedDiff,
  sourceHunks,
} from "../desktop/proposal-edits.mjs";
import { anchorOf, locateAnchor } from "../desktop/comment-anchors.mjs";
import { createAiStore, isLapsed, renamedNote } from "../desktop/ai-store.mjs";
import { createAiBridge } from "../desktop/ai-bridge.mjs";
import { createServer } from "../desktop/mcp-server.mjs";
import {
  normalizeSettings,
  normalizeDesktopPreferences,
} from "../desktop/settings-schema.mjs";
import { FileStore } from "../desktop/files.mjs";

const ROOT = fileURLToPath(new URL("./vectors/", import.meta.url));
const SCHEMAS = path.join(ROOT, "ai-store", "schemas");
const FILL = process.env.VECTORS_FILL === "1";

// ── Positions: { line, column } from 1, columns in code points ──
// Lines end at "\n"; a "\r" before it is the last column of its line.
function positionOf(text, offset) {
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length, column: [...lines.at(-1)].length + 1 };
}
function offsetOf(text, { line, column }) {
  const lines = text.split("\n");
  if (!(line >= 1 && line <= lines.length)) throw Error(`No line ${line}`);
  let offset = 0;
  for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
  const points = [...lines[line - 1]];
  if (!(column >= 1 && column <= points.length + 1))
    throw Error(`No column ${column} on line ${line}`);
  return offset + points.slice(0, column - 1).join("").length;
}

// An index entry named by its line (from 1) or by its child's name.
const lineRef = (ref) =>
  ref && typeof ref === "object" && Number.isInteger(ref.line)
    ? { line: ref.line - 1 }
    : ref;

// Edits located (they must be), applied, for the rules that show them.
function located(text, edits) {
  const found = locateEdits(text, edits);
  if (found.error) throw Error(`Edits not located: ${found.error.reason}`);
  return { changes: found.changes, after: applyChanges(text, found.changes) };
}
// A change's two sides in vector terms.
const sides = (before, after, r) => ({
  oldAt: positionOf(before, r.oldFrom),
  removed: before.slice(r.oldFrom, r.oldTo),
  at: positionOf(after, r.from),
  added: after.slice(r.from, r.to),
});

async function tempFolder(prefix) {
  return fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
}

const rules = {
  // ── note-names ──
  "note-names/leading-heading": ({ text }) => {
    const found = leadingHeading(text);
    return (
      found && {
        raw: found.raw,
        title: found.title,
        line: found.line + 1,
        setext: found.setext,
      }
    );
  },
  "note-names/plain-title": ({ markdown }) => plainTitle(markdown),
  "note-names/heading-text": ({ name }) => headingText(name),
  "note-names/safe-base": ({ name, max = 120 }) => safeBase(name, max),
  "note-names/safe-file-name": ({ name, ext = ".md", max = 120 }) =>
    safeFileName(name, ext, max),
  "note-names/numbered-name": ({ name, n }) => numberedName(name, n),
  "note-names/file-matches": ({ title, file }) => fileMatches(title, file),
  "note-names/heading-anchor": ({ markdown }) => headingAnchor(markdown),
  "note-names/note-file": ({ name }) => ({
    note: NOTE_EXTENSION.test(name),
    base: baseName(name),
  }),
  "note-names/front-title": ({ text }) => {
    const found = frontTitle(text);
    return (
      found && { line: found.line + 1, end: found.end + 1, value: found.value }
    );
  },
  "note-names/set-name": ({ text, heading = null, title = null, insert }) =>
    setNoteName(text, { heading, title, insert: insert === true }),
  "note-names/unify-plan": async ({ files, deep = false, only = null }) => {
    const dir = await tempFolder("marklore-vectors-");
    const kb = path.join(dir, "kb");
    try {
      await fsp.mkdir(kb);
      for (const [name, text] of Object.entries(files)) {
        const file = path.join(kb, ...name.split("/"));
        if (name.endsWith("/")) await fsp.mkdir(file, { recursive: true });
        else {
          await fsp.mkdir(path.dirname(file), { recursive: true });
          await fsp.writeFile(file, text);
        }
      }
      const store = new FileStore({ backups: path.join(dir, "backups") });
      store.roots = [kb];
      const root = await store.directory(kb);
      const plan = await store.unifyPlan(root.id, { deep, only });
      return plan.notes.map((note) => ({
        note: path.relative(kb, note.path).split(path.sep).join("/"),
        title: note.title,
        to: note.to,
        heading: note.heading,
        entry: note.entry,
        front: note.front,
      }));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },

  // ── slug ──
  "slug/heading-slug": ({ text }) => headingSlug(text),
  "slug/sequence": ({ headings }) => headings.map(createSlugger()),

  // ── folder-index ──
  "folder-index/index-file": ({ names }) => findIndexName(names),
  "folder-index/child-name": ({ href }) => childName(href),
  "folder-index/parse": ({ text }) => {
    const parsed = parseIndex(text);
    return {
      bom: Boolean(parsed.bom),
      eol: parsed.eol,
      entries: parsed.entries.map((entry) => ({
        line: entry.line + 1,
        indent: entry.indent,
        content: entry.content,
        marker: entry.marker,
        text: entry.text,
        href: entry.href,
        parent: entry.parent < 0 ? null : entry.parent,
      })),
    };
  },
  "folder-index/order": ({ text, children }) =>
    indexOrder(
      text,
      (name) =>
        children.find((c) => c.toLowerCase() === name.toLowerCase()) ?? null,
    ),
  "folder-index/operations": ({ text, op }) =>
    applyIndexOp(text, {
      ...op,
      ...(op.ref !== undefined ? { ref: lineRef(op.ref) } : {}),
      ...(op.target !== undefined ? { target: lineRef(op.target) } : {}),
      ...(op.under !== undefined ? { under: lineRef(op.under) } : {}),
      ...(op.after !== undefined ? { after: lineRef(op.after) } : {}),
    }),
  "folder-index/href": ({ name, folder = false }) => hrefFor(name, folder),
  "folder-index/entry-title": ({ name }) => titleFor(name),
  "folder-index/new-index": ({ title, children, eol = "\n" }) =>
    newIndexText(title, children, eol),
  "folder-index/subtree": ({ text, ref }) => subtreeOf(text, lineRef(ref)),
  "folder-index/checkable-entries": ({ text, file }) =>
    checkableEntries(text, file).map(({ entry, name, target }) => ({
      line: entry.line + 1,
      name,
      target,
    })),
  "folder-index/remove-entries-to": ({ text, file, target }) =>
    removeEntriesTo(text, file, target),

  // ── link-rewrite ──
  "link-rewrite/rewrite": ({ text, file, from, moves = [], anchors = [] }) => {
    const out = rewriteLinks(text, {
      file,
      moves,
      anchors,
      ...(from !== undefined ? { from } : {}),
    });
    return { text: out.text, count: out.count };
  },
  "link-rewrite/destinations": ({ text }) =>
    findDestinations(text).map((d) => ({
      text: text.slice(d.from, d.to),
      kind: d.kind,
      at: positionOf(text, d.from),
      ...(d.link
        ? { link: text.slice(d.link.from, d.link.to), image: d.link.image }
        : {}),
    })),
  "link-rewrite/moved-path": ({ path: p, moves }) => movedPathOf(p, moves),
  "link-rewrite/linked-paths": ({ text, file }) => linkedPaths(text, file),
  "link-rewrite/link-target": ({ href, file }) => linkTarget(href, file),
  "link-rewrite/unlink": ({ text, file, target }) => {
    const out = unlinkTarget(text, { file, target });
    return { text: out.text, count: out.count };
  },
  "link-rewrite/path-key": ({ path: p }) => pathKey(p),
  "link-rewrite/is-under": ({ path: p, folder }) => isUnder(p, folder),

  // ── proposal-edits ──
  "proposal-edits/locate": ({ text, edits }) => {
    const found = locateEdits(text, edits);
    if (found.error) return { error: found.error };
    return {
      changes: found.changes.map((c) => ({
        at: positionOf(text, c.from),
        old: text.slice(c.from, c.to),
        insert: c.insert,
      })),
      order: found.order,
      result: applyChanges(text, found.changes),
    };
  },
  "proposal-edits/changed-ranges": ({ text, edits }) => {
    const { changes, after } = located(text, edits);
    let shift = 0;
    return changedRanges(text, changes).map((range, i) => {
      const change = changes[i];
      const head = range.from - (change.from + shift);
      shift += change.insert.length - (change.to - change.from);
      return sides(text, after, {
        oldFrom: change.from + head,
        oldTo: change.from + head + range.removed,
        from: range.from,
        to: range.to,
      });
    });
  },
  "proposal-edits/words": ({ text }) => words(text),
  "proposal-edits/revisions": ({ text, edits }) => {
    const { changes, after } = located(text, edits);
    return revisions(text, changes).map((r) => ({
      ...sides(text, after, r),
      pieces: r.pieces.map((p) => sides(text, after, p)),
    }));
  },
  "proposal-edits/diff-sequence": ({ a, b }) => diffSequence(a, b),
  "proposal-edits/unified-diff": ({ before, after, name }) =>
    name === undefined
      ? unifiedDiff(before, after)
      : unifiedDiff(before, after, name),
  "proposal-edits/source-hunks": ({ text, edits }) => {
    const { changes, after } = located(text, edits);
    return sourceHunks(text, after, revisions(text, changes)).hunks.map(
      (h) => ({
        changes: h.changes,
        old: [h.o1 + 1, h.o2 + 1],
        new: [h.n1 + 1, h.n2 + 1],
        rows: h.rows.map((r) => [r.kind, r.line, r.old, r.new]),
      }),
    );
  },

  // ── comment-anchors ──
  "comment-anchors/anchor-of": ({ text, from, to }) =>
    anchorOf(text, offsetOf(text, from), offsetOf(text, to)),
  "comment-anchors/locate": ({ text, anchor }) => {
    const found = locateAnchor(text, anchor);
    return (
      found && {
        from: positionOf(text, found.from),
        to: positionOf(text, found.to),
      }
    );
  },

  // ── ai-store ──
  "ai-store/examples": ({ schema, value }) =>
    validate(readSchema(schema), value).length === 0,
  "ai-store/lapse": ({ proposal, now }) => isLapsed(proposal, Date.parse(now)),
  "ai-store/renamed-note": ({ note, file, next }) =>
    renamedNote(note, file, next),
  "ai-store/marks-file": async ({ file }) => {
    const dir = await tempFolder("marklore-vectors-");
    try {
      const store = createAiStore(path.join(dir, "ai"));
      await store.changeMarks(file, () => {});
      return fs.readdirSync(store.marks).filter((n) => n.endsWith(".json"));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },

  // ── settings ──
  "settings/normalize": ({ stored }) => normalizeSettings(stored),
  "settings/desktop-preferences": ({ stored }) =>
    normalizeDesktopPreferences(stored),
};

// ── A small JSON Schema (2020-12) checker: the keywords the schemas in
// ai-store/schemas use (a schema with any other keyword is refused, so a
// new one is added here first). Returns the problems found ([] when
// valid). The schemas also compile under Ajv's 2020-12 strict mode. ──
const schemaCache = new Map();
function readSchema(name) {
  if (!schemaCache.has(name))
    schemaCache.set(
      name,
      JSON.parse(
        fs.readFileSync(path.join(SCHEMAS, `${name}.schema.json`), "utf8"),
      ),
    );
  return schemaCache.get(name);
}
const KNOWN = new Set([
  "$schema",
  "$id",
  "$defs",
  "$ref",
  "$comment",
  "title",
  "description",
  "examples",
  "type",
  "enum",
  "const",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
]);
const typeOf = (value) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : Number.isInteger(value)
        ? "integer"
        : typeof value;
// "format" is an annotation, as draft 2020-12 has it by default: the
// schemas give a pattern where the form matters.
function validate(schema, value, root = schema, at = "") {
  const problems = [];
  const fail = (message) => problems.push(`${at || "/"}: ${message}`);
  for (const key of Object.keys(schema))
    if (!KNOWN.has(key)) throw Error(`Schema keyword not checked: ${key}`);
  if (schema.$ref) {
    const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1];
    if (!name || !root.$defs?.[name]) throw Error(`Bad $ref ${schema.$ref}`);
    problems.push(...validate(root.$defs[name], value, root, at));
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = typeOf(value);
    if (
      !types.includes(actual) &&
      !(actual === "integer" && types.includes("number"))
    )
      return [...problems, `${at || "/"}: not ${types.join(" or ")}`];
  }
  if (schema.enum && !schema.enum.some((v) => Object.is(v, value)))
    fail(`not one of ${JSON.stringify(schema.enum)}`);
  if ("const" in schema && schema.const !== value)
    fail(`not ${JSON.stringify(schema.const)}`);
  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength)
      fail("too short");
    if (schema.maxLength !== undefined && length > schema.maxLength)
      fail("too long");
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
      fail(`does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      fail("too small");
    if (schema.maximum !== undefined && value > schema.maximum)
      fail("too large");
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      fail("too few items");
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      fail("too many items");
    if (
      schema.uniqueItems &&
      new Set(value.map((v) => JSON.stringify(v))).size !== value.length
    )
      fail("items repeat");
    if (schema.items)
      value.forEach((item, i) =>
        problems.push(...validate(schema.items, item, root, `${at}/${i}`)),
      );
  }
  if (typeOf(value) === "object") {
    for (const key of schema.required || [])
      if (!(key in value)) fail(`no ${key}`);
    for (const [key, item] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) problems.push(...validate(sub, item, root, `${at}/${key}`));
      else if (schema.additionalProperties === false) fail(`unknown ${key}`);
      else if (typeof schema.additionalProperties === "object")
        problems.push(
          ...validate(schema.additionalProperties, item, root, `${at}/${key}`),
        );
    }
  }
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validate(s, value, root, at));
    if (!results.some((r) => !r.length)) fail("matches none of anyOf");
  }
  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => validate(s, value, root, at));
    const passing = results.filter((r) => !r.length).length;
    if (passing !== 1)
      fail(`matches ${passing} of oneOf (${results.flat().join("; ")})`);
  }
  return problems;
}

// ── Loading and running ──
function vectorFiles(dir = ROOT) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (full !== SCHEMAS) out.push(...vectorFiles(full));
    } else if (item.name.endsWith(".json")) out.push(full);
  }
  return out.sort();
}
const ruleOf = (file) =>
  path
    .relative(ROOT, file)
    .replace(/\\/g, "/")
    .replace(/\.json$/, "");

const files = vectorFiles();
const filled = new Set();

test("every vector file names a rule the runner knows, and every rule has cases", () => {
  const named = files.map(ruleOf);
  assert.deepEqual(
    named.filter((rule) => !rules[rule]),
    [],
  );
  assert.deepEqual(
    Object.keys(rules).filter((rule) => !named.includes(rule)),
    [],
  );
});

for (const file of files) {
  const rule = ruleOf(file);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  test(`vectors: ${rule}`, async () => {
    // Every string is well-formed Unicode (no lone surrogate), so any
    // language can read the file.
    const strings = (value) =>
      typeof value === "string"
        ? [value]
        : value && typeof value === "object"
          ? Object.values(value).flatMap(strings)
          : [];
    assert.deepEqual(
      strings(data).filter((s) => !s.isWellFormed()),
      [],
      `${rule}: a string with a lone surrogate`,
    );
    const adapter = rules[rule];
    assert.ok(adapter, `no adapter for ${rule}`);
    assert.ok(Array.isArray(data.cases) && data.cases.length, "no cases");
    const names = new Set();
    for (const [i, c] of data.cases.entries()) {
      const label = `${rule} #${i} ${c.name}`;
      assert.equal(typeof c.name, "string", `${rule} #${i}: no name`);
      assert.ok(!names.has(c.name), `${label}: name used twice`);
      names.add(c.name);
      const platform = c.platform ?? data.platform;
      if (platform && platform !== process.platform) continue;
      const actual = await adapter(structuredClone(c.input ?? {}));
      if (!("expected" in c)) {
        assert.ok(FILL, `${label}: no expected (VECTORS_FILL=1 adds it)`);
        c.expected = actual === undefined ? null : actual;
        filled.add(file);
        continue;
      }
      assert.deepEqual(actual, c.expected, label);
    }
    if (filled.has(file)) {
      // Each case's keys in the order the README gives.
      data.cases = data.cases.map(
        ({ name, why, platform, input, expected }) => ({
          name,
          ...(why !== undefined ? { why } : {}),
          ...(platform !== undefined ? { platform } : {}),
          input,
          expected,
        }),
      );
      fs.writeFileSync(file, serialize(data));
    }
  });
}
// A vector file as written: each case's fields on their own lines, each
// value on one line (Prettier then breaks only what is too long).
function serialize({ cases, ...head }) {
  const field =
    (indent) =>
    ([key, value]) =>
      `${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  const items = cases.map(
    (c) =>
      `    {\n${Object.entries(c).map(field("      ")).join(",\n")}\n    }`,
  );
  return `{\n${[
    ...Object.entries(head).map(field("  ")),
    `  "cases": [\n${items.join(",\n")}\n  ]`,
  ].join(",\n")}\n}\n`;
}

// The schemas describe what the app and the MCP server write: a session
// through both, then every file in the ai folder checked against its schema.
test("the files written to the ai folder satisfy the ai-store schemas", async (t) => {
  const root = await tempFolder("marklore-vectors-ai-");
  const notes = path.join(root, "Notes");
  await fsp.mkdir(notes);
  const plan = path.join(notes, "Plan.md");
  await fsp.writeFile(plan, "# Plan\n\nSend it on Friday.\n\nAsk Ana.\n");
  const folder = path.join(root, "data", "ai");
  const store = createAiStore(folder);
  const bridge = createAiBridge({
    store,
    openFile: async (p) => ({ path: p }),
    pathOf: (id) => id,
    notify: () => {},
    executable: process.execPath,
    script: fileURLToPath(new URL("../desktop/mcp.mjs", import.meta.url)),
    runOptions: { findClaude: async () => null },
  });
  const messages = [];
  const server = createServer({
    store,
    version: "1",
    write: (m) => messages.push(m),
    channel: { cwd: path.join(root, "project") },
  });
  t.after(async () => {
    await server.stop();
    bridge.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  await bridge.sync([notes], {
    aiLibraries: [notes],
    searchExclude: ["Z:\\Private"],
  });
  const send = (message) =>
    server.receive(JSON.stringify({ jsonrpc: "2.0", ...message }));
  await send({
    id: 0,
    method: "initialize",
    params: { clientInfo: { name: "claude-code" } },
  });
  await send({ method: "notifications/initialized" });
  let next = 1;
  const call = async (name, args = {}) => {
    const id = next++;
    await send({ id, method: "tools/call", params: { name, arguments: args } });
    const { result } = messages.find((m) => m.id === id);
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const text = await fsp.readFile(plan, "utf8");
  const mark = async (quote, words) => {
    const at = text.indexOf(quote);
    const state = await bridge.handlers.changeMark("add", {
      fileId: await fsp.realpath(plan),
      ...anchorOf(text, at, at + quote.length),
      text: words,
    });
    return state.marks.find((m) => m.text === words).id;
  };
  const earlier = await mark("on Friday", "Can this be earlier?");
  const who = await mark("Ask Ana.", "Who?");
  await mark("Plan", "Shorter?");
  const made = await call("propose_edit", {
    note: "Notes/Plan.md",
    summary: "Thursday",
    edits: [
      { old_text: "on Friday", new_text: "on Thursday" },
      { old_text: "Ask Ana.", new_text: "Ask Ana Lee." },
    ],
    marks: [earlier],
  });
  await call("reply_mark", { mark_id: who, text: "Ana Lee?" });
  await bridge.handlers.changeMark("edit", { id: who, text: "Her full name." });
  await call("propose_note", {
    note: "Notes/Ideas.md",
    summary: "Ideas",
    text: "# Ideas\r\n",
  });
  const third = await call("propose_note", {
    note: "Notes/Later.md",
    summary: "Later",
    text: "# Later\n",
  });
  await call("withdraw_proposal", { id: third.proposal_id });
  await bridge.handlers.decideProposal(made.proposal_id, {
    edit: 1,
    status: "rejected",
  });
  await bridge.handlers.decideProposal(made.proposal_id, {
    results: ["accepted", "rejected"],
    reasons: ["", "Keep it short."],
    note: "Thanks.",
    saved: true,
  });
  await bridge.handlers.setContext({
    fileId: await fsp.realpath(plan),
    selection: { text: "Send it", from: text.indexOf("Send it") },
  });
  const run = await store.createRun({
    client: "claude-code",
    marks: [{ id: who, file: await fsp.realpath(plan) }],
  });
  // As desktop/ai-runs.mjs records a run's process and its end.
  await store.changeRun(run.id, (r) => {
    r.pid = 1234;
  });
  await store.changeRun(run.id, (r) => {
    Object.assign(r, {
      status: "done",
      result: "Answered.",
      finished: new Date().toISOString(),
      dismissed: true,
    });
  });
  const checked = [];
  const check = (schema, file) => {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(validate(readSchema(schema), value), [], file);
    checked.push(schema);
  };
  check("access", path.join(folder, "access.json"));
  check("context", path.join(folder, "context.json"));
  for (const [dir, schema] of [
    ["proposals", "proposal"],
    ["marks", "marks"],
    ["runs", "run"],
    ["sessions", "session"],
  ])
    for (const name of fs.readdirSync(path.join(folder, dir)))
      if (name.endsWith(".json")) check(schema, path.join(folder, dir, name));
  assert.deepEqual([...new Set(checked)].sort(), [
    "access",
    "context",
    "marks",
    "proposal",
    "run",
    "session",
  ]);
});
