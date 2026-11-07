// The editor's document model: a note read into a tree of blocks with the
// same parser the reading view uses (../markdown.js), and written back.
//
// Writing back keeps every top-level block that was not touched byte for
// byte, with the text between blocks as it was. A touched block is written
// from the tree, as close to its own style as the tree remembers (list
// bullets, emphasis markers, fences, formula delimiters), escaping only
// where the text would otherwise read as markup.
import { Schema } from "prosemirror-model";
import {
  schema as base,
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import { tableNodes } from "prosemirror-tables";
import { Transform } from "prosemirror-transform";
import { createParser, lineOffsets } from "../markdown.js";

const tables = tableNodes({
  tableGroup: "block",
  cellContent: "inline*",
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => dom.style.textAlign || null,
      setDOMAttr: (value, attrs) => {
        if (value) attrs.style = `text-align:${value}`;
      },
    },
  },
});
// A table remembers whether its columns were padded to line up.
tables.table = {
  ...tables.table,
  attrs: { ...(tables.table.attrs || {}), padded: { default: false } },
};
// The caret never stops between two cells (only before or after a table).
tables.table_row = { ...tables.table_row, allowGapCursor: false };
const nodes = base.spec.nodes;
const marks = base.spec.marks;
export const schema = new Schema({
  nodes: nodes
    .update("heading", {
      ...nodes.get("heading"),
      attrs: {
        level: { default: 1 },
        markup: { default: "#" },
        underline: { default: null },
      },
    })
    .update("horizontal_rule", {
      ...nodes.get("horizontal_rule"),
      attrs: { markup: { default: "---" } },
    })
    .update("code_block", {
      ...nodes.get("code_block"),
      attrs: { params: { default: "" }, markup: { default: "```" } },
      // Its edges are where the caret leaves it: Down at its end stops after
      // it, even when nothing follows (rich/editor.js, gap cursor).
      isolating: true,
    })
    .update("bullet_list", {
      ...nodes.get("bullet_list"),
      attrs: { tight: { default: true }, bullet: { default: "-" } },
    })
    .update("ordered_list", {
      ...nodes.get("ordered_list"),
      attrs: {
        order: { default: 1 },
        tight: { default: true },
        delim: { default: "." },
      },
    })
    .append(tables)
    .append({
      // A soft line break inside a paragraph: shown as a space, written as
      // the line break it was.
      // A task item's box, "[ ]" or "[x]" in the source.
      task_box: {
        inline: true,
        group: "inline",
        atom: true,
        attrs: { checked: { default: false } },
        toDOM: (node) => [
          "input",
          {
            type: "checkbox",
            class: "task-list-item-checkbox",
            ...(node.attrs.checked ? { checked: "" } : {}),
          },
        ],
      },
      soft_break: {
        inline: true,
        group: "inline",
        selectable: false,
        toDOM: () => ["span", { class: "soft-break" }, " "],
      },
      math_inline: {
        group: "inline",
        inline: true,
        atom: true,
        attrs: { tex: {}, raw: {} },
        toDOM: () => ["span", { class: "formula" }],
      },
      math_display: {
        group: "block",
        atom: true,
        attrs: { tex: {}, raw: {} },
        toDOM: () => ["div", { class: "math-block" }],
      },
      // Markdown the editor shows but does not take apart (HTML, footnote
      // definitions, link references, diagrams): written back as it was.
      raw_block: {
        group: "block",
        atom: true,
        attrs: { source: {}, kind: { default: "raw" } },
        toDOM: () => ["div", { class: "raw-block" }],
      },
      raw_inline: {
        group: "inline",
        inline: true,
        atom: true,
        attrs: { source: {}, kind: { default: "html" } },
        toDOM: () => ["span", { class: "raw-inline" }],
      },
    }),
  marks: marks
    .update("em", { ...marks.get("em"), attrs: { markup: { default: "*" } } })
    .update("strong", {
      ...marks.get("strong"),
      attrs: { markup: { default: "**" } },
    })
    .update("link", {
      ...marks.get("link"),
      attrs: {
        href: {},
        title: { default: null },
        markup: { default: "" },
      },
    })
    .update("code", {
      ...marks.get("code"),
      attrs: { markup: { default: "`" } },
    })
    .append({
      strike: {
        attrs: { markup: { default: "~~" } },
        parseDOM: [{ tag: "s" }, { tag: "del" }],
        toDOM: () => ["s", 0],
      },
      // The text of a formula open for editing (math.js).
      math_src: {
        inclusive: true,
        excludes: "_",
        toDOM: () => ["span", { class: "math-src" }, 0],
      },
    }),
});
const S = schema.nodes;

