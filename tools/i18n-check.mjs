// Finds interface text that would stay Chinese in English: string literals
// with Chinese that are not the first argument of t("…"), and t() keys with
// no English entry (or whose {placeholders} differ). Comments are ignored; a
// line ending in `// i18n-ignore` is skipped. Usage:
//   node tools/i18n-check.mjs [file ...]   (default: all of src and desktop)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHINESE = /[㐀-鿿豈-﫿]/;
const SKIP = new Set(["desktop/i18n.mjs"]);

// Literals of a JS source: { text, line, start, kind } for '', "", and each
// static part of a template. A small scanner: enough for this code base.
export function literals(source) {
  const out = [];
  let i = 0,
    line = 1;
  const stack = []; // template nesting: brace depth per open ${
  let braces = 0;
  const prevSignificant = () => {
    for (let j = i - 1; j >= 0; j--)
      if (!/\s/.test(source[j])) return source[j];
    return "";
  };
  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      line += (source.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
    } else if (
      c === "/" &&
      /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(prevSignificant())
    ) {
      // A regular expression literal.
      i++;
      let inClass = false;
      while (i < source.length && source[i] !== "\n") {
        if (source[i] === "\\") i += 2;
        else if (source[i] === "[") ((inClass = true), i++);
        else if (source[i] === "]") ((inClass = false), i++);
        else if (source[i] === "/" && !inClass) break;
        else i++;
      }
      i++;
    } else if (c === '"' || c === "'") {
      const start = i,
        startLine = line;
      i++;
      let text = "";
      while (i < source.length && source[i] !== c && source[i] !== "\n") {
        if (source[i] === "\\") {
          text += source.slice(i, i + 2);
          i += 2;
        } else text += source[i++];
      }
      i++;
      out.push({ text, line: startLine, start, kind: "string" });
    } else if (
      c === "`" ||
      (c === "}" && stack.length && braces === stack.at(-1))
    ) {
      // Template text runs from ` (or the } closing a ${…}) to ` or ${.
      if (c === "}") stack.pop();
      const start = i,
        startLine = line;
      i++;
      let text = "";
      while (i < source.length) {
        if (source[i] === "\\") {
          text += source.slice(i, i + 2);
          i += 2;
        } else if (source[i] === "`") {
          i++;
          break;
        } else if (source[i] === "$" && source[i + 1] === "{") {
          i += 2;
          stack.push(braces);
          break;
        } else {
          if (source[i] === "\n") line++;
          text += source[i++];
        }
      }
      out.push({ text, line: startLine, start, kind: "template" });
    } else {
      if (c === "{") braces++;
      else if (c === "}") braces--;
      i++;
    }
  }
  return out;
}

// Is the literal at `start` the first argument of t( … )?
function inT(source, start) {
  let j = start - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (source[j] !== "(") return false;
  j--;
  while (j >= 0 && /\s/.test(source[j])) j--;
  return source[j] === "t" && !/[\w$.]/.test(source[j - 1] || "");
}

const placeholders = (text) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

export async function check(files) {
  const { default: en } = await import(
    pathToFileURL(path.join(root, "desktop/locales/en.mjs")).href +
      `?${Date.now()}`
  );
  const problems = [];
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    if (SKIP.has(rel) || rel.startsWith("desktop/locales/")) continue;
    const source = fs.readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (const lit of literals(source)) {
      if (!CHINESE.test(lit.text)) continue;
      if (/\/\/\s*i18n-ignore\s*$/.test(lines[lit.line - 1] || "")) continue;
      const shown = lit.text.replace(/\s+/g, " ").slice(0, 70);
      if (lit.kind !== "string" || !inT(source, lit.start)) {
        problems.push(`${rel}:${lit.line}: not translated: ${shown}`);
        continue;
      }
      const key = JSON.parse(
        `"${lit.text.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`,
      );
      if (!Object.hasOwn(en, key))
        problems.push(`${rel}:${lit.line}: no English entry: ${shown}`);
      else if (placeholders(key) !== placeholders(en[key]))
        problems.push(`${rel}:${lit.line}: placeholders differ: ${shown}`);
      else if (CHINESE.test(en[key]))
        problems.push(
          `${rel}:${lit.line}: English entry contains Chinese: ${shown}`,
        );
    }
  }
  return problems;
}

export function sourceFiles() {
  const files = [];
  for (const dir of ["src", "desktop"])
    for (const name of fs.readdirSync(path.join(root, dir)))
      if (/\.(js|mjs|cjs)$/.test(name)) files.push(path.join(root, dir, name));
  return files;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2).map((f) => path.resolve(f));
  const problems = await check(args.length ? args : sourceFiles());
  for (const problem of problems) console.log(problem);
  console.log(
    problems.length
      ? `${problems.length} problem(s)`
      : "i18n: all interface text translated",
  );
  process.exitCode = problems.length ? 1 : 0;
}
