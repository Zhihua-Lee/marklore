// A note's properties (the YAML front matter at its top), read and drawn as
// a card: folded, one quiet line under the title (the date, the notebook and
// section); unfolded, one row per property. A note is named by its leading
// level-one heading; a `title` property is then one of the rows. In a note
// without such a heading, `title` is the page's title, shown above the card
// rather than as one of its rows. The editor
// (rich/properties.js) draws the same card and changes single values; a
// value it cannot read here (nested YAML, a block of text) is edited as
// source. Only simple YAML is read: `key: value` lines, `[a, b]` lists and
// `- item` lists.
import { t, getLanguage } from "../desktop/i18n.mjs";
import { icon } from "./icons.js";

const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const KEY =
  /^(?:"([^"]+)"|'([^']+)'|([^\s#:'"-][^:]*?|-[^\s:][^:]*?))\s*:(?:[ \t]+(.*?))?\s*$/;
const DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/;

function unquote(v) {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(v);
  if (m) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return m[1];
    }
  }
  const s = /^'((?:[^']|'')*)'$/.exec(v);
  return s ? s[1].replace(/''/g, "'") : v;
}
function flowItems(v) {
  return v
    .slice(1, -1)
    .split(",")
    .map((x) => unquote(x.trim()))
    .filter(Boolean);
}

