// Find and replace in the editor of Edit mode (Ctrl+F): the same compact
// bar as the source pane's (editor-search.js, same look and keys), over the
// note as drawn. Matches are found in each block's text (a formula or other
// drawn piece counts as one character no text matches) and shown as
// decorations; replacing types over a match, so it keeps the formatting
// there and the rest of the note stays as written.
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { icon } from "../icons.js";
import { t } from "../../desktop/i18n.mjs";

const key = new PluginKey("find");
const MAX = 1000;
const LEAF = "￼";

// The query as a global RegExp (null when empty or invalid).
function pattern({ search, caseSensitive, wholeWord, regexp }) {
  if (!search) return null;
  let source = regexp ? search : search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (wholeWord)
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, "gu" + (caseSensitive ? "" : "i"));
  } catch {
    return undefined;
  }
}
// Every match [from, to] in the document, block by block.
function findAll(doc, re) {
  const out = [];
  if (!re) return out;
  doc.descendants((node, pos) => {
    if (out.length >= MAX) return false;
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, "\n", LEAF);
    re.lastIndex = 0;
    for (let m; (m = re.exec(text));) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      if (!m[0].includes(LEAF))
        out.push([pos + 1 + m.index, pos + 1 + m.index + m[0].length]);
      if (out.length >= MAX) break;
    }
    return false;
  });
  return out;
}

export function findPlugin() {
  let panel = null;
  const plugin = new Plugin({
    key,
    state: {
      init: () => ({ query: null, matches: [] }),
      apply(tr, value, _old, state) {
        const query = tr.getMeta(key);
        if (query !== undefined)
          return {
            query,
            matches: query ? findAll(state.doc, pattern(query)) : [],
          };
        if (tr.docChanged && value.query)
          return {
            query: value.query,
            matches: findAll(state.doc, pattern(value.query)),
          };
        return value;
      },
    },
    props: {
      decorations(state) {
        const { matches } = key.getState(state);
        if (!matches.length) return null;
        const { from, to } = state.selection;
        return DecorationSet.create(
          state.doc,
          matches.map(([a, b]) =>
            Decoration.inline(a, b, {
              class:
                a === from && b === to
                  ? "rich-find rich-find-current"
                  : "rich-find",
            }),
          ),
        );
      },
    },
    view(view) {
      panel = createPanel(view);
      return {
        update: () => panel.refresh(),
        destroy: () => panel.destroy(),
      };
    },
  });
  return {
    plugin,
    open: (text) => panel?.open(text),
    isOpen: () => panel?.isOpen(),
  };
}