// --- Reading -------------------------------------------------------------

const md = createParser();
// Addresses as written (the reading view percent-encodes them).
md.normalizeLink = (url) => url;
md.normalizeLinkText = (url) => url;
// Pipes inside formulas in table rows are swapped for a private character
// while parsing (markdown.js); formulas get their own pipes back.
function restorePipes(tokens, marker) {
  if (!marker) return;
  for (const tok of tokens) {
    if (tok.content && tok.content.includes(marker))
      tok.content = tok.content.split(marker).join("|");
    if (tok.children) restorePipes(tok.children, marker);
  }
}
// Footnote definitions are written where they stand (raw blocks); the
// list markdown-it gathers at the end of a parse is not part of a block.
const tokenizer = {
  parse(src, env) {
    const tokens = md.parse(src, env);
    restorePipes(tokens, env.mathPipe);
    // Escaped characters ("\*") stay separate tokens for the reading view's
    // source positions; here they are text like any other.
    for (const tok of tokens)
      for (const child of tok.children || [])
        if (child.type === "text_special" || child.type === "folio_escape")
          child.type = "text";
    const tail = tokens.findIndex((t) => t.type === "footnote_block_open");
    const kept = tail >= 0 ? tokens.slice(0, tail) : tokens;
    // A display formula's own source, to write it back as it was.
    const lines = src.split("\n");
    for (const tok of kept) {
      if (tok.type === "folio_math_block")
        tok.meta = { raw: displayRaw(tok, lines) };
      else if (tok.type === "table_open")
        tok.meta = { padded: /-{4,}/.test(lines[tok.map[0] + 1] || "") };
      else if (tok.type === "heading_open" && /[=-]/.test(tok.markup))
        tok.meta = { underline: (lines[tok.map[1] - 1] || "").trim() };
      // The task plugin turns "[ ]" into an HTML checkbox: a box of our own.
      for (const child of tok.children || [])
        if (
          child.type === "html_inline" &&
          /task-list-item-checkbox/.test(child.content)
        ) {
          child.type = "task_box";
          child.meta = { checked: /checked/.test(child.content) };
        }
    }
    return kept;
  },
};
function displayRaw(tok, lines) {
  const first = lines[tok.map[0]] || "";
  if (/^\\begin\{/.test(tok.content)) return tok.content;
  // "\\[" (escaped, as copied from some pages) is read with its escapes
  // undone: only a top-level block keeps its exact lines.
  if (/^\s*\\\\\[/.test(first))
    return tok.level === 0
      ? lines.slice(tok.map[0], tok.map[1]).join("\n")
      : "$$" + tok.content + "$$";
  if (/^[\s>*+\-\d.)]*\\\[/.test(first)) return "\\[" + tok.content + "\\]";
  return "$$" + tok.content + "$$";
}
const tight = (tokens, i) => {
  while (++i < tokens.length)
    if (tokens[i].type !== "list_item_open") return tokens[i].hidden;
  return false;
};
const alignOf = (tok) => ({
  align: /text-align:\s*(\w+)/.exec(tok.attrGet("style") || "")?.[1] || null,
});
const MATH_CLOSE = { $: "$", $$: "$$", "\\(": "\\)" };
const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  heading: {
    block: "heading",
    getAttrs: (tok) => ({
      level: +tok.tag.slice(1),
      markup: tok.markup,
      underline: tok.meta?.underline ?? null,
    }),
  },
  fence: {
    block: "code_block",
    noCloseToken: true,
    getAttrs: (tok) => ({ params: tok.info || "", markup: tok.markup }),
  },
  code_block: {
    block: "code_block",
    noCloseToken: true,
    getAttrs: () => ({ markup: "```" }),
  },
  bullet_list: {
    block: "bullet_list",
    getAttrs: (tok, tokens, i) => ({
      tight: tight(tokens, i),
      bullet: tok.markup,
    }),
  },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok, tokens, i) => ({
      order: +tok.attrGet("start") || 1,
      tight: tight(tokens, i),
      delim: tok.markup || ".",
    }),
  },
  em: { mark: "em", getAttrs: (tok) => ({ markup: tok.markup }) },
  strong: { mark: "strong", getAttrs: (tok) => ({ markup: tok.markup }) },
  s: { mark: "strike", getAttrs: (tok) => ({ markup: tok.markup }) },
  link: {
    mark: "link",
    getAttrs: (tok) => ({
      href: tok.attrGet("href"),
      title: tok.attrGet("title") || null,
      markup:
        tok.markup === "linkify" || tok.info === "auto"
          ? tok.markup || "autolink"
          : "",
    }),
  },
  softbreak: { node: "soft_break" },
  hr: { node: "horizontal_rule", getAttrs: (tok) => ({ markup: tok.markup }) },
  task_box: {
    node: "task_box",
    getAttrs: (tok) => ({ checked: !!tok.meta?.checked }),
  },
  table: {
    block: "table",
    getAttrs: (tok) => ({ padded: !!tok.meta?.padded }),
  },
  code_inline: {
    mark: "code",
    noCloseToken: true,
    getAttrs: (tok) => ({ markup: tok.markup }),
  },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header", getAttrs: alignOf },
  td: { block: "table_cell", getAttrs: alignOf },
  folio_math: {
    node: "math_inline",
    getAttrs: (tok) => ({
      tex: tok.content,
      raw: tok.markup + tok.content + MATH_CLOSE[tok.markup],
    }),
  },
  folio_math_block: {
    node: "math_display",
    getAttrs: (tok) => ({ tex: tok.content, raw: tok.meta?.raw ?? null }),
  },
  html_inline: {
    node: "raw_inline",
    getAttrs: (tok) => ({ source: tok.content, kind: "html" }),
  },
  html_block: {
    node: "raw_block",
    getAttrs: (tok) => ({
      source: tok.content.replace(/\n$/, ""),
      kind: "html",
    }),
  },
  footnote_ref: {
    node: "raw_inline",
    getAttrs: (tok) => ({ source: `[^${tok.meta.label}]`, kind: "footnote" }),
  },
});

