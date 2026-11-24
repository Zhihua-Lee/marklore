// The rule modules stay pure: plain JavaScript that any process (the page,
// the main process, the MCP server) or a port to another language can take
// as it is. They and everything they import may not import Electron, Node's
// built-in modules (fs, path, os…), npm packages or renderer code (src/), nor
// use DOM, Electron or Node globals. File access stays in the modules that
// call them (docs/development.md lists which parts of the mixed modules are
// pure).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PURE = [
  "desktop/note-names.mjs",
  "desktop/slug.mjs",
  "desktop/folder-index.mjs",
  "desktop/link-rewrite.mjs",
  "desktop/proposal-edits.mjs",
  "desktop/comment-anchors.mjs",
  "desktop/settings-schema.mjs",
  "desktop/excluded.mjs",
  "desktop/i18n.mjs",
  "desktop/scan-rules.mjs",
  "desktop/snippet.mjs",
  "desktop/note-search.mjs",
  "desktop/image-density.mjs",
];
// Globals of the page, of Electron and of Node (names a module might also
// give a local of its own, such as self or location, are left out).
const GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "requestIdleCallback",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "customElements",
  "fetch",
  "XMLHttpRequest",
  "process",
  "Buffer",
  "require",
  "__dirname",
  "__filename",
  "globalThis",
];

