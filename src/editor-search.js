// The editor's find/replace panel: the same compact floating bar as find in
// the rendered note, in place of CodeMirror's default form (whose inputs and
// checkboxes took the app's full-width form styles). It drives the stock
// @codemirror/search state and commands, so Ctrl+F, F3, Ctrl+G and Esc keep
// working. Field names match the default panel's (search, case, re, word,
// replace).
import { EditorView, runScopeHandlers } from "@codemirror/view";
import {
  search,
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from "@codemirror/search";
import { icon } from "./icons.js";
import { t } from "../desktop/i18n.mjs";
import "./editor-search.css";

const MAX_COUNT = 1000;

function* matches(query, state) {
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next())
    yield next.value;
}

function createPanel(view) {
  const dom = document.createElement("div");
  dom.className = "cm-search folio-search";
  dom.setAttribute("role", "search");
  dom.innerHTML =
    `<div class="folio-search-row">` +
    `<button type="button" class="folio-search-expand" data-act="expand" aria-expanded="false" aria-label="${t("显示替换")}" title="${t("替换")}">${icon("chevronRight")}</button>` +
    `<input type="text" name="search" main-field="true" placeholder="${t("查找")}" aria-label="${t("查找")}" spellcheck="false">` +
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
    `</div>`;
  const field = (name) => dom.querySelector(`[name="${name}"]`),
    find = field("search"),
    replace = field("replace"),
    count = dom.querySelector(".folio-search-count"),
    expand = dom.querySelector(".folio-search-expand"),
    replaceRow = dom.querySelector(".folio-search-replace");
  let query = getSearchQuery(view.state);

  function show(q) {
    query = q;
    find.value = q.search;
    replace.value = q.replace;
    field("case").checked = q.caseSensitive;
    field("word").checked = q.wholeWord;
    field("re").checked = q.regexp;
    if (q.replace) setReplace(true);
  }
  function setReplace(open) {
    replaceRow.hidden = !open;
    expand.setAttribute("aria-expanded", String(open));
    expand.setAttribute("aria-label", open ? t("隐藏替换") : t("显示替换"));
  }
  function read() {
    return new SearchQuery({
      search: find.value,
      caseSensitive: field("case").checked,
      wholeWord: field("word").checked,
      regexp: field("re").checked,
      replace: replace.value,
    });
  }
  // Typing moves to the first match at or after the cursor, as in the reader.
  function jump() {
    if (!query.valid) return;
    const from = view.state.selection.main.from;
    let first = null,
      hit = null;
    for (const m of matches(query, view.state)) {
      first ??= m;
      if (m.from >= from) {
        hit = m;
        break;
      }
    }
    hit ??= first;
    if (hit)
      view.dispatch({
        selection: { anchor: hit.from, head: hit.to },
        effects: EditorView.scrollIntoView(hit.from, { y: "center" }),
        userEvent: "select.search",
      });
  }
  function commit({ move = false } = {}) {
    const next = read();
    if (next.eq(query)) return;
    query = next;
    view.dispatch({ effects: setSearchQuery.of(next) });
    if (move) jump();
  }
  function recount() {
    if (!query.search) return void (count.textContent = "");
    if (!query.valid) return void (count.textContent = t("正则有误"));
    const { from, to } = view.state.selection.main;
    let total = 0,
      current = 0;
    for (const m of matches(query, view.state)) {
      total++;
      if (m.from === from && m.to === to) current = total;
      if (total >= MAX_COUNT) break;
    }
    count.textContent = total
      ? `${current || "–"}/${total}${total >= MAX_COUNT ? "+" : ""}`
      : t("无结果");
    dom.classList.toggle("folio-search-none", !total);
  }

  find.addEventListener("input", () => commit({ move: true }));
  replace.addEventListener("input", () => commit());
  for (const name of ["case", "word", "re"])
    field(name).addEventListener("change", () => commit({ move: true }));
  dom.addEventListener("keydown", (e) => {
    if (runScopeHandlers(view, e, "search-panel")) return e.preventDefault();
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.target === replace) {
      if (e.ctrlKey && e.altKey) replaceAll(view);
      else replaceNext(view);
    } else if (e.target === find || e.target.type === "checkbox")
      (e.shiftKey ? findPrevious : findNext)(view);
  });
  dom.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "expand") {
      setReplace(replaceRow.hidden);
      if (!replaceRow.hidden) replace.focus();
    } else if (act === "prev") findPrevious(view);
    else if (act === "next") findNext(view);
    else if (act === "replace") replaceNext(view);
    else if (act === "replaceAll") replaceAll(view);
    else if (act === "close") closeSearchPanel(view);
  });

  show(query);
  return {
    dom,
    top: true,
    mount() {
      find.focus();
      find.select();
      recount();
    },
    update(update) {
      for (const tr of update.transactions)
        for (const effect of tr.effects)
          if (effect.is(setSearchQuery) && !effect.value.eq(query))
            show(effect.value);
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setSearchQuery)),
        )
      )
        recount();
    },
  };
}

export const editorSearch = search({ top: true, createPanel });
