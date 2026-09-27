import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import tasks from "markdown-it-task-lists";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import { decorateCodeBlocks } from "./code-blocks.js";
import { decorateTextColors } from "./text-colors.js";

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
const mathCache = new Map();
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
  const key = display + source;
  if (mathCache.has(key)) return mathCache.get(key);
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
  if (mathCache.size >= 256) mathCache.delete(mathCache.keys().next().value);
  if (source.length < 20000) mathCache.set(key, html);
  return html;
}
export function createParser() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight: (code, lang) =>
      lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        : "",
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
  md.renderer.rules.folio_math = (_tokens, index) =>
    `<span class="formula">${math(_tokens[index].content, false)}</span>`;
  md.renderer.rules.folio_math_block = (tokens, index, _options, env) =>
    `<div class="math-block" ${attrs(tokens[index])}>${math(tokens[index].content.split(env.mathPipe).join("|"), true)}</div>\n`;
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
          let cursor = inlineCursors.get(range) ?? from;
          for (const child of token.children || []) {
            if (child.type === "text" || child.type === "code_inline") {
              const at = state.src.indexOf(child.content, cursor);
              if (
                child.content &&
                at >= cursor &&
                at + child.content.length <= to
              ) {
                child.meta = { from: at, to: at + child.content.length };
                cursor = at + child.content.length;
              }
            } else if (child.type === "folio_math") {
              const at = state.src.indexOf(
                child.markup + child.content,
                cursor,
              );
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
    return t.meta
      ? `<span data-text-from="${t.meta.from}" data-text-to="${t.meta.to}">${content}</span>`
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
    return `<span class="formula" ${range}>${math(t.content.split(env.mathPipe).join("|"), t.markup === "$$")}</span>`;
  };
  return md;
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
export function renderMarkdown(source, fileId = null) {
  const env = {};
  let raw = parser.render(source, env);
  raw = raw.split(env.mathPipe).join("|");
  const clean = DOMPurify.sanitize(raw, {
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
  template.innerHTML = clean;
  decorateTextColors(template.content);
  for (const table of template.content.querySelectorAll("table")) {
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "表格，可横向滚动");
    table.before(scroll);
    scroll.append(table);
  }
  for (const input of template.content.querySelectorAll("input")) {
    if (input.type !== "checkbox") input.remove();
    else input.disabled = true;
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
      img.alt = (img.alt || "图片") + "（远程图片默认禁用）";
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
      button.setAttribute("aria-label", "折叠 " + node.textContent);
      button.setAttribute("aria-expanded", "true");
      node.prepend(button);
      const rail = document.createElement("button");
      rail.className = "section-rail";
      rail.type = "button";
      rail.setAttribute(
        "aria-label",
        "切换章节折叠：" + node.textContent.replace(/^▾/, ""),
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
    summary.textContent = `${count} 块`;
    summary.setAttribute("aria-hidden", "true");
    section.firstElementChild.append(summary);
  }
  return { html: template.innerHTML, headings: env.headings || [] };
}
