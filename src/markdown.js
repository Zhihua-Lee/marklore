import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import tasks from "markdown-it-task-lists";
import { highlightCode } from "./highlighting.js";
import { createFormulaHydrator } from "./formula-hydration.js";
import { decorateSortableTables } from "./table-sort.js";
import DOMPurify from "dompurify";
import { decorateCodeBlocks } from "./code-blocks.js";
import { decorateTextColors } from "./text-colors.js";
import { t } from "../desktop/i18n.mjs";

export function lineOffsets(source) {
  const offsets = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === "\n") offsets.push(i + 1);
  offsets.push(source.length);
  return offsets;
}
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// KaTeX (~256 KB) loads on first use, so startup and math-free notes skip it.
// Until it arrives, formulas stay as their TeX source (never cached as such).
let katex = null,
  katexLoad = null;
export function loadMath() {
  return (katexLoad ??= import("katex").then((module) => {
    katex = module.default;
  }));
}
export const mathReady = () => katex !== null;
// Cheap pre-check for callers that must render synchronously after loading.
export const mayContainMath = (text) => /\$|\\[([]/.test(text);
const mathCache = new Map();
let mathCacheBytes = 0;
const mathDOMCache = new Map();
let mathDOMBytes = 0;
function formulaMarkup(source, display, env) {
  if (!env?.mathFragments) return math(source, display);
  const html = env.deferMath ? null : math(source, display);
  const key = env.editNonce + ":" + env.mathFragments.length;
  env.mathFragments.push({
    key,
    html,
    source,
    display,
    sourceKey: String(display) + source,
  });
  return `<span data-folio-formula="${key}"></span>`;
}
function formulaFragment(html) {
  let fragment = mathDOMCache.get(html);
  if (fragment) mathDOMCache.delete(html);
  else {
    fragment = DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      ADD_TAGS: ["annotation", "semantics"],
      ADD_ATTR: ["encoding"],
      ADD_URI_SAFE_ATTR: ["d"],
    });
    mathDOMBytes += html.length * 2;
  }
  mathDOMCache.set(html, fragment);
  while (mathDOMBytes > 12 * 1024 * 1024 || mathDOMCache.size > 1024) {
    const oldest = mathDOMCache.keys().next().value;
    mathDOMBytes -= oldest.length * 2;
    mathDOMCache.delete(oldest);
  }
  return fragment.cloneNode(true);
}
function escapedDisplayMath(source) {
  let result = "";
  for (let i = 0; i < source.length;) {
    if (source[i] !== "\\") {
      result += source[i++];
      continue;
    }
    // Markdown escapes in a copied display block are not TeX escapes. Limit
    // repairs to that envelope, and keep literal text arguments byte-for-byte.
    const text = source
      .slice(i)
      .match(/^\\(?:text[a-zA-Z]*|operatorname\*?)\s*\{/);
    if (text) {
      let end = i + text[0].length,
        depth = 1;
      while (end < source.length && depth) {
        if (source[end] === "\\") end++;
        else if (source[end] === "{") depth++;
        else if (source[end] === "}") depth--;
        end++;
      }
      result += source.slice(i, end);
      i = end;
      continue;
    }
    let end = i + 1;
    while (source[end] === "\\") end++;
    if (end - i > 1) {
      if (end - i === 2 && /[,;!]/.test(source[end] || "")) {
        result += "\\" + source[end];
        i = end + 1;
      } else {
        // In particular, preserve aligned/matrix row separators.
        result += source.slice(i, end);
        i = end;
      }
      continue;
    }
    if (
      (source[i + 1] === "_" &&
        /[a-zA-Z0-9}\]]/.test(source[i - 1] || "") &&
        /[a-zA-Z0-9{\\]/.test(source[i + 2] || "")) ||
      (source[i + 1] === "*" && /\^\s*(?:\{\s*)?$/.test(source.slice(0, i)))
    ) {
      result += source[i + 1];
      i += 2;
    } else result += source[i++];
  }
  return result;
}
function math(source, display) {
  if (!katex) {
    loadMath();
    return `<span class="math-pending">${escape(source)}</span>`;
  }
  const key = display + source;
  if (mathCache.has(key)) {
    const cached = mathCache.get(key);
    mathCache.delete(key);
    mathCache.set(key, cached);
    return cached;
  }
  const normalized = source.replace(
    /\\(begin|end)\{(?:align\*?|equation\*?|gather\*?)\}/g,
    "\\$1{aligned}",
  );
  let html;
  try {
    html = katex.renderToString(normalized, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: "ignore",
      maxExpand: 1000,
      maxSize: 30,
      output: "htmlAndMathml",
    });
  } catch (e) {
    html = `<span class="math-error" title="${escape(e.message)}">${escape(source)}</span>`;
  }
  if (source.length < 20000) {
    mathCache.set(key, html);
    mathCacheBytes += (key.length + html.length) * 2;
    while (mathCacheBytes > 12 * 1024 * 1024 || mathCache.size > 2048) {
      const oldest = mathCache.keys().next().value;
      mathCacheBytes -= (oldest.length + mathCache.get(oldest).length) * 2;
      mathCache.delete(oldest);
    }
  }
  return html;
}
export function createParser() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight: highlightCode,
  })
    .use(footnote)
    .use(tasks, { enabled: false });
  // Keep table delimiters inside math away from the table tokenizer without changing offsets.
  // The private character is chosen absent from the source and removed inside math tokens.
  md.core.ruler.before("block", "folio_math_tables", (state) => {
    let code = 0xe000;
    while (state.src.includes(String.fromCharCode(code)) && code < 0xf8ff)
      code++;
    const marker = String.fromCharCode(code);
    state.env.mathPipe = marker;
    let fence = null;
    state.src = state.src
      .split("\n")
      .map((line) => {
        const f = line.match(/^\s*(`{3,}|~{3,})/);
        if (f) {
          if (!fence) fence = f[1][0];
          else if (f[1][0] === fence) fence = null;
          return line;
        }
        if (fence || !line.includes("|")) return line;
        return line.replace(
          /`[^`]*`|\\\([\s\S]*?\\\)|\$\$[^$]+\$\$|\$[^$\n]+\$/g,
          (part) =>
            part[0] === "`" ? part : part.replace(/(?<!\\)\|/g, marker),
        );
      })
      .join("\n");
  });
  md.inline.ruler.before("escape", "folio_math", (state, silent) => {
    const start = state.pos,
      rest = state.src.slice(start);
    const delimiter = rest.startsWith("\\(")
      ? "\\("
      : rest.startsWith("$$")
        ? "$$"
        : rest[0] === "$"
          ? "$"
          : null;
    if (!delimiter) return false;
    if (
      delimiter === "$" &&
      (/\s/.test(rest[1] || " ") || /\d/.test(state.src[start - 1] || ""))
    )
      return false;
    const close = delimiter === "\\(" ? "\\)" : delimiter;
    let end = start + delimiter.length;
    while ((end = state.src.indexOf(close, end)) >= 0) {
      if (state.src[end - 1] !== "\\") break;
      end += close.length;
    }
    if (
      end < 0 ||
      state.src.slice(start, end).includes("\n\n") ||
      (delimiter === "$" && /\s/.test(state.src[end - 1]))
    )
      return false;
    if (!silent) {
      const token = state.push("folio_math", "span", 0);
      token.content = state.src.slice(start + delimiter.length, end);
      token.markup = delimiter;
    }
    state.pos = end + close.length;
    return true;
  });
  md.block.ruler.before(
    "fence",
    "folio_math_block",
    (state, start, end, silent) => {
      const from = state.bMarks[start] + state.tShift[start],
        first = state.src.slice(from, state.eMarks[start]);
      const env = first.match(
        /^\\begin\{(align\*?|aligned|equation\*?|gather\*?|gathered)\}/,
      );
      const escaped = first.trim() === "\\\\[";
      const opening = escaped
        ? "\\\\["
        : first.startsWith("$$")
          ? "$$"
          : first.startsWith("\\[")
            ? "\\["
            : env?.[0] || null;
      if (!opening) return false;
      if (silent && !escaped) return true;
      const close = escaped
        ? "\\\\]"
        : opening === "$$"
          ? "$$"
          : env
            ? "\\end{" + env[1] + "}"
            : "\\]";
      let text = first.slice(opening.length),
        line = start,
        closeIndex = text.indexOf(close);
      while (closeIndex < 0 && line + 1 < end) {
        line++;
        text +=
          "\n" +
          state.src.slice(
            state.bMarks[line] + state.tShift[line],
            state.eMarks[line],
          );
        closeIndex = text.indexOf(close);
      }
      if (closeIndex < 0 || text.slice(closeIndex + close.length).trim())
        return false;
      if (
        escaped &&
        (!/\\[a-zA-Z]+/.test(text.slice(0, closeIndex)) ||
          text.slice(text.lastIndexOf("\n", closeIndex) + 1, closeIndex).trim())
      )
        return false;
      if (silent) return true;
      const token = state.push("folio_math_block", "div", 0);
      token.block = true;
      const body = text.slice(0, closeIndex);
      token.content = escaped
        ? escapedDisplayMath(body)
        : (env ? opening : "") + body + (env ? close : "");
      token.map = [start, line + 1];
      state.line = line + 1;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
  md.renderer.rules.folio_math_block = (tokens, index, _options, env) =>
    `<div class="math-block" ${attrs(tokens[index])}>${formulaMarkup(tokens[index].content.split(env.mathPipe).join("|"), true, env)}</div>\n`;
  md.core.ruler.after("inline", "folio_locations", (state) => {
    const offsets = lineOffsets(state.src);
    let headingIndex = 0;
    const slugs = new Map();
    const inlineCursors = new Map();
    state.env.headings = [];
    state.env.editNonce = crypto.randomUUID();
    state.env.editBlocks = [];
    let enclosingMap = null;
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.map) enclosingMap = token.map;
      if (token.type === "inline" && !token.map && enclosingMap)
        token.map = [...enclosingMap];
      if (token.map) {
        const from = offsets[token.map[0]],
          to = offsets[token.map[1]] ?? state.src.length;
        token.attrSet("data-from", String(from));
        token.attrSet("data-to", String(to));
        if (
          token.level === 0 &&
          [
            "paragraph_open",
            "heading_open",
            "bullet_list_open",
            "ordered_list_open",
            "blockquote_open",
            "table_open",
            "fence",
            "code_block",
            "folio_math_block",
            "hr",
          ].includes(token.type)
        ) {
          const key = state.env.editNonce + ":" + state.env.editBlocks.length;
          token.attrSet("data-folio-edit", key);
          state.env.editBlocks.push({ key, from, to, kind: token.type });
        }
        if (token.type === "inline") {
          const range = `${from}:${to}`;
          const inlineSource = state.src.slice(from, to);
          let cursor = inlineCursors.get(range) ?? from;
          for (const child of token.children || []) {
            if (child.type === "text" || child.type === "code_inline") {
              const relative = inlineSource.indexOf(
                child.content,
                cursor - from,
              );
              const at = relative < 0 ? -1 : from + relative;
              if (
                child.content &&
                at >= cursor &&
                at + child.content.length <= to
              ) {
                child.meta = { from: at, to: at + child.content.length };
                cursor = at + child.content.length;
              }
            } else if (child.type === "folio_math") {
              const relative = inlineSource.indexOf(
                child.markup + child.content,
                cursor - from,
              );
              const at = relative < 0 ? -1 : from + relative;
              if (at >= cursor && at < to) {
                child.meta = {
                  from: at,
                  to: at + child.content.length + child.markup.length * 2,
                };
                cursor = child.meta.to;
              }
            }
          }
          inlineCursors.set(range, cursor);
          markInlineSpans(state.src, token.children || [], from, to);
        }
      }
      if (token.type === "heading_open") {
        const label = (state.tokens[i + 1]?.content || "")
          .split(state.env.mathPipe)
          .join("|");
        const plain = (state.tokens[i + 1]?.children || [])
          .filter((child) => child.type !== "html_inline")
          .map(
            (child) => child.content || (child.type === "softbreak" ? " " : ""),
          )
          .join("");
        let slug =
          ((state.tokens[i + 1]?.children || []).some(
            (child) => child.type === "html_inline",
          )
            ? plain
            : label
          )
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .trim()
            .replace(/\s+/g, "-") || "section";
        const count = slugs.get(slug) || 0;
        slugs.set(slug, count + 1);
        if (count) slug += "-" + count;
        token.attrSet("id", slug);
        token.attrSet("data-heading", String(headingIndex++));
        state.env.headings.push({
          label,
          id: slug,
          level: Number(token.tag[1]),
          from: Number(token.attrGet("data-from")),
        });
      }
    }
  });
  for (const name of ["fence", "code_block"]) {
    const original = md.renderer.rules[name];
    md.renderer.rules[name] = (tokens, i, options, env, renderer) =>
      original(tokens, i, options, env, renderer).replace(
        /^<pre/,
        `<pre ${attrs(tokens[i])}`,
      );
  }
  md.renderer.rules.text = (tokens, i) => {
    const t = tokens[i],
      content = escape(t.content);
    // Task lists strip "[ ] " from the item's first text after it was located.
    const from = t.meta && t.meta.to - t.content.length;
    return t.meta && from >= t.meta.from
      ? `<span data-text-from="${from}" data-text-to="${t.meta.to}">${content}</span>`
      : content;
  };
  const codeInline = md.renderer.rules.code_inline;
  md.renderer.rules.code_inline = (tokens, i, options, env, self) => {
    const t = tokens[i];
    if (t.meta) {
      t.attrSet("data-text-from", String(t.meta.from));
      t.attrSet("data-text-to", String(t.meta.to));
    }
    return codeInline(tokens, i, options, env, self);
  };
  md.renderer.rules.folio_math = (tokens, i, _options, env) => {
    const t = tokens[i],
      range = t.meta ? `data-from="${t.meta.from}" data-to="${t.meta.to}"` : "";
    return `<span class="formula" ${range}>${formulaMarkup(t.content.split(env.mathPipe).join("|"), t.markup === "$$", env)}</span>`;
  };
  return md;
}
// Source spans of inline markup (emphasis, links, images, inline code), so a
// copy from the preview can keep whole constructs and drop cut-off markers.
// data-src-from/to cover the markers; data-src-inner-* the content between
// them. Found by a forward scan anchored on the already located text leaves;
// any mismatch (escapes, entities) stops the scan and leaves the rest unmarked.
const pairedMarkup = new Set(["strong", "em", "s", "mark", "ins"]);
function markInlineSpans(src, children, from, to) {
  let cursor = from;
  const open = [];
  const find = (text, limit = to) => {
    const at = src.indexOf(text, cursor);
    return at >= cursor && at + text.length <= limit ? at : -1;
  };
  const span = (token, outer, inner) => {
    token.attrSet("data-src-from", String(outer[0]));
    token.attrSet("data-src-to", String(outer[1]));
    token.attrSet("data-src-inner-from", String(inner[0]));
    token.attrSet("data-src-inner-to", String(inner[1]));
  };
  for (const child of children) {
    const kind = child.type.replace(/_(open|close)$/, "");
    if (child.meta) {
      if (child.meta.from < cursor) return;
      if (child.type === "code_inline") {
        const start = src.lastIndexOf(child.markup, child.meta.from),
          end = src.indexOf(child.markup, child.meta.to);
        if (start < cursor || end < 0 || end + child.markup.length > to) return;
        span(
          child,
          [start, end + child.markup.length],
          [child.meta.from, child.meta.to],
        );
        cursor = end + child.markup.length;
      } else cursor = child.meta.to;
    } else if (child.type === "text" || child.type === "code_inline") {
      if (child.content) return;
    } else if (child.type === "html_inline") {
      const at = find(child.content);
      if (at < 0) return;
      cursor = at + child.content.length;
    } else if (child.type === "image") {
      const at = find("!["),
        close = at < 0 ? -1 : closingBracket(src, at + 1, to),
        end = close < 0 ? -1 : linkEnd(src, close, to);
      if (end < 0) return;
      span(child, [at, end], [at + 2, close]);
      cursor = end;
    } else if (pairedMarkup.has(kind) || kind === "link") {
      const autolink = child.markup === "autolink",
        linkify = child.markup === "linkify";
      if (child.nesting === 1) {
        const marker =
          kind === "link"
            ? autolink
              ? "<"
              : linkify
                ? ""
                : "["
            : child.markup;
        const at = marker ? find(marker) : cursor;
        if (at < 0) return;
        cursor = at + marker.length;
        open.push({ child, at, inner: cursor });
      } else {
        const entry = open.pop();
        if (!entry || entry.child.type !== kind + "_open") return;
        let inner = cursor,
          end;
        if (kind !== "link") {
          inner = find(child.markup);
          end = inner < 0 ? -1 : inner + child.markup.length;
        } else if (autolink) {
          inner = find(">");
          end = inner < 0 ? -1 : inner + 1;
        } else if (linkify) end = inner;
        else {
          inner = find("]");
          end = inner < 0 ? -1 : linkEnd(src, inner, to);
        }
        if (end < 0) return;
        span(entry.child, [entry.at, end], [entry.inner, inner]);
        cursor = end;
      }
    }
  }
}
// Index of the "]" closing the label that opens at `open` ("[").
function closingBracket(src, open, limit) {
  for (let i = open + 1, depth = 1; i < limit; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "[") depth++;
    else if (src[i] === "]" && !--depth) return i;
  }
  return -1;
}
// End of a link after its label's "]": "(dest title)", "[ref]" or nothing.
function linkEnd(src, close, limit) {
  if (src[close + 1] === "[") {
    const end = src.indexOf("]", close + 2);
    return end < 0 || end >= limit ? -1 : end + 1;
  }
  if (src[close + 1] !== "(") return close + 1;
  for (let i = close + 2, depth = 1, angle = false; i < limit; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === "<") angle = true;
    else if (src[i] === ">") angle = false;
    else if (angle) continue;
    else if (src[i] === "(") depth++;
    else if (src[i] === ")" && !--depth) return i + 1;
  }
  return -1;
}
function attrs(t) {
  return (t.attrs || []).map(([k, v]) => `${k}="${escape(v)}"`).join(" ");
}
const parser = createParser();
const outlineParser = createParser().set({ html: true, linkify: false });
outlineParser.renderer.rules.html_inline = () => "";
outlineParser.renderer.rules.image = (tokens, i) => escape(tokens[i].content);
export function renderHeadingLabel(label) {
  const env = {};
  const html = outlineParser
    .renderInline(label, env)
    .split(env.mathPipe)
    .join("|");
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["annotation", "semantics"],
    ADD_ATTR: ["encoding"],
    ADD_URI_SAFE_ATTR: ["d"],
    FORBID_TAGS: ["a", "img", "input", "button"],
    ALLOW_DATA_ATTR: false,
  });
}
export function parseHeadings(source) {
  const env = {};
  parser.parse(source, env);
  return env.headings || [];
}
export function renderMarkdown(
  source,
  fileId = null,
  { deferMath = false, interactiveTasks = false } = {},
) {
  const env = { mathFragments: [], deferMath };
  let raw = parser.render(source, env);
  raw = raw.split(env.mathPipe).join("|");
  const clean = DOMPurify.sanitize(raw, {
    RETURN_DOM_FRAGMENT: true,
    ADD_TAGS: ["annotation", "semantics"],
    ADD_ATTR: ["encoding"],
    // SVG path data is geometry, not a URL (KaTeX stretchy arrows/accents).
    ADD_URI_SAFE_ATTR: ["d"],
    FORBID_TAGS: [
      "style",
      "iframe",
      "form",
      "button",
      "textarea",
      "select",
      "video",
      "audio",
      "object",
      "embed",
    ],
    FORBID_ATTR: [
      "srcset",
      "autofocus",
      "contenteditable",
      "formaction",
      "form",
      "name",
    ],
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|tel):|[a-z]:[\\/]|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
  const template = document.createElement("template");
  template.content.append(clean);
  // Sanitize generated math once, then clone it. Author HTML still goes through
  // the full sanitizer; only per-render unpredictable markers accept cached math.
  const formulas = new Map(
    env.mathFragments.map((formula) => [formula.key, formula]),
  );
  const deferred = new Map();
  // This stable marker is internal, never accepted from authored HTML.
  for (const element of template.content.querySelectorAll("[data-folio-math]"))
    element.removeAttribute("data-folio-math");
  for (const marker of template.content.querySelectorAll(
    "[data-folio-formula]",
  )) {
    const formula = formulas.get(marker.getAttribute("data-folio-formula"));
    marker.removeAttribute("data-folio-formula");
    if (!formula) continue;
    if (deferMath) {
      deferred.set(formula.sourceKey, formula);
      marker.setAttribute("data-folio-math", formula.sourceKey);
      marker.textContent = formula.source;
    } else marker.replaceWith(formulaFragment(formula.html));
  }
  decorateTextColors(template.content);
  for (const table of template.content.querySelectorAll("table")) {
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", t("表格，可横向滚动"));
    table.before(scroll);
    scroll.append(table);
  }
  decorateSortableTables(template.content);
  for (const input of template.content.querySelectorAll("input")) {
    if (input.type !== "checkbox") input.remove();
    // Only the live preview's task boxes toggle their source (app.js); authored
    // HTML checkboxes, exports and hover previews stay inert.
    else if (
      interactiveTasks &&
      input.classList.contains("task-list-item-checkbox") &&
      input.closest("li.task-list-item[data-from]")
    ) {
      input.disabled = false;
      input.setAttribute("aria-label", t("切换任务完成状态"));
    } else input.disabled = true;
  }
  for (const img of template.content.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (!src) continue;
    img.decoding = "async";
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) continue;
    if (fileId && !/^(?:https?:|javascript:|blob:)/i.test(src))
      img.src = `folio-asset://${fileId}/?path=${encodeURIComponent(src)}`;
    else {
      img.removeAttribute("src");
      img.alt = t("{alt}（远程图片默认禁用）", {
        alt: img.alt || t("图片"),
      });
    }
  }
  for (const a of template.content.querySelectorAll("a")) {
    a.removeAttribute("target");
    a.setAttribute("rel", "noreferrer");
  }
  decorateCodeBlocks(template.content);
  // Only parser-authenticated markers become editing targets. Raw note HTML
  // cannot forge a source range or inject an editor control.
  for (const element of template.content.querySelectorAll(
    "[data-edit-from],[data-edit-to],[data-edit-kind]",
  )) {
    for (const name of ["data-edit-from", "data-edit-to", "data-edit-kind"])
      element.removeAttribute(name);
  }
  const editable = new Map(
    (env.editBlocks || []).map((block) => [block.key, block]),
  );
  for (const element of template.content.querySelectorAll(
    "[data-folio-edit]",
  )) {
    const block = editable.get(element.getAttribute("data-folio-edit"));
    element.removeAttribute("data-folio-edit");
    if (!block) continue;
    const target = element.closest(".code-block") || element;
    target.dataset.editFrom = String(block.from);
    target.dataset.editTo = String(block.to);
    target.dataset.editKind = block.kind;
  }
  // HTML is sanitized before heading controls are created. Source mapping stays on headings/blocks.
  const fragment = template.content,
    stack = [];
  for (const node of [...fragment.childNodes]) {
    const level =
      node.nodeType === 1 && /^H[1-6]$/.test(node.tagName)
        ? Number(node.tagName[1])
        : 0;
    if (level) {
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      const section = document.createElement("section");
      section.className = "note-section";
      section.dataset.foldKey = node.id;
      section.dataset.level = String(level);
      const parent = stack.at(-1)?.body || fragment;
      parent.append(section);
      section.append(node);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fold";
      button.textContent = "▾";
      button.setAttribute(
        "aria-label",
        t("折叠 {heading}", { heading: node.textContent }),
      );
      button.setAttribute("aria-expanded", "true");
      node.prepend(button);
      const rail = document.createElement("button");
      rail.className = "section-rail";
      rail.type = "button";
      rail.setAttribute(
        "aria-label",
        t("切换章节折叠：{heading}", {
          heading: node.textContent.replace(/^▾/, ""),
        }),
      );
      rail.setAttribute("aria-expanded", "true");
      section.append(rail);
      const body = document.createElement("div");
      body.className = "section-body";
      section.append(body);
      stack.push({ level, body });
    } else if (stack.length) stack.at(-1).body.append(node);
  }
  // Count rendered blocks bottom-up once; scrolling and hovering need no work.
  for (const section of [
    ...fragment.querySelectorAll(".note-section"),
  ].reverse()) {
    const body = section.querySelector(":scope > .section-body");
    const count = [...body.children].reduce(
      (sum, child) =>
        sum +
        (child.classList.contains("note-section")
          ? Number(child.dataset.blockCount)
          : 1),
      0,
    );
    section.dataset.blockCount = String(count);
    const summary = document.createElement("span");
    summary.className = "section-summary";
    summary.textContent = count === 1 ? t("1 块") : t("{count} 块", { count });
    summary.setAttribute("aria-hidden", "true");
    section.firstElementChild.append(summary);
  }
  const html = template.innerHTML;
  return {
    html,
    headings: env.headings || [],
    fragment: template.content,
    // Reconcile the small source-mapped skeleton before expanding formula DOM.
    // Unchanged leaves keep their existing math, selection and decoded images.
    hydrate: deferMath
      ? createFormulaHydrator(
          deferred,
          (formula) => formulaFragment(math(formula.source, formula.display)),
          {
            progressive:
              source.length > 80000 || env.mathFragments.length > 200,
            ready: mathReady,
            load: loadMath,
          },
        )
      : null,
    // Account conservatively for future expanded math, not just placeholder HTML.
    bytes:
      html.length * 2 +
      (deferMath
        ? env.mathFragments.reduce(
            (n, f) => n + Math.max(8192, f.source.length * 256),
            0,
          )
        : 0),
    formulaCount: env.mathFragments.length,
  };
}
