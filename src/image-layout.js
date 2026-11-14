// Image size, alignment and side-by-side layout, as kept in a note's
// Markdown. Only images someone resized, aligned or put beside something are
// written as HTML; the rest stay `![alt](src)`.
//
//   Resized:            <img src="a.png" alt="A" width="60%">
//   Aligned (left/right; centre is the default and needs nothing):
//                       <p align="right"><img src="a.png" alt="A" width="40%"></p>
//   Images in a row:    <img src="a.png" alt="" width="49%"> <img src="b.png" alt="" width="49%">
//   Anything else side by side (text beside an image, text beside text):
//                       <div class="columns">
//                       <div class="column" data-width="50%">
//
//                       Markdown…
//
//                       </div>
//                       <div class="column" data-width="50%">
//
//                       ![b](b.png)
//
//                       </div>
//                       </div>
//
// `<p align>` is what GitHub, VS Code and Typora all honour for a line of
// images (an `align` on the image itself would float it beside the text).
// Images in one line with widths show side by side everywhere. The columns
// container stacks its columns in other viewers, its Markdown still read.
//
// Here the note's parser reads these forms as Markdown structure (a
// paragraph of images, a container of columns) rather than as raw HTML, so
// they keep source positions, are edited in place and render block by block.

// An `<img>` tag with only the attributes this layout writes.
const IMG =
  /^<img((?:\s+[a-zA-Z_:][-\w:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/i;
const ATTR =
  /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const KNOWN = new Set(["src", "alt", "title", "width"]);
const WIDTH = /^\d{1,4}(?:\.\d+)?%?$/;
const BASIC = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
// Attribute text as read: the plain entities only (null for any other, so
// that what is read is what will be written).
function decode(value) {
  let ok = true;
  const text = value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);?/gi, (m, name) => {
    if (!m.endsWith(";")) return m;
    const key = name.toLowerCase();
    if (BASIC[key]) return BASIC[key];
    const code = /^#x/.test(key)
      ? parseInt(key.slice(2), 16)
      : /^#/.test(key)
        ? Number(key.slice(1))
        : NaN;
    if (code > 0 && code < 0x110000) return String.fromCodePoint(code);
    ok = false;
    return m;
  });
  return ok ? text : null;
}
const encode = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ");

// The image an `<img>` tag at the start of `text` stands for, with the length
// of the tag; null when it is not one this layout reads (other attributes,
// no address).
export function readImgTag(text) {
  const m = IMG.exec(text);
  if (!m) return null;
  const image = { src: null, alt: "", title: null, width: null };
  const seen = new Set();
  for (const a of m[1].matchAll(ATTR)) {
    const name = a[1].toLowerCase();
    if (!KNOWN.has(name) || seen.has(name)) return null;
    seen.add(name);
    const raw = a[2] ?? a[3] ?? a[4];
    if (raw === undefined) return null;
    const value = decode(raw);
    if (value === null) return null;
    image[name] = value;
  }
  if (!image.src || (image.width !== null && !WIDTH.test(image.width)))
    return null;
  return { image, length: m[0].length };
}
// An image as an `<img>` tag (its width as given: "60%" or pixels).
export function imgTag({ src, alt, title, width }) {
  return (
    `<img src="${encode(src || "")}" alt="${encode(alt || "")}"` +
    (title ? ` title="${encode(title)}"` : "") +
    (width ? ` width="${encode(width)}"` : "") +
    ">"
  );
}
// Images in a line: [{ image, from, to }] (offsets in `text`) when `text`
// holds only `<img>` tags (one at least) with white space between.
export function readImgLine(text) {
  const images = [];
  let at = 0;
  while (at < text.length) {
    const space = /^\s*/.exec(text.slice(at))[0].length;
    at += space;
    if (at >= text.length) break;
    const hit = readImgTag(text.slice(at));
    if (!hit) return null;
    images.push({ image: hit.image, from: at, to: at + hit.length });
    at += hit.length;
  }
  return images.length ? images : null;
}
// A line of images wrapped for its alignment: `<p align="…">…</p>` (or a
// `<div align>`, as some READMEs have it). { align, inner, from } or null.
const WRAP =
  /^<(p|div)\s+align\s*=\s*(?:"(left|center|right)"|'(left|center|right)'|(left|center|right))\s*>([\s\S]*?)<\/\1>\s*$/i;
export function readAlignedLine(text) {
  const m = WRAP.exec(text);
  if (!m) return null;
  const inner = m[5];
  const lead = /^\s*/.exec(inner)[0].length;
  const body = inner.trim();
  if (!body || !readImgLine(body)) return null;
  return {
    align: (m[2] || m[3] || m[4]).toLowerCase(),
    inner: body,
    from: m[0].indexOf(">") + 1 + lead,
  };
}

// --- Widths ---------------------------------------------------------------

// A percentage as written: at most one decimal, no trailing zero.
export const percent = (value) =>
  String(Math.round(value * 10) / 10).replace(/\.0$/, "") + "%";
// The share of a width written as a percentage (null for pixels or none).
export const share = (width) =>
  typeof width === "string" && /%$/.test(width) ? parseFloat(width) : null;
// What the images of a row take together: the rest is left for the spaces
// between them, so that other viewers keep them on one line too.
export const rowTotal = (count) => 100 - 2 * Math.max(0, count - 1);
// Shares that sum to `total`, keeping the proportions of `weights`.
export function spread(weights, total) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.round((w / sum) * total * 10) / 10);
  const drift = Math.round((total - out.reduce((a, b) => a + b, 0)) * 10) / 10;
  out[out.length - 1] = Math.round((out.at(-1) + drift) * 10) / 10;
  return out;
}

// --- Parsing --------------------------------------------------------------