// The fields with the lines each takes ([start, end) in the YAML's lines).
export function readProperties(yaml) {
  const lines = yaml.split(/\r?\n/);
  const fields = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = /^\s/.test(line) ? null : KEY.exec(line);
    if (!m) {
      // Indented lines, and `- item` lines, belong to the field above.
      if (fields.length) fields.at(-1).end = i + 1;
      continue;
    }
    fields.push({
      key: m[1] ?? m[2] ?? m[3],
      raw: (m[4] ?? "").replace(/\s+#.*$/, ""),
      start: i,
      end: i + 1,
    });
  }
  for (const f of fields) {
    const more = lines.slice(f.start + 1, f.end).filter((l) => l.trim());
    const raw = f.raw;
    if (more.length) {
      if (!raw && more.every((l) => /^\s*-\s/.test(l))) {
        f.kind = "list";
        f.block = true;
        f.items = more.map((l) => unquote(l.replace(/^\s*-\s+/, "").trim()));
      } else {
        f.kind = "complex";
        f.text = [raw, ...more.map((l) => l.trim())].filter(Boolean).join("\n");
      }
    } else if (/^\[.*\]$/.test(raw)) {
      f.kind = "list";
      f.items = flowItems(raw);
    } else if (/^[|>{]/.test(raw)) {
      f.kind = "complex";
      f.text = raw;
    } else {
      const value = unquote(raw);
      f.text = value;
      if (/^(true|false)$/i.test(raw)) f.kind = "bool";
      else if (DATE.test(value)) f.kind = "date";
      else if (/^https?:\/\/\S+$/.test(value)) f.kind = "url";
      else f.kind = "text";
    }
  }
  return fields;
}

// Known keys: a name in the interface's language and an icon. The rest show
// as written, with their kind's icon.
const KNOWN = [
  [["title"], "title", "text"],
  [
    ["created", "date_created", "creation", "created_at"],
    "created",
    "calendar",
  ],
  [
    ["modified", "updated", "lastmod", "date_modified", "updated_at"],
    "modified",
    "clock",
  ],
  [["date"], "date", "calendar"],
  [["tags", "tag", "keywords"], "tags", "tag"],
  [["notebook"], "notebook", "notebook"],
  [["section"], "section", "folder"],
  [["author", "authors"], "author", "text"],
  [["aliases", "alias"], "aliases", "listBullet"],
  [["description", "summary"], "description", "text"],
  [["category", "categories"], "category", "tag"],
  [["source", "url", "link"], "source", "link"],
  [["draft"], "draft", "check"],
];
const LABELS = () => ({
  title: t("标题"),
  created: t("创建时间"),
  modified: t("修改时间"),
  date: t("日期"),
  tags: t("标签"),
  notebook: t("笔记本"),
  section: t("分区"),
  author: t("作者"),
  aliases: t("别名"),
  description: t("描述"),
  category: t("分类"),
  source: t("来源"),
  draft: t("草稿"),
});
const KIND_ICON = {
  date: "calendar",
  list: "listBullet",
  url: "link",
  bool: "check",
  text: "text",
  complex: "text",
};
function known(key) {
  const k = key.toLowerCase();
  return KNOWN.find(([keys]) => keys.includes(k));
}
// Keys kept for tools (an exporter's ids and levels): under "N more".
export const isTechnical = (key) =>
  /^(onenote_id|level|id|uuid)$|^_|_id$/i.test(key);

function dateParts(value) {
  const m = DATE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { y: +y, mo: +mo, d: +d, time: h ? `${h}:${mi}` : "" };
}
// As written (no time zone shift): "2026年3月14日 星期六 14:32".
export function formatDate(value, weekday = false) {
  const p = dateParts(value);
  if (!p) return value;
  const locale = getLanguage() === "en" ? "en-US" : "zh-CN";
  const day = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(weekday ? { weekday: "long" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(p.y, p.mo - 1, p.d)));
  return p.time ? `${day} ${p.time}` : day;
}

function valueHtml(f) {
  const empty = `<span class="fm-empty">${escape(t("空"))}</span>`;
  switch (f.kind) {
    case "list":
      return f.items.length
        ? f.items
            .map((x) => `<span class="fm-pill">${escape(x)}</span>`)
            .join("")
        : empty;
    case "bool": {
      const on = /^true$/i.test(f.text);
      return `<span class="fm-check" data-on="${on}" role="img" aria-label="${escape(on ? t("是") : t("否"))}"></span>`;
    }
    case "date":
      return escape(formatDate(f.text));
    case "url":
      return `<a href="${escape(f.text)}">${escape(f.text)}</a>`;
    default:
      if (!f.text) return empty;
      if (/^(notebook|section)$/i.test(f.key))
        return `<span class="fm-pill">${escape(f.text)}</span>`;
      return escape(f.text);
  }
}
function rowHtml(f, editable) {
  const k = known(f.key);
  const label = k ? LABELS()[k[1]] : f.key;
  const del = editable
    ? `<button type="button" class="fm-delete" data-action="delete" aria-label="${escape(t("删除属性 {key}", { key: f.key }))}" title="${escape(t("删除属性"))}">${icon("close")}</button>`
    : "";
  return (
    `<div class="fm-row" data-key="${escape(f.key)}" data-kind="${f.kind}">` +
    `<span class="fm-key" title="${escape(f.key)}">${icon(k ? k[2] : KIND_ICON[f.kind])}<span>${escape(label)}</span></span>` +
    `<span class="fm-value"${editable ? ' tabindex="0" role="button"' : ""}>${valueHtml(f)}</span>${del}</div>`
  );
}

// The `title` property, when it holds a single line of text.
export const titleField = (fields) =>
  fields.find(
    (f) =>
      f.key.toLowerCase() === "title" &&
      !["list", "bool", "complex"].includes(f.kind) &&
      f.text.trim(),
  );
// The card. In the reading view a <details> (its `attrs` carry the source
// map); in the editor (`editable`) the same, with buttons to change it.
// `heading`: the note's leading level-one heading (its one name,
// desktop/note-names.mjs), if it starts with one.
export function propertiesCard(
  yaml,
  { attrs = "", editable = false, open = false, heading = null } = {},
) {
  const all = readProperties(yaml);
  const title = titleField(all);
  // One name per note: a note that starts with a level-one heading is named
  // by it, and its `title` is one of the rows (seen unfolded). Without one,
  // `title` is the page's title, above the card.
  const titled = heading != null;
  const fields = title && !titled ? all.filter((f) => f !== title) : all;
  const page =
    title && !titled
      ? editable
        ? `<div class="fm-title" data-key="${escape(title.key)}" tabindex="0" role="button" title="${escape(t("点击修改标题"))}">${escape(title.text)}</div>`
        : `<div class="fm-title" role="heading" aria-level="1">${escape(title.text)}</div>`
      : "";
  // Nothing but the title: the reading view shows the title alone (or,
  // under a heading that names the note, nothing).
  if (
    !editable &&
    (!fields.length || (titled && fields.length === 1 && fields[0] === title))
  )
    return page
      ? page.replace("<div ", () => `<div${attrs} `) + "\n"
      : `<div class="fm-none"${attrs} hidden></div>\n`;
  const get = (...keys) =>
    fields.find((f) => keys.includes(f.key.toLowerCase()) && f.text);
  const when = get("created", "date", "modified", "updated");
  const place = ["notebook", "section"]
    .map((k) => get(k)?.text)
    .filter(Boolean);
  const line = [];
  if (when)
    line.push(
      `<span class="fm-when">${escape(when.kind === "date" ? formatDate(when.text, true) : when.text)}</span>`,
    );
  if (place.length)
    line.push(
      `<span class="fm-place">${place.map(escape).join(' <span aria-hidden="true">›</span> ')}</span>`,
    );
  line.push(
    `<span class="fm-count">${escape(t("{n} 项属性", { n: fields.length }))}</span>`,
  );
  const shown = fields.filter((f) => !isTechnical(f.key));
  const tools = fields.filter((f) => isTechnical(f.key));
  let rows = shown.map((f) => rowHtml(f, editable)).join("");
  if (tools.length)
    rows += `<details class="fm-more"><summary>${escape(t("另 {n} 项", { n: tools.length }))}</summary>${tools.map((f) => rowHtml(f, editable)).join("")}</details>`;
  if (editable)
    rows +=
      `<div class="fm-actions"><button type="button" data-action="add">${icon("plus")}<span>${escape(t("添加属性"))}</span></button>` +
      `<button type="button" data-action="source">${escape(t("编辑源码"))}</button></div>`;
  return `${page}<details class="front-matter"${attrs}${open ? " open" : ""}><summary>${line.join("")}</summary><div class="fm-rows">${rows}</div></details>\n`;
}

// ---- Changing the YAML, line by line (the rest is kept as written) ----

const NUMBER = /^[-+]?(\d[\d_]*)?\.?\d+(e[-+]?\d+)?$/i;
const plain = (s) =>
  !s ||
  !(
    /^[\s\-?:,[\]{}#&*!|>'"%@`]|\s$|: | #/.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    NUMBER.test(s)
  );
export const yamlScalar = (s) => (plain(s) ? s : JSON.stringify(s));
const flowItem = (s) => (plain(s) && !/[,[\]]/.test(s) ? s : JSON.stringify(s));
const keyText = (k) =>
  /^[^\s#:'"-][^:]*$/.test(k) && !/\s$/.test(k) ? k : JSON.stringify(k);

function fieldLines(key, kind, text, block) {
  const k = keyText(key);
  if (kind === "list") {
    const items = text
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (block && items.length)
      return [`${k}:`, ...items.map((x) => `  - ${yamlScalar(x)}`)];
    return [`${k}: [${items.map(flowItem).join(", ")}]`];
  }
  if (kind === "bool") return [`${k}: ${text === "true" ? "true" : "false"}`];
  // A number stays a number.
  if (kind === "number" && NUMBER.test(text)) return [`${k}: ${text}`];
  return [text ? `${k}: ${yamlScalar(text)}` : `${k}:`];
}
// The text to edit a value as: a list's items joined by commas.
export const editText = (f) =>
  f.kind === "list" ? f.items.join(", ") : (f.text ?? "");

export function setProperty(yaml, key, text) {
  const lines = yaml.split(/\r?\n/);
  const f = readProperties(yaml).find((x) => x.key === key);
  if (!f) return addProperty(yaml, key, text);
  // A date stays a date only while it reads as one; otherwise it is text.
  const kind =
    f.kind === "list" || f.kind === "bool"
      ? f.kind
      : NUMBER.test(f.raw)
        ? "number"
        : "text";
  lines.splice(
    f.start,
    f.end - f.start,
    ...fieldLines(key, kind, text, f.block),
  );
  return lines.join("\n");
}
export function addProperty(yaml, key, text) {
  key = key.trim();
  if (!key) return yaml;
  if (readProperties(yaml).some((x) => x.key === key))
    return setProperty(yaml, key, text);
  const lines = yaml ? yaml.split(/\r?\n/) : [];
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  lines.push(...fieldLines(key, "text", text.trim()));
  return lines.join("\n");
}
export function removeProperty(yaml, key) {
  const lines = yaml.split(/\r?\n/);
  const f = readProperties(yaml).find((x) => x.key === key);
  if (!f) return yaml;
  lines.splice(f.start, f.end - f.start);
  return lines.join("\n");
}

// ---- The front matter of a whole note ----

// A note's front matter: `yaml` between `open` and `close` (the `---`
// lines), `from`..`to` being where the YAML lies in the note. Null when the
// note has none (the same rule as the reading view's, markdown.js).
const FRONT =
  /^(---[ \t]*\r?\n)([\s\S]*?)\r?\n((?:---|\.\.\.)[ \t]*)(?:\r?\n|$)/;
export function splitFront(text) {
  if (!text.startsWith("---")) return null;
  const m = FRONT.exec(text);
  if (!m) return null;
  const yaml = m[2];
  const from = m[1].length;
  return { yaml, from, to: from + yaml.length, open: m[1], close: m[3] };
}
// The note with its front matter's YAML replaced, or a front matter put at
// the top when it had none. The note's line breaks (\n or \r\n) are kept.
export function withFront(text, yaml) {
  const front = splitFront(text);
  const eol = /\r\n/.test(front ? text.slice(0, front.to + 2) : text)
    ? "\r\n"
    : "\n";
  const body = yaml.replace(/\r?\n/g, eol);
  if (front) return text.slice(0, front.from) + body + text.slice(front.to);
  const head = `---${eol}${body}${eol}---${eol}`;
  return text ? head + eol + text : head;
}

// ---- Default properties: a small template ----

// Every line of the template is `key: value`; a value may hold {title}
// (the note's name without .md), {date} (2026-03-14), {time} (14:32) and
// {datetime} (2026-03-14 14:32), all in local time.
export const DEFAULT_TEMPLATE = "title: {title}\ncreated: {datetime}\ntags: []";
const pad = (n, w = 2) => String(n).padStart(w, "0");
const localDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function expandTemplate(value, { now = new Date(), title = "" } = {}) {
  const fill = {
    title,
    date: localDate(now),
    time: localTime(now),
    datetime: `${localDate(now)} ${localTime(now)}`,
  };
  return String(value).replace(
    /\{(title|date|time|datetime)\}/g,
    (_, k) => fill[k],
  );
}
// The template's properties added to `yaml` where it has no property of
// the same name (in any case): nothing it has is changed. Values are
// written as the card writes them (yamlScalar), so a title with a colon is
// quoted.
export function mergeTemplate(yaml, template, context = {}) {
  const have = new Set(
    readProperties(yaml || "").map((f) => f.key.toLowerCase()),
  );
  const source = String(template || "").split(/\r?\n/);
  const added = [];
  for (const f of readProperties(String(template || ""))) {
    const key = f.key.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    const fill = (s) => expandTemplate(s, context);
    if (f.kind === "list")
      added.push(
        ...fieldLines(f.key, "list", f.items.map(fill).join(", "), f.block),
      );
    else if (f.kind === "bool") added.push(...fieldLines(f.key, "bool", f.raw));
    else if (f.kind === "complex" && fill(f.text) === f.text)
      // Nested YAML or a block of text, with nothing to fill: as written.
      added.push(...source.slice(f.start, f.end));
    else if (NUMBER.test(f.raw))
      added.push(...fieldLines(f.key, "number", f.raw));
    else added.push(...fieldLines(f.key, "text", fill(f.text ?? f.raw).trim()));
  }
  if (!added.length) return yaml || "";
  const lines = yaml ? yaml.split(/\r?\n/) : [];
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return [...lines, ...added].join("\n");
}
// A new note's text from the template (empty when it has no property): the
// properties, then a blank line to write below.
export function templateNote(template, context) {
  const yaml = mergeTemplate("", template, context);
  return yaml ? withFront("", yaml) + "\n" : "";
}

// ---- Keeping `modified` up to date ----

const MODIFIED = new Set(KNOWN.find(([, name]) => name === "modified")[0]);
const STAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:([T ])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(?:(\s*)(Z|[+-]\d{2}(:?)\d{2}))?$/;
// `now` written the way `value` is: date only, or with minutes, seconds
// and the same number of decimals; with Z in UTC, with an offset as the
// local one, written alike (+08:00 or +0800); without either in local time.
// Null for a value that is not such a date (it is left as it is).
export function restampValue(value, now = new Date()) {
  const m = STAMP.exec(String(value).trim());
  if (!m) return null;
  const [, , , , sep, , , sec, frac, gap = "", zone, colon] = m;
  if (zone && !sep) return null;
  const utc = zone === "Z";
  const part = (local, universal) => (utc ? universal : local).call(now);
  const D = Date.prototype;
  let out = `${part(D.getFullYear, D.getUTCFullYear)}-${pad(part(D.getMonth, D.getUTCMonth) + 1)}-${pad(part(D.getDate, D.getUTCDate))}`;
  if (!sep) return out;
  out += `${sep}${pad(part(D.getHours, D.getUTCHours))}:${pad(part(D.getMinutes, D.getUTCMinutes))}`;
  if (sec !== undefined) {
    out += `:${pad(part(D.getSeconds, D.getUTCSeconds))}`;
    if (frac !== undefined)
      out +=
        "." +
        pad(now.getMilliseconds(), 3)
          .padEnd(frac.length, "0")
          .slice(0, frac.length);
  }
  if (!zone) return out;
  if (utc) return out + gap + "Z";
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return out + gap + sign + pad(Math.floor(abs / 60)) + colon + pad(abs % 60);
}
// The note as saving should write it: when it changed since `base` (what
// is on disk), each modified-time property (`modified`, `updated` and the
// like) it already has, holding a date, is set to now. A property whose
// value was changed by hand since `base` is left alone, and none is added.
export function restampNote(text, base, now = new Date()) {
  if (text === base) return text;
  const front = splitFront(text);
  if (!front) return text;
  const before = new Map(
    readProperties(splitFront(base ?? "")?.yaml ?? "").map((f) => [
      f.key,
      f.raw,
    ]),
  );
  let yaml = front.yaml;
  for (const f of readProperties(yaml)) {
    if (!MODIFIED.has(f.key.toLowerCase()) || f.end - f.start !== 1) continue;
    if (before.get(f.key) !== f.raw) continue;
    const next = restampValue(f.text ?? "", now);
    if (next !== null && next !== f.text) yaml = setProperty(yaml, f.key, next);
  }
  return yaml === front.yaml ? text : withFront(text, yaml);
}