// The note cut into top-level blocks, each with its exact text. Text that
// belongs to no block (footnote definitions, link references) becomes a raw
// block of its own, so nothing is ever left out of the editor.
export function load(src) {
  const env = {};
  const tokens = tokenizer.parse(src, env);
  const starts = lineOffsets(src);
  const at = (line) => (line < starts.length ? starts[line] : src.length);
  const spans = [];
  // Front matter at the very top stays as it is.
  const front = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(src);
  if (front) {
    let to = front[0].length;
    while (to > 0 && src[to - 1] === "\n") to--;
    spans.push({ from: 0, to, raw: true, kind: "frontmatter" });
  }
  for (const tok of tokens) {
    if (tok.level !== 0 || !tok.map || tok.nesting === -1) continue;
    const from = at(tok.map[0]);
    let to = at(tok.map[1]);
    while (to > from && src[to - 1] === "\n") to--;
    if (spans.length && from < spans.at(-1).to) continue;
    if (front && from < front[0].length) continue;
    const raw =
      tok.type === "html_block" ||
      (tok.type === "fence" && /^mermaid\b/i.test(tok.info.trim()));
    spans.push({
      from,
      to,
      raw,
      kind: tok.type === "fence" ? "diagram" : "html",
    });
  }
  // Fill what lies between blocks: blank lines stay gaps, anything else is a
  // raw block.
  const filled = [];
  let pos = 0;
  // Runs of non-blank lines between from and to.
  const gapText = (from, to) => {
    let run = null;
    for (let p = from; p < to;) {
      let end = src.indexOf("\n", p);
      if (end < 0 || end > to) end = to;
      if (src.slice(p, end).trim()) {
        if (run) run.to = end;
        else run = { from: p, to: end, raw: true, kind: "text" };
      } else if (run) {
        filled.push(run);
        run = null;
      }
      p = end + 1;
    }
    if (run) filled.push(run);
  };
  for (const s of spans) {
    if (s.from > pos) gapText(pos, s.from);
    filled.push(s);
    pos = s.to;
  }
  if (pos < src.length) gapText(pos, src.length);
  filled.sort((a, b) => a.from - b.from);

  const blocks = [];
  const docNodes = [];
  filled.forEach((b, i) => {
    const text = src.slice(b.from, b.to);
    const next = filled[i + 1]?.from ?? src.length;
    const gap = src.slice(b.to, next);
    let made;
    if (b.raw) made = [S.raw_block.create({ source: text, kind: b.kind })];
    else {
      try {
        made = parser.parse(text, { ...env }).content.content;
      } catch {
        made = [S.raw_block.create({ source: text, kind: "text" })];
      }
      if (!made.length)
        made = [S.raw_block.create({ source: text, kind: "text" })];
    }
    made.forEach((node, k) => {
      docNodes.push(node);
      blocks.push({
        node,
        // Only a block that read as one node can stand for its text.
        text: made.length === 1 ? text : null,
        from: b.from,
        gap: k < made.length - 1 ? "\n\n" : gap,
      });
    });
  });
  // A blank note (a new one) is one empty paragraph standing for nothing,
  // its blank lines kept after it.
  if (!docNodes.length) {
    const node = S.paragraph.create();
    docNodes.push(node);
    blocks.push({ node, text: "", from: 0, gap: src });
    filled.push({ from: 0 });
  }
  let at0 = 0;
  for (const b of blocks) {
    b.pos = at0;
    at0 += b.node.nodeSize;
  }
  return {
    doc: S.doc.create(null, docNodes),
    blocks,
    lead: src.slice(0, filled[0]?.from ?? src.length),
    env,
  };
}