const COLUMNS = /^<div class="columns">\s*$/;
const COLUMN =
  /^<div class="column"(?: data-width="(\d{1,3}(?:\.\d+)?)%")?>\s*$/;
const DIV_OPEN = /^<div(?:\s[^>]*)?>\s*$/i;
const DIV_CLOSE = /^<\/div>\s*$/i;
const FENCE = /^(`{3,}|~{3,})/;

// `<div class="columns">`: its columns, each read as Markdown of its own.
function columnsRule(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = (n) =>
    state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  if (!COLUMNS.test(line(startLine))) return false;
  const columns = [];
  let current = null,
    depth = 0,
    fence = null,
    end = -1;
  for (let n = startLine + 1; n < endLine; n++) {
    if (state.sCount[n] < state.blkIndent && !state.isEmpty(n)) return false;
    const text = line(n);
    if (!current) {
      const m = COLUMN.exec(text);
      if (m) {
        current = { open: n, width: m[1] === undefined ? null : Number(m[1]) };
        depth = 0;
        fence = null;
      } else if (DIV_CLOSE.test(text) && columns.length) {
        end = n;
        break;
      } else if (text.trim()) return false;
      continue;
    }
    const f = FENCE.exec(text);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (fence) continue;
    if (DIV_OPEN.test(text)) depth++;
    else if (DIV_CLOSE.test(text)) {
      if (depth) depth--;
      else {
        columns.push({ ...current, close: n });
        current = null;
      }
    }
  }
  if (end < 0) return false;
  if (silent) return true;
  const parent = state.parentType,
    lineMax = state.lineMax;
  let token = state.push("columns_open", "div", 1);
  token.block = true;
  token.map = [startLine, end + 1];
  token.attrSet("class", "columns");
  state.parentType = "columns";
  for (const column of columns) {
    token = state.push("column_open", "div", 1);
    token.block = true;
    token.map = [column.open, column.close + 1];
    token.meta = { width: column.width };
    token.attrSet("class", "column");
    if (column.width !== null)
      token.attrSet("style", `--share: ${column.width}`);
    state.lineMax = column.close;
    state.md.block.tokenize(state, column.open + 1, column.close);
    state.lineMax = lineMax;
    token = state.push("column_close", "div", -1);
    token.block = true;
  }
  token = state.push("columns_close", "div", -1);
  token.block = true;
  state.parentType = parent;
  state.line = end + 1;
  return true;
}

// An `<img>` line standing as an HTML block of its own (a resized image), or
// a line of them wrapped for alignment: read as a paragraph of images.
function imageBlocks(state) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== "html_block") continue;
    const text = tok.content.replace(/\s+$/, "");
    let inner = null,
      align = null;
    const wrapped = readAlignedLine(text);
    if (wrapped) ({ inner, align } = wrapped);
    else if (readImgLine(text) && !/\n/.test(text.trim())) inner = text.trim();
    if (!inner) continue;
    const open = new state.Token("paragraph_open", "p", 1);
    open.map = tok.map;
    open.level = tok.level;
    open.block = true;
    open.meta = { imageAlign: align };
    const inline = new state.Token("inline", "", 0);
    inline.content = inner;
    inline.map = tok.map;
    inline.level = tok.level + 1;
    inline.children = [];
    const close = new state.Token("paragraph_close", "p", -1);
    close.level = tok.level;
    close.block = true;
    tokens.splice(i, 1, open, inline, close);
    i += 2;
  }
}

// In a paragraph, an `<img>` tag this layout reads is an image like
// `![alt](src)` (its tag kept as the token's markup, `info` "html"), and a
// paragraph of images only is a line (class "image-line") or, with two or
// more that have widths, a row ("image-row").
function imageTags(state) {
  const tokens = state.tokens;
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== "inline" || tokens[i - 1].type !== "paragraph_open")
      continue;
    const para = tokens[i - 1];
    const align = para.meta?.imageAlign ?? null;
    const children = tok.children || [];
    if (children.some((c) => c.type === "html_inline"))
      tok.children = children.map((child) => {
        if (child.type !== "html_inline") return child;
        const hit = readImgTag(child.content);
        if (!hit || hit.length !== child.content.length) return child;
        const src = state.md.normalizeLink(hit.image.src);
        if (!state.md.validateLink(src)) return child;
        const image = new state.Token("image", "img", 0);
        image.attrs = [
          ["src", src],
          ["alt", ""],
        ];
        if (hit.image.title) image.attrSet("title", hit.image.title);
        if (hit.image.width) image.attrSet("width", hit.image.width);
        const alt = new state.Token("text", "", 0);
        alt.content = hit.image.alt;
        image.children = [alt];
        image.content = hit.image.alt;
        image.markup = child.content;
        image.info = align ? "html:" + align : "html";
        return image;
      });
    const kids = tok.children || [];
    const images = kids.filter((c) => c.type === "image");
    const only =
      images.length &&
      kids.every(
        (c) =>
          c.type === "image" ||
          c.type === "softbreak" ||
          (c.type === "text" && !c.content.trim()),
      );
    if (!only) continue;
    const html = images.every((c) => c.info.startsWith("html"));
    if (images.length > 1 && html && images.every((c) => c.attrGet("width")))
      para.attrJoin("class", "image-row");
    else if (html) para.attrJoin("class", "image-line");
    else continue;
    if (align) para.attrJoin("class", "image-align-" + align);
  }
}

// The markdown-it plugin (src/markdown.js createParser).
export function imageLayout(md) {
  md.block.ruler.before("html_block", "folio_columns", columnsRule, {
    alt: ["paragraph", "reference", "blockquote"],
  });
  md.core.ruler.after("block", "folio_image_blocks", imageBlocks);
  md.core.ruler.after("inline", "folio_image_tags", imageTags);
}