// The source with comments taken out and the contents of strings, template
// texts and regular expressions blanked: what is left is code. Template
// substitutions (${…}) stay, as code.
function codeOf(source) {
  let i = 0;
  // The last significant character and word, to tell a regular expression
  // from a division.
  let lastChar = "",
    lastWord = "";
  const REGEX_AFTER = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
  const REGEX_WORDS = new Set([
    "return",
    "typeof",
    "case",
    "do",
    "else",
    "in",
    "of",
    "void",
    "yield",
    "await",
    "delete",
    "instanceof",
    "new",
    "throw",
  ]);
  function string(quote) {
    i++;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") i++;
      i++;
    }
    i++;
    return quote + quote;
  }
  function regex() {
    let inClass = false;
    i++;
    while (i < source.length) {
      const c = source[i];
      if (c === "\\") i += 2;
      else if (c === "[") ((inClass = true), i++);
      else if (c === "]") ((inClass = false), i++);
      else if (c === "/" && !inClass) break;
      else if (c === "\n") throw Error(`Unclosed regular expression at ${i}`);
      else i++;
    }
    i++;
    while (/[a-z]/i.test(source[i] || "")) i++;
    return "/r/";
  }
  function template() {
    let out = "`";
    i++;
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") i += 2;
      else if (source[i] === "$" && source[i + 1] === "{") {
        i += 2;
        out += "${" + code(true) + "}";
        i++;
      } else i++;
    }
    i++;
    return out + "`";
  }
  // Code up to the end, or up to the "}" closing a substitution.
  function code(inSubstitution = false) {
    let out = "",
      depth = 0;
    while (i < source.length) {
      const c = source[i],
        d = source[i + 1];
      if (c === "/" && d === "/") {
        while (i < source.length && source[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && d === "*") {
        const end = source.indexOf("*/", i + 2);
        i = end < 0 ? source.length : end + 2;
        out += " ";
        continue;
      }
      if (c === '"' || c === "'") {
        out += string(c);
        lastChar = '"';
        lastWord = "";
        continue;
      }
      if (c === "`") {
        out += template();
        lastChar = "`";
        lastWord = "";
        continue;
      }
      if (
        c === "/" &&
        (!lastChar ||
          REGEX_AFTER.has(lastChar) ||
          (/\w/.test(lastChar) && REGEX_WORDS.has(lastWord)))
      ) {
        out += regex();
        lastChar = "/";
        lastWord = "";
        continue;
      }
      if (inSubstitution) {
        if (c === "{") depth++;
        else if (c === "}" && depth-- === 0) return out;
      }
      out += c;
      if (/[\w$]/.test(c)) lastWord = /[\w$]/.test(lastChar) ? lastWord + c : c;
      if (!/\s/.test(c)) lastChar = c;
      i++;
    }
    return out;
  }
  return code();
}

// The modules a source imports, as written.
function importsOf(source) {
  const out = [];
  for (const m of source.matchAll(
    /(?:^|[;\n])\s*(?:import|export)\b[^;'"`]*?\bfrom\s*(["'])([^"']+)\1/g,
  ))
    out.push(m[2]);
  for (const m of source.matchAll(/(?:^|[;\n])\s*import\s*(["'])([^"']+)\1/g))
    out.push(m[2]);
  for (const m of source.matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1/g))
    out.push(m[2]);
  return out;
}

// What makes a module impure: its imports and the globals its code uses.
function problemsOf(source) {
  const problems = [];
  const builtins = new Set(builtinModules);
  for (const spec of importsOf(source)) {
    if (spec.startsWith("node:") || builtins.has(spec.split("/")[0]))
      problems.push(`imports Node's ${spec}`);
    else if (spec === "electron" || spec.startsWith("electron/"))
      problems.push("imports electron");
    else if (!spec.startsWith("."))
      problems.push(`imports the package ${spec}`);
  }
  const code = codeOf(source);
  for (const name of GLOBALS) {
    // The name itself, not a property (a.document) nor an object key.
    const use = new RegExp(`(?<![\\w$.])${name}(?![\\w$])(?!\\s*:(?!:))`);
    if (use.test(code)) problems.push(`uses the global ${name}`);
  }
  return problems;
}

test("the pure rule modules import nothing of Electron, Node, packages or the page, and use none of their globals", () => {
  const seen = new Map();
  const queue = PURE.map((file) => path.join(ROOT, file));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    const problems = problemsOf(source);
    for (const spec of importsOf(source))
      if (spec.startsWith(".")) {
        const next = path.resolve(path.dirname(file), spec);
        if (!path.relative(path.join(ROOT, "src"), next).startsWith(".."))
          problems.push(`imports renderer code ${spec}`);
        queue.push(next);
      }
    seen.set(file, problems);
  }
  const found = [...seen]
    .filter(([, problems]) => problems.length)
    .map(([file, problems]) => `${path.relative(ROOT, file)}: ${problems}`);
  assert.deepEqual(found, []);
  // The locales come along with i18n.
  assert.ok(
    [...seen.keys()].some((file) => file.endsWith("en-library.mjs")),
    "imports followed",
  );
});

test("the check finds what it looks for, and not in comments, strings or regular expressions", () => {
  const clean = [
    "// document.body and process.env in a comment",
    "/* window.open() */",
    'const a = "document.title", b = `process ${1 + 2}`;',
    "const re = /window|document/g, n = 4 / 2 / 1;",
    "export const x = { document: 1, process: 2 };",
    "const y = obj.document + obj.process;",
    "const z = `a${`b${'c'}`}`;",
    "function f(y) { return /^process$/.test(y); }",
  ].join("\n");
  assert.deepEqual(problemsOf(clean), []);
  assert.deepEqual(problemsOf("const t = document.title;"), [
    "uses the global document",
  ]);
  assert.deepEqual(problemsOf("const e = `${process.env.X}`;"), [
    "uses the global process",
  ]);
  assert.deepEqual(problemsOf('import fs from "node:fs";'), [
    "imports Node's node:fs",
  ]);
  assert.deepEqual(problemsOf('import { promises } from "fs";'), [
    "imports Node's fs",
  ]);
  assert.deepEqual(problemsOf('import { app } from "electron";'), [
    "imports electron",
  ]);
  assert.deepEqual(problemsOf('import MarkdownIt from "markdown-it";'), [
    "imports the package markdown-it",
  ]);
  assert.deepEqual(problemsOf('const m = await import("node:path");'), [
    "imports Node's node:path",
  ]);
});
