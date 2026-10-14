// A PDF's outline (bookmarks): each entry's title and level, read from the
// uncompressed outline objects Chromium writes. Used by the export tests.
// Usage: node tools/pdf-outline.mjs file.pdf
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function pdfOutline(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  const objects = new Map();
  for (const match of text.matchAll(/(\d+) 0 obj\s*<<([\s\S]*?)>>\s*endobj/g))
    objects.set(match[1], match[2]);
  const decode = (raw) => {
    if (raw.startsWith("<")) {
      const buffer = Buffer.from(raw.slice(1, -1).replace(/\s+/g, ""), "hex");
      if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        let out = "";
        for (let i = 2; i + 1 < buffer.length; i += 2)
          out += String.fromCharCode((buffer[i] << 8) | buffer[i + 1]);
        return out;
      }
      return buffer.toString("latin1");
    }
    return raw.slice(1, -1).replace(/\\([()\\])/g, "$1");
  };
  const ref = (body, key) =>
    body.match(new RegExp("/" + key + "\\s+(\\d+) 0 R"))?.[1];
  const root = [...objects].find(([, body]) =>
    /\/Type\s*\/Outlines/.test(body),
  );
  if (!root) return [];
  const entries = [];
  const walk = (id, level) => {
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const body = objects.get(id);
      if (!body) break;
      const title = body.match(
        /\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/,
      )?.[1];
      entries.push({ level, title: title ? decode(title) : "" });
      const first = ref(body, "First");
      if (first) walk(first, level + 1);
      id = ref(body, "Next");
    }
  };
  walk(ref(root[1], "First"), 1);
  return entries;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2])
  for (const { level, title } of pdfOutline(fs.readFileSync(process.argv[2])))
    console.log("  ".repeat(level - 1) + title);