// --- Writing -------------------------------------------------------------

let escaping = true;
let inCell = false;
const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    text(state, node) {
      // In a table cell a pipe would end the cell.
      const escape = escaping && !state.inAutolink;
      if (!inCell) return state.text(node.text, escape);
      const text = escape ? state.esc(node.text) : node.text;
      state.text(text.replace(/(?<!\\)\|/g, "\\|"), false);
    },
    soft_break(state) {
      state.write("\n");
    },
    horizontal_rule(state, node) {
      state.write(node.attrs.markup || "---");
      state.closeBlock(node);
    },
    task_box(state, node) {
      state.write(node.attrs.checked ? "[x]" : "[ ]");
    },
    heading(state, node) {
      if (node.attrs.markup === "=" || node.attrs.markup === "-") {
        state.renderInline(node);
        state.ensureNewLine();
        state.write(node.attrs.underline || node.attrs.markup.repeat(3));
        state.closeBlock(node);
        return;
      }
      state.write(state.repeat("#", node.attrs.level) + " ");
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    code_block(state, node) {
      if (
        node.attrs.params === "$$" ||
        node.attrs.params.startsWith("\u0000raw:")
      ) {
        // A display formula or raw block open for editing (math.js): its
        // text is its source.
        state.text(node.textContent, false);
        state.closeBlock(node);
        return;
      }
      const fence = node.attrs.markup || "```";
      state.write(fence + (node.attrs.params || "") + "\n");
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write(fence);
      state.closeBlock(node);
    },
    bullet_list(state, node) {
      state.renderList(node, "  ", () => (node.attrs.bullet || "-") + " ");
    },
    ordered_list(state, node) {
      const start = node.attrs.order || 1;
      const width = String(start + node.childCount - 1).length;
      const space = state.repeat(" ", width + 2);
      state.renderList(node, space, (i) => {
        const n = String(start + i);
        return (
          state.repeat(" ", width - n.length) +
          n +
          (node.attrs.delim || ".") +
          " "
        );
      });
    },
    math_inline(state, node) {
      state.write(node.attrs.raw ?? "$" + node.attrs.tex + "$");
    },
    math_display(state, node) {
      state.text(node.attrs.raw ?? "$$\n" + node.attrs.tex + "\n$$", false);
      state.closeBlock(node);
    },
    raw_block(state, node) {
      state.text(node.attrs.source, false);
      state.closeBlock(node);
    },
    raw_inline(state, node) {
      state.write(node.attrs.source);
    },
    table(state, node) {
      const rows = [];
      node.forEach((row) => {
        const cells = [];
        row.forEach((cell) => cells.push(cellText(cell)));
        rows.push(cells);
      });
      const aligns = [];
      node.firstChild.forEach((cell) => aligns.push(cell.attrs.align));
      // Padded tables keep their columns lined up (wide characters count
      // twice, as in the editors that pad them).
      const widths = aligns.map((_, c) =>
        node.attrs.padded
          ? Math.max(3, ...rows.map((r) => textWidth(r[c] || "")))
          : 3,
      );
      const pad = (text, c) => {
        if (!node.attrs.padded) return text || " ";
        const room = widths[c] - textWidth(text);
        if (aligns[c] === "right") return " ".repeat(room) + text;
        if (aligns[c] === "center")
          return (
            " ".repeat(Math.floor(room / 2)) +
            text +
            " ".repeat(Math.ceil(room / 2))
          );
        return text + " ".repeat(room);
      };
      const line = (cells) =>
        "| " + aligns.map((_, c) => pad(cells[c] || "", c)).join(" | ") + " |";
      const rule = aligns.map((a, c) => {
        const w = widths[c];
        if (a === "center") return ":" + "-".repeat(w - 2) + ":";
        if (a === "right") return "-".repeat(w - 1) + ":";
        if (a === "left") return ":" + "-".repeat(w - 1);
        return "-".repeat(w);
      });
      const lines = [line(rows[0]), "| " + rule.join(" | ") + " |"];
      for (const r of rows.slice(1)) lines.push(line(r));
      lines.forEach((l, i) => {
        state.write(l);
        if (i < lines.length - 1) state.ensureNewLine();
      });
      state.closeBlock(node);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    em: {
      open: (_s, mark) => mark.attrs.markup || "*",
      close: (_s, mark) => mark.attrs.markup || "*",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    strong: {
      open: (_s, mark) => mark.attrs.markup || "**",
      close: (_s, mark) => mark.attrs.markup || "**",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    strike: {
      open: (_s, mark) => mark.attrs.markup || "~~",
      close: (_s, mark) => mark.attrs.markup || "~~",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    link: {
      open(state, mark, parent, index) {
        const bare =
          mark.attrs.markup === "linkify" && plainLink(mark, parent, index);
        state.inAutolink = bare ? "bare" : undefined;
        if (bare) return "";
        return defaultMarkdownSerializer.marks.link.open(
          state,
          mark,
          parent,
          index,
        );
      },
      close(state, mark, parent, index) {
        if (state.inAutolink === "bare") {
          state.inAutolink = undefined;
          return "";
        }
        return defaultMarkdownSerializer.marks.link.close(
          state,
          mark,
          parent,
          index,
        );
      },
      mixable: true,
    },
    math_src: { open: "", close: "", escape: false },
    code: {
      open: (_s, mark, parent, index) =>
        codeFence(mark, parent.child(index), 1),
      close: (_s, mark, parent, index) =>
        codeFence(mark, parent.child(index - 1), -1),
      escape: false,
    },
  },
  { escapeExtraCharacters: /\$/g },
);
// Inline code keeps its own backticks when they still fit around the text;
// text starting or ending with a backtick gets a space inside them.
function codeFence(mark, node, side) {
  const text = node.isText ? node.text : "";
  let longest = 0;
  for (const m of text.matchAll(/`+/g))
    longest = Math.max(longest, m[0].length);
  let ticks = mark.attrs.markup || "`";
  for (const m of text.matchAll(/`+/g))
    if (m[0].length === ticks.length) ticks = "`".repeat(longest + 1);
  const space = /^`|`$/.test(text) || /^ .* $/.test(text) ? " " : "";
  return side > 0 ? ticks + space : space + ticks;
}
function textWidth(text) {
  let w = 0;
  for (const ch of text)
    w +=
      /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u.test(
        ch,
      )
        ? 2
        : 1;
  return w;
}
function plainLink(mark, parent, index) {
  const content = parent.child(index);
  return content.isText && content.text === mark.attrs.href;
}
function cellText(cell) {
  const outer = inCell;
  inCell = true;
  try {
    return serializeNodes([S.paragraph.create(null, cell.content)]).replace(
      /\n/g,
      " ",
    );
  } finally {
    inCell = outer;
  }
}
function serializeNodes(list) {
  return serializer.serialize(S.doc.create(null, list)).replace(/\n+$/, "");
}

// One touched block as Markdown: unescaped when that reads back as the same
// block, escaped otherwise.
export function writeBlock(node, env = {}) {
  escaping = false;
  let text;
  try {
    text = serializeNodes([node]);
  } finally {
    escaping = true;
  }
  try {
    const back = parser.parse(text, { ...env }).content;
    if (back.childCount === 1 && back.firstChild.eq(node)) return text;
  } catch {}
  return serializeNodes([node]);
}

// Where each block read from the note now starts in the editor's document
// (null once removed), kept up to date with every change (editor.js), so a
// touched block is still known by the text it came from.
export function mapBlocks(loaded, mapping) {
  for (const b of loaded.blocks) {
    if (b.pos === null) continue;
    const r = mapping.mapResult(b.pos, 1);
    b.pos = r.deletedAfter && r.deletedBefore ? null : r.pos;
  }
}

// A touched block keeps its own text except where it was changed: the
// change between the block as first read and now, both written from the
// tree, is carried over onto the source text where the two line up.
function merge(source, before, after, node, env) {
  if (before === source || before === after)
    return before === after ? source : after;
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (
    s < max - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++;
  const runs = alignment(before, source);
  if (!runs) return after;
  const from = mapOffset(runs, p, true);
  const to = mapOffset(runs, before.length - s, false);
  if (from === null || to === null || from > to) return after;
  const merged =
    source.slice(0, from) + after.slice(p, after.length - s) + source.slice(to);
  try {
    const back = parser.parse(merged, { ...env }).content;
    if (back.childCount === 1 && back.firstChild.eq(node)) return merged;
  } catch {}
  return after;
}
// Runs of equal text between a and b ([aFrom, aTo, bFrom]), by Myers' diff;
// null when they differ too much to line up.
function alignment(a, b, limit = 1500) {
  const n = a.length;
  const m = b.length;
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  // Walk back to collect the diagonal runs.
  const runs = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const down =
      k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]);
    const pk = down ? k + 1 : k - 1;
    const px = prev[offset + pk];
    const py = px - pk;
    const sx = down ? px : px + 1;
    const sy = down ? py + 1 : py;
    if (x > sx) runs.push([sx, x, sy]);
    x = px;
    y = py;
  }
  if (x > 0) runs.push([0, x, 0]);
  return runs.reverse();
}
// An offset in a, in b: only where a run of equal text holds it.
function mapOffset(runs, i, start) {
  for (const [aFrom, aTo, bFrom] of runs)
    if (start ? aFrom <= i && i < aTo : aFrom < i && i <= aTo)
      return bFrom + (i - aFrom);
  for (const [aFrom, aTo, bFrom] of runs)
    if (aFrom <= i && i <= aTo) return bFrom + (i - aFrom);
  return null;
}

// The note as Markdown, and where each top-level block starts in it.
export function write(doc, loaded) {
  let out = loaded.lead;
  let next = 0;
  const starts = [];
  const kept = [];
  // The note ends as it did (a new note with one line break); a block that
  // was last and no longer is gets a blank line after it.
  const endGap = () => (loaded.blocks.length ? loaded.blocks.at(-1).gap : "\n");
  const gapAfter = (b, last) =>
    last ? endGap() : b === loaded.blocks.at(-1) || !b.gap ? "\n\n" : b.gap;
  doc.forEach((node, pos, i) => {
    // An untouched block is the same node (or an equal one after undo).
    let hit = -1;
    for (let k = next; k < loaded.blocks.length; k++) {
      const b = loaded.blocks[k];
      if (b.text !== null && (b.node === node || b.node.eq(node))) {
        hit = k;
        break;
      }
    }
    const last = i === doc.childCount - 1;
    starts.push(out.length);
    if (hit >= 0) {
      const b = loaded.blocks[hit];
      next = hit + 1;
      out += b.text + gapAfter(b, last);
      kept.push(true);
      return;
    }
    const origin = loaded.blocks.find((b) => b.pos === pos && b.text !== null);
    const written = writeBlock(node, loaded.env);
    out += origin
      ? merge(
          origin.text,
          writeBlock(origin.node, loaded.env),
          written,
          node,
          loaded.env,
        )
      : written;
    out += origin ? gapAfter(origin, last) : last ? endGap() : "\n\n";
    kept.push(false);
  });
  return { text: out, starts, kept };
}

// Insert text at pos as typing would (with the marks there) and keep the
// blocks' places (for tests and tools).
export function insertText(doc, loaded, pos, text) {
  const marks = doc.resolve(pos).marks();
  const tr = new Transform(doc).insert(pos, schema.text(text, marks));
  mapBlocks(loaded, tr.mapping);
  return tr.doc;
}

// Markdown text read as blocks (to close an open formula or block).
export function parseBlocks(text, env = {}) {
  try {
    return parser.parse(text, { ...env }).content.content;
  } catch {
    return [];
  }
}