function createPanel(view) {
  const host = document.createElement("div");
  host.id = "rich-find";
  host.hidden = true;
  host.innerHTML =
    `<div class="folio-search" role="search">` +
    `<div class="folio-search-row">` +
    `<button type="button" class="folio-search-expand" data-act="expand" aria-expanded="false" aria-label="${t("显示替换")}" title="${t("替换")}">${icon("chevronRight")}</button>` +
    `<input type="text" name="search" placeholder="${t("查找")}" aria-label="${t("查找")}" spellcheck="false">` +
    `<span class="folio-search-count" aria-live="polite"></span>` +
    `<label class="folio-search-toggle" title="${t("区分大小写")}"><input type="checkbox" name="case" aria-label="${t("区分大小写")}"><span aria-hidden="true">Aa</span></label>` +
    `<label class="folio-search-toggle" title="${t("全字匹配")}"><input type="checkbox" name="word" aria-label="${t("全字匹配")}"><span aria-hidden="true"><u>ab</u></span></label>` +
    `<label class="folio-search-toggle" title="${t("正则表达式")}"><input type="checkbox" name="re" aria-label="${t("正则表达式")}"><span aria-hidden="true">.*</span></label>` +
    `<button type="button" data-act="prev" aria-label="${t("上一个")}" title="${t("上一个（Shift+Enter）")}">↑</button>` +
    `<button type="button" data-act="next" aria-label="${t("下一个")}" title="${t("下一个（Enter）")}">↓</button>` +
    `<button type="button" class="folio-search-close" data-act="close" aria-label="${t("关闭查找")}" title="${t("关闭（Esc）")}">${icon("close")}</button>` +
    `</div>` +
    `<div class="folio-search-row folio-search-replace" hidden>` +
    `<input type="text" name="replace" placeholder="${t("替换为")}" aria-label="${t("替换为")}" spellcheck="false">` +
    `<button type="button" data-act="replace" title="${t("替换当前（Enter）")}">${t("替换")}</button>` +
    `<button type="button" data-act="replaceAll" title="${t("全部替换（Ctrl+Alt+Enter）")}">${t("全部替换")}</button>` +
    `</div></div>`;
  (view.dom.closest("#panes") || document.body).append(host);
  const field = (name) => host.querySelector(`[name="${name}"]`);
  const find = field("search");
  const replace = field("replace");
  const count = host.querySelector(".folio-search-count");
  const expand = host.querySelector(".folio-search-expand");
  const replaceRow = host.querySelector(".folio-search-replace");
  const read = () => ({
    search: find.value,
    caseSensitive: field("case").checked,
    wholeWord: field("word").checked,
    regexp: field("re").checked,
  });
  const matches = () => key.getState(view.state).matches;

  function setReplace(open) {
    replaceRow.hidden = !open;
    expand.setAttribute("aria-expanded", String(open));
    expand.setAttribute("aria-label", open ? t("隐藏替换") : t("显示替换"));
  }
  function select([from, to]) {
    const tr = view.state.tr.setSelection(
      TextSelection.create(view.state.doc, from, to),
    );
    view.dispatch(tr);
    view.domAtPos(from).node?.parentElement?.scrollIntoView?.({
      block: "center",
    });
  }
  // The match at or after the caret (dir 1), or before it (dir -1).
  // The next match after the selection (dir 1) or the one before it (-1);
  // `here`: a match starting at the selection counts (the query changed).
  function go(dir, here = false) {
    const list = matches();
    if (!list.length) return;
    const { from, to } = view.state.selection;
    const hit =
      dir > 0
        ? (list.find(
            ([a]) => a > from || (a === from && (here || to === from)),
          ) ?? list[0])
        : (list.findLast(([a]) => a < from) ?? list.at(-1));
    select(hit);
  }
  function commit(move) {
    view.dispatch(view.state.tr.setMeta(key, read()));
    if (move) go(1, true);
  }
  // The text to put in place of a match (a regex's $1... filled in).
  function replacement(from, to) {
    const query = read();
    const text = view.state.doc.textBetween(from, to, "\n", LEAF);
    if (!query.regexp) return replace.value;
    const re = pattern(query);
    re.lastIndex = 0;
    return text.replace(
      new RegExp(re.source, re.flags.replace("g", "")),
      replace.value,
    );
  }
  function replaceOne() {
    const { from, to } = view.state.selection;
    const hit = matches().find(([a, b]) => a === from && b === to);
    if (!hit) return go(1);
    const text = replacement(from, to);
    const tr = view.state.tr.insertText(text, from, to);
    // On to the next match after the text put in.
    tr.setSelection(TextSelection.create(tr.doc, from + text.length));
    view.dispatch(tr);
    go(1, true);
  }
  function replaceEvery() {
    const list = matches();
    if (!list.length) return;
    const tr = view.state.tr;
    for (const [from, to] of [...list].reverse())
      tr.insertText(replacement(from, to), from, to);
    view.dispatch(tr);
  }
  function refresh() {
    if (host.hidden) return;
    const query = key.getState(view.state).query;
    if (!query?.search) return void (count.textContent = "");
    if (pattern(query) === undefined)
      return void (count.textContent = t("正则有误"));
    const list = matches();
    const { from, to } = view.state.selection;
    const index = list.findIndex(([a, b]) => a === from && b === to);
    count.textContent = list.length
      ? `${index + 1 || "–"}/${list.length}${list.length >= MAX ? "+" : ""}`
      : t("无结果");
    host
      .querySelector(".folio-search")
      .classList.toggle("folio-search-none", !list.length);
  }
  function close() {
    host.hidden = true;
    view.dispatch(view.state.tr.setMeta(key, null));
    view.focus();
  }

  find.addEventListener("input", () => commit(true));
  replace.addEventListener("input", refresh);
  for (const name of ["case", "word", "re"])
    field(name).addEventListener("change", () => commit(true));
  host.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      return close();
    }
    if (e.key === "F3") {
      e.preventDefault();
      return go(e.shiftKey ? -1 : 1);
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.target === replace) {
      if ((e.ctrlKey || e.metaKey) && e.altKey) replaceEvery();
      else replaceOne();
    } else go(e.shiftKey ? -1 : 1);
  });
  host.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "expand") {
      setReplace(replaceRow.hidden);
      if (!replaceRow.hidden) replace.focus();
    } else if (act === "prev") go(-1);
    else if (act === "next") go(1);
    else if (act === "replace") replaceOne();
    else if (act === "replaceAll") replaceEvery();
    else if (act === "close") close();
  });
  return {
    open(text) {
      host.hidden = false;
      if (text) find.value = text;
      find.focus();
      find.select();
      commit(Boolean(text));
      refresh();
    },
    isOpen: () => !host.hidden,
    refresh,
    destroy: () => host.remove(),
  };
}
