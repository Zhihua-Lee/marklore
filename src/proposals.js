import { t } from "../desktop/i18n.mjs";
import {
  locateEdits,
  applyChanges,
  revisions,
  diffSequence,
  sourceHunks,
  words,
} from "../desktop/proposal-edits.mjs";
import { renderDocument } from "./document-render.js";
import { icon } from "./icons.js";
import "./proposals.css";

// Changes proposed by AI assistants through Marklore's MCP server
// (desktop/mcp.mjs). A note with proposals shows a bar above it; "Review"
// enters the review and "Exit review" leaves it, the decisions kept.
//
// A review is shown along two independent choices: rendered or source, and
// the whole note or only the changed passages. Rendered and whole is the
// note with the changes marked in it (removed words struck in red, new words
// underlined in green); rendered and changed passages is each passage before
// and after, side by side; source is the Markdown, whole or in hunks.
//
// Decisions are staged: each change is accepted or rejected, and can be
// taken back until the last one is decided; that one, or accepting or
// rejecting all at once, ends the review: the accepted changes are applied
// as one undoable change, saved unless the note has unsaved changes of the
// reader's own (those are not saved behind their back: the changes stay in
// the draft for Ctrl+S), and the assistant hears every decision at once.
// Leaving a review half done keeps its decisions for the next visit.

// Assistants by the names they give in MCP's clientInfo.
const clients = {
  "claude-code": "Claude Code",
  "claude-ai": "Claude",
  codex: "Codex",
  "codex-mcp-client": "Codex",
  "gemini-cli-mcp-client": "Gemini CLI",
  "cursor-vscode": "Cursor",
};
export const clientName = (name) => clients[name] || name || "AI";
// Who made a proposal: an assistant, or one run in the background on marks.
const authorOf = (p) =>
  p.background
    ? t("{client}（后台）", { client: clientName(p.client) })
    : clientName(p.client);

const sameFile = (a, b) =>
  !!a &&
  !!b &&
  a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();

// Where the edits do not fit the note's current text any more, for the AI.
const reasons = {
  missing: "the old text is no longer in the note",
  ambiguous: "the old text now occurs more than once",
  overlap: "two edits overlap",
  empty: "an edit has no old text",
  unchanged: "an edit changes nothing",
};

// The two choices of how a review is shown.
const renders = () => [
  ["rendered", t("渲染")],
  ["source", t("源码")],
];
const scopes = () => [
  ["full", t("全文")],
  ["changes", t("仅改动")],
];
// The last choice made, for the next review.
let lastLook = { render: "rendered", scope: "full" };
const lookOf = (shown) =>
  shown.kind === "note"
    ? shown.render === "source"
      ? "source"
      : "note"
    : shown.render === "rendered"
      ? shown.scope === "full"
        ? "revise"
        : "compare"
      : "source";

// The edits still waiting (the others were decided one by one), each with
// its index in the proposal.
const pendingEdits = (p) =>
  p.edits
    .map((edit, index) => ({ edit, index }))
    .filter(({ index }) => !p.results || p.results[index] === "pending");

// The waiting edits' places in the note: as locateEdits, with `indexes`
// (each change's edit in the proposal) and errors numbered as the AI sent
// the edits.
function locate(text, p) {
  const waiting = pendingEdits(p);
  const located = locateEdits(
    text,
    waiting.map(({ edit }) => edit),
  );
  if (located.error)
    return {
      error: { ...located.error, edit: waiting[located.error.edit].index },
    };
  return { ...located, indexes: located.order.map((k) => waiting[k].index) };
}

export function createProposals({
  api,
  bar,
  button,
  content,
  getActive,
  tabs,
  add,
  closeTab,
  activate,
  view,
  dirty,
  save,
  setMode,
  render,
  restore,
  report,
  run,
  showContext,
}) {
  if (!api?.proposals) return null;
  let list = [],
    painted = null,
    seen = null,
    // The proposal shown in the bar, per tab.
    current = new Map();
  // Decisions staged until the review is finished: proposal → (edit index,
  // or 0 for a new note) → "accepted" | "rejected".
  const staged = new Map();
  const decisionsOf = (p) => {
    if (!staged.has(p.id)) staged.set(p.id, new Map());
    return staged.get(p.id);
  };
  // What the reader tells the AI with a rejection, staged the same way: a
  // reason per change (edit index → text), a note on the whole proposal.
  const why = new Map(),
    notes = new Map();
  const reasonsOf = (p) => {
    if (!why.has(p.id)) why.set(p.id, new Map());
    return why.get(p.id);
  };
  const forget = (id) => {
    staged.delete(id);
    why.delete(id);
    notes.delete(id);
  };

  const forDoc = (doc) =>
    !doc
      ? []
      : doc.proposalNote
        ? list.filter((p) => p.id === doc.proposalNote)
        : list.filter((p) => p.kind === "edit" && sameFile(p.file, doc.path));

  async function refresh() {
    list = await api.proposals();
    const fresh = seen ? list.filter((p) => !seen.has(p.id)) : [];
    seen = new Set(list.map((p) => p.id));
    for (const id of [...staged.keys(), ...why.keys(), ...notes.keys()])
      if (!list.some((p) => p.id === id)) forget(id);
    if (fresh.length === 1)
      report(
        t("{client} 提议修改《{name}》", {
          client: authorOf(fresh[0]),
          name: fresh[0].name,
        }),
      );
    else if (fresh.length > 1)
      report(t("收到 {count} 条 AI 提议", { count: fresh.length }));
    // A proposal withdrawn (or decided elsewhere) while it was reviewed.
    const doc = getActive();
    if (doc?.preview && !list.some((p) => p.id === doc.preview.id)) {
      leave();
      report(t("这条提议已被撤回或已处理"));
    }
    for (const tab of [...tabs])
      if (tab.proposalNote && !list.some((p) => p.id === tab.proposalNote)) {
        tab.proposalNote = null;
        if (!dirty(tab) && !tab.text) closeTab(tab);
      }
    painted = null;
    paint();
  }

  function paintButton() {
    button.hidden = !list.length;
    const label = t("AI 提议（{count}）", { count: list.length });
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.count = String(list.length);
  }

  function chosen(doc) {
    const mine = forDoc(doc);
    const id = current.get(doc.id);
    return mine.find((p) => p.id === id) || mine[0] || null;
  }
  // The changes under review, by their edit index (one for a new note).
  const itemsOf = (shown) => (shown.kind === "note" ? [0] : shown.indexes);

  // The bar of the active note. Its controls keep their places: a control
  // that does not apply is disabled, not taken away, and labels do not
  // change with the state.
  function paint() {
    paintButton();
    const doc = getActive(),
      mine = forDoc(doc),
      p = doc && chosen(doc);
    const located = p?.kind === "edit" ? locate(doc.text, p) : null;
    const shown = p && doc.preview?.id === p.id ? doc.preview : null;
    const decisions = p ? decisionsOf(p) : null;
    // Rendering repaints after each pause in typing: rebuild only on change.
    const state = JSON.stringify([
      doc?.id,
      p?.id,
      mine.length,
      p?.results,
      shown && [shown.render, shown.scope, shown.at, itemsOf(shown)],
      decisions && [...decisions],
      p && [...reasonsOf(p)],
      p && notes.get(p.id),
      p && dirty(doc),
      located?.error?.edit,
    ]);
    if (state === painted) return;
    painted = state;
    bar.replaceChildren();
    bar.hidden = !p;
    bar.classList.toggle("reviewing", !!shown);
    if (!p) return;
    const element = (tag, className, label) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (label) {
        el.setAttribute("role", "group");
        el.setAttribute("aria-label", label);
      }
      return el;
    };
    const action = (into, label, fn, { primary, pressed, disabled } = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (primary) b.className = "primary";
      if (pressed !== undefined)
        b.setAttribute("aria-pressed", String(pressed));
      b.disabled = !!disabled;
      b.onclick = run(fn);
      into.append(b);
      return b;
    };
    const arrow = (into, name, label, fn, disabled) => {
      const b = action(into, "", fn, { disabled });
      b.innerHTML = icon(name);
      b.className = "icon";
      b.setAttribute("aria-label", label);
      b.title = label;
      return b;
    };
    // A rejection's other choice, on a small arrow beside its button: to
    // reject and say why.
    const options = (into, label, disabled, items) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon proposal-more";
      b.innerHTML = icon("chevronRight");
      b.setAttribute("aria-label", label);
      b.title = label;
      b.disabled = !!disabled;
      b.onclick = (event) => {
        const at = b.previousElementSibling.getBoundingClientRect();
        showContext(event, items(at));
      };
      into.append(b);
      return b;
    };
    const counter = (into, value, className = "proposal-count") => {
      const count = element("span", className);
      count.textContent = value;
      into.append(count);
      return count;
    };

    // First row: who proposes what; enter or leave the review, or finish it.
    const head = element("div", "proposal-head");
    const text = element("span", "proposal-text");
    const mark = element("span", "proposal-mark");
    mark.innerHTML = icon("spark");
    const who = document.createElement("strong");
    who.textContent = authorOf(p);
    text.append(
      mark,
      who,
      document.createTextNode(
        p.kind === "note"
          ? t(" 提议新建这篇笔记：")
          : located?.error
            ? t(" 的提议与笔记当前内容对不上：")
            : t(" 提议修改："),
      ),
    );
    const summary = element("span", "proposal-summary");
    summary.textContent = located?.error
      ? t("第 {n} 处修改的原文已改变", { n: located.error.edit + 1 })
      : p.summary;
    summary.title = p.summary;
    text.append(summary);
    head.append(text);
    if (mine.length > 1) {
      const at = mine.indexOf(p);
      const step = (d) => () => {
        leave();
        current.set(doc.id, mine[(at + d + mine.length) % mine.length].id);
        paint();
      };
      const switcher = element("span", "proposal-switch", t("切换提议"));
      arrow(switcher, "chevronLeft", t("上一条提议"), step(-1));
      counter(switcher, `${at + 1} / ${mine.length}`);
      arrow(switcher, "chevronRight", t("下一条提议"), step(1));
      head.append(switcher);
    }
    const ends = element("span", "proposal-ends");
    head.append(ends);
    bar.append(head);
    if (located?.error) {
      action(ends, t("关闭提议"), () =>
        decide(p, {
          status: "failed",
          error: `Not applied: ${reasons[located.error.reason]} (edit ${located.error.edit + 1}). Read the note again and propose anew.`,
        }),
      );
      return;
    }
    if (!shown) {
      action(ends, t("审阅"), () => preview(doc, p), { primary: true });
      return;
    }
    const items = itemsOf(shown);
    const decidedCount = items.filter((ix) => decisions.has(ix)).length;
    counter(
      ends,
      t("已决定 {done} / {count}", { done: decidedCount, count: items.length }),
      "proposal-progress",
    );
    action(ends, t("退出审阅"), () => leave(doc)).title =
      t("回到笔记；已做的决定会保留");

    // Second row: how the review is shown, then the decisions: change by
    // change on the left, all at once on the right.
    const tools = element("div", "proposal-tools");
    const segment = (label, options, value, pick, disabled) => {
      const group = element("span", "proposal-segment", label);
      for (const [name, text] of options)
        action(group, text, () => pick(name), {
          pressed: value === name,
          disabled,
        });
      tools.append(group);
    };
    segment(t("呈现"), renders(), shown.render, (name) =>
      look(doc, { render: name }),
    );
    segment(
      t("范围"),
      scopes(),
      shown.kind === "note" ? "full" : shown.scope,
      (name) => look(doc, { scope: name }),
      shown.kind === "note",
    );
    tools.append(element("span", "proposal-gap"));
    const single = shown.kind === "note";
    const one = element("span", "proposal-one", t("逐处"));
    const n = items.length;
    arrow(
      one,
      "chevronLeft",
      t("上一处修改"),
      () => go(doc, shown.at - 1),
      single || n < 2,
    );
    counter(one, t("第 {i} / {n} 处", { i: shown.at + 1, n }));
    arrow(
      one,
      "chevronRight",
      t("下一处修改"),
      () => go(doc, shown.at + 1),
      single || n < 2,
    );
    const here = decisions.get(items[shown.at]);
    action(one, t("接受这处"), () => decideOne(doc, p, "accepted"), {
      pressed: here === "accepted",
      disabled: single,
    }).classList.add("proposal-accept");
    const reason = reasonsOf(p).get(items[shown.at]);
    const rejectHere = action(
      one,
      t("拒绝这处"),
      () => decideOne(doc, p, "rejected"),
      { pressed: here === "rejected", disabled: single },
    );
    rejectHere.classList.add("proposal-reject");
    if (here === "rejected" && reason)
      rejectHere.title = t("理由：{reason}", { reason });
    options(one, t("拒绝这处的选项"), single, (at) => [
      [t("拒绝"), () => decideOne(doc, p, "rejected", { keep: true })],
      [
        t("拒绝并说明…"),
        () =>
          ask(at, reason, (text) =>
            decideOne(doc, p, "rejected", { reason: text }),
          ),
      ],
    ]);
    tools.append(one);
    const all = element("span", "proposal-all", t("全部"));
    const own = p.kind === "edit" && dirty(doc);
    action(all, t("全部接受"), () => decideAll(doc, p, "accepted")).title = own
      ? t("笔记有未保存的修改：接受的修改写入草稿，按 Ctrl+S 一起保存")
      : t("写入全部修改并结束审阅");
    action(all, t("全部拒绝"), () => decideAll(doc, p, "rejected")).title =
      t("拒绝全部修改并结束审阅");
    options(all, t("全部拒绝的选项"), false, (at) => [
      [t("全部拒绝"), () => decideAll(doc, p, "rejected")],
      [
        t("全部拒绝并说明…"),
        () =>
          ask(at, "", (text) => decideAll(doc, p, "rejected", { note: text })),
      ],
    ]);
    tools.append(all);
    bar.append(tools);
  }

  // Review: the note as the proposal would leave it (read mode, read-only),
  // at change `at`.
  function preview(doc, p, { at = 0 } = {}) {
    if (doc !== getActive()) return;
    if (doc.mode !== "read") setMode("read");
    const before = doc.preview?.id === p.id ? doc.preview : null;
    let text,
      revs = [],
      indexes = [];
    if (p.kind === "note") text = p.text;
    else {
      const located = locate(doc.text, p);
      if (located.error) {
        if (before) leave(doc);
        return paint();
      }
      text = applyChanges(doc.text, located.changes);
      revs = revisions(doc.text, located.changes);
      indexes = located.indexes;
    }
    doc.preview = {
      id: p.id,
      kind: p.kind,
      text,
      before: p.kind === "note" ? "" : doc.text,
      name: p.name,
      render: before?.render || lastLook.render,
      scope: before?.scope || lastLook.scope,
      at: Math.max(0, Math.min(at, revs.length - 1)),
      revs,
      indexes,
      targets: [],
      anchor: before ? before.anchor : doc.anchor,
    };
    doc.htmlText = null;
    render();
    focus(doc);
    paint();
  }
  // Another way of showing the review (render, scope or both).
  function look(doc, choice) {
    const shown = doc.preview;
    if (!shown) return;
    const next = { render: shown.render, scope: shown.scope, ...choice };
    if (next.render === shown.render && next.scope === shown.scope) return;
    Object.assign(shown, next);
    lastLook = next;
    // The rendered note itself is the same: only the marks over it change.
    marks();
    focus(doc);
    paint();
  }
  // Change `at` in view, marked as the current one.
  function go(doc, at) {
    const shown = doc.preview;
    if (!shown?.revs.length) return;
    const n = shown.revs.length;
    shown.at = ((at % n) + n) % n;
    marks();
    focus(doc);
    paint();
  }
  function focus(doc) {
    const shown = doc.preview,
      rev = shown?.revs[shown.at];
    if (!rev) return;
    if (lookOf(shown) === "revise")
      restore(doc, { from: rev.from, y: 120 }, { expand: true });
    else shown.targets[shown.at]?.el?.scrollIntoView({ block: "center" });
  }
  // Back to the note itself, where it was read before the review; returns
  // that place (nothing when there was no review). Decisions stay staged.
  function leave(doc = getActive()) {
    if (!doc?.preview) return null;
    const anchor = doc.preview.anchor;
    doc.preview = null;
    doc.htmlText = null;
    if (doc === getActive()) {
      render();
      restore(doc, anchor);
      paint();
    }
    return anchor;
  }
  // The text the reader shows for a note under review.
  function shown(doc) {
    const p = doc.preview;
    return p ? { text: p.text } : null;
  }

  // A line under a button for what to tell the AI: Enter keeps it, Escape
  // or a click elsewhere drops it.
  function ask(at, initial, done) {
    document.querySelector(".proposal-reason")?.remove();
    const box = document.createElement("div");
    box.className = "proposal-reason";
    const field = document.createElement("input");
    field.type = "text";
    field.maxLength = 1000;
    field.value = initial || "";
    const hint = t("告诉 AI 为什么（Enter 确定，Esc 取消）");
    field.placeholder = hint;
    field.setAttribute("aria-label", hint);
    box.append(field);
    document.body.append(box);
    const width = Math.min(360, innerWidth - 16);
    box.style.width = width + "px";
    box.style.top = at.bottom + 6 + "px";
    box.style.left =
      Math.max(8, Math.min(at.left, innerWidth - width - 8)) + "px";
    const end = () => {
      box.remove();
      document.removeEventListener("pointerdown", outside, true);
    };
    const outside = (event) => !box.contains(event.target) && end();
    document.addEventListener("pointerdown", outside, true);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        const text = field.value.trim();
        end();
        run(() => done(text))();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        end();
      }
    });
    field.focus();
  }

  // One change accepted or rejected (again: taken back), then on to the next
  // one not decided yet. A rejection from its menu stays a rejection: with
  // `reason`, the reason given (none when empty); with `keep`, none.
  function decideOne(doc, p, status, { reason, keep = false } = {}) {
    const shown = doc.preview;
    if (!shown) return;
    const items = itemsOf(shown),
      decisions = decisionsOf(p),
      reasons = reasonsOf(p),
      ix = items[shown.at];
    const told = reason !== undefined || keep;
    if (decisions.get(ix) === status && !told) {
      decisions.delete(ix);
      reasons.delete(ix);
    } else {
      if (status === "rejected" && reason) reasons.set(ix, reason);
      else reasons.delete(ix);
      const again = decisions.get(ix) === status;
      decisions.set(ix, status);
      if (items.every((j) => decisions.has(j))) return finish(doc, p);
      if (again) {
        marks();
        return paint();
      }
      for (let k = 1; k < items.length; k++) {
        const j = (shown.at + k) % items.length;
        if (!decisions.has(items[j])) {
          shown.at = j;
          break;
        }
      }
    }
    marks();
    focus(doc);
    paint();
  }
  // All changes one way, which ends the review; a rejection may carry
  // `note` for the whole proposal (the reasons given change by change
  // stay with their changes).
  function decideAll(doc, p, status, { note } = {}) {
    const shown = doc.preview;
    if (!shown) return;
    const decisions = decisionsOf(p);
    for (const ix of itemsOf(shown)) decisions.set(ix, status);
    if (status === "rejected" && note) notes.set(p.id, note);
    else notes.delete(p.id);
    if (status === "accepted") reasonsOf(p).clear();
    return finish(doc, p);
  }

  async function decide(p, decision) {
    const doc = getActive();
    if (doc?.preview?.id === p.id) leave(doc);
    await api.decideProposal(p.id, decision);
    forget(p.id);
    if (decision.status === "rejected") report(t("已拒绝这条提议"));
    if (p.kind === "note" && doc?.proposalNote === p.id) {
      doc.proposalNote = null;
      closeTab(doc);
    }
    await refresh();
  }

  // Applies changes to the note as one undoable change and saves it unless
  // the reader has unsaved changes of their own; returns whether it saved.
  async function apply(doc, changes) {
    const own = dirty(doc);
    view.dispatch({
      changes,
      userEvent: "input.proposal",
      scrollIntoView: false,
    });
    const saved = !own && (await save(false, doc)) && !dirty(doc);
    return { saved, own };
  }

  // Every change decided: the accepted ones are applied at once, and the
  // assistant hears every decision in one answer.
  async function finish(doc, p) {
    const shown = doc.preview;
    if (!shown) return;
    const items = itemsOf(shown),
      decisions = decisionsOf(p);
    if (p.kind === "note") {
      if (decisions.get(0) !== "accepted")
        return decide(p, {
          status: "rejected",
          ...(notes.get(p.id) ? { note: notes.get(p.id) } : {}),
        });
      const file = await api.createProposedNote(p.id);
      forget(p.id);
      doc.preview = null;
      doc.proposalNote = null;
      await closeTab(doc);
      add(file);
      report(t("已创建《{name}》", { name: file.name }));
      return refresh();
    }
    const located = locate(doc.text, p);
    if (located.error) return paint();
    const taken = located.changes.filter(
      (_, k) => decisions.get(located.indexes[k]) === "accepted",
    );
    const results = p.edits.map((_, i) =>
      p.results && p.results[i] !== "pending"
        ? p.results[i]
        : decisions.get(i) || "rejected",
    );
    leave(doc);
    // One transaction: one Ctrl+Z takes all the accepted changes back.
    const result = taken.length
      ? await apply(doc, taken)
      : { saved: true, own: false };
    const reasons = reasonsOf(p);
    await api.decideProposal(p.id, {
      results,
      saved: result.saved,
      ...(results.some((r, i) => r === "rejected" && reasons.get(i))
        ? {
            reasons: results.map((r, i) =>
              r === "rejected" ? (reasons.get(i) ?? null) : null,
            ),
          }
        : {}),
      ...(notes.get(p.id) ? { note: notes.get(p.id) } : {}),
    });
    forget(p.id);
    const counts = {
      accepted: taken.length,
      rejected: items.length - taken.length,
    };
    report(
      !taken.length
        ? t("已拒绝这条提议")
        : result.saved
          ? t("已接受 {accepted} 处并保存，拒绝 {rejected} 处", counts)
          : result.own
            ? t("已接受 {accepted} 处，写入草稿，按 Ctrl+S 保存", counts)
            : t("已写入草稿，但未能保存"),
    );
    await refresh();
  }

  // Opens a proposal from the toolbar's list: its note, then the review.
  async function open(p) {
    if (p.kind === "note") {
      let doc = tabs.find((tab) => tab.proposalNote === p.id);
      if (!doc) {
        doc = add({ name: p.name });
        if (!doc) return;
        doc.proposalNote = p.id;
      } else activate(doc);
      paint();
      return preview(doc, p);
    }
    const { document: file } = await api.openProposal(p.id);
    const doc = add(file);
    if (!doc) return;
    current.set(doc.id, p.id);
    paint();
    preview(doc, p);
  }

  // The marks of the shown review, drawn again.
  function marks() {
    unmark(content);
    const doc = getActive(),
      shown = doc?.preview;
    if (!shown) return;
    const p = list.find((x) => x.id === shown.id);
    const decisions = p ? decisionsOf(p) : new Map();
    shown.states = itemsOf(shown).map((ix) => decisions.get(ix) || "pending");
    const kind = lookOf(shown);
    if (kind === "note") return;
    shown.targets =
      kind === "revise"
        ? revise(shown)
        : kind === "compare"
          ? compare(doc, shown)
          : source(shown, (i) => go(doc, i));
    if (shown.kind !== "note") rail(shown.targets, shown, (i) => go(doc, i));
  }
  const stateClass = (state) =>
    state === "accepted"
      ? "proposal-ok"
      : state === "rejected"
        ? "proposal-no"
        : null;
  const stateLabel = (state) =>
    state === "accepted"
      ? t("已接受")
      : state === "rejected"
        ? t("已拒绝")
        : "";

  // Revision marks in the note: new words washed green and underlined,
  // removed words struck through in red where they were, a bar beside each
  // changed block; a rejected change greyed, a decided one labelled. Returns
  // each change's first element and kind.
  function revise(shown) {
    const added = [],
      dropped = [],
      found = shown.revs.map(() => ({ first: null, kinds: new Set() }));
    const earliest = (i, el) => {
      const f = found[i];
      if (el && (!f.first || el.compareDocumentPosition(f.first) & 4))
        f.first = el;
    };
    // Removed text first: a new run marked before it would take in text
    // put at its start. Places count only the note's own text, so the
    // order of insertion does not matter.
    shown.revs.forEach((rev, i) => {
      for (const piece of rev.pieces) {
        if (piece.oldTo <= piece.oldFrom) continue;
        const removed = shown.before.slice(piece.oldFrom, piece.oldTo);
        const el = insertRemoved(
          content,
          piece.from,
          removed,
          piece.to > piece.from,
        );
        if (!el) continue;
        if (shown.states[i] === "rejected") el.classList.add("proposal-no");
        found[i].kinds.add("del");
        const block = el.matches(".proposal-del-block")
          ? el
          : el.closest("[data-from]");
        block?.classList.add("proposal-removed");
        if (i === shown.at) block?.classList.add("proposal-current");
        earliest(i, block || el);
      }
    });
    shown.revs.forEach((rev, i) => {
      for (const piece of rev.pieces)
        if (piece.to > piece.from) {
          const block = markText(
            content,
            piece.from,
            piece.to,
            shown.states[i] === "rejected" ? dropped : added,
            ["proposal-added", ...(i === shown.at ? ["proposal-current"] : [])],
          );
          earliest(i, block);
          found[i].kinds.add("add");
        }
    });
    highlight("folio-proposal-add", added);
    highlight("folio-proposal-dropped", dropped);
    // Labels last: they are not part of the note's text runs.
    found.forEach(({ first }, i) => {
      const state = shown.states[i];
      if (!first || state === "pending") return;
      first.classList.add(stateClass(state));
      const tag = document.createElement("span");
      tag.className = `proposal-tag ${stateClass(state)}`;
      tag.textContent = stateLabel(state);
      tag.contentEditable = "false";
      first.append(tag);
    });
    return found.map(({ first, kinds }, i) => ({
      el: first,
      kind: kinds.size === 1 ? [...kinds][0] : "mix",
      state: shown.states[i],
    }));
  }

  // Each change's passage before and after, side by side, in place of the
  // note: the blocks it touches in the old text (rendered as the note was)
  // and in the new.
  function compare(doc, shown) {
    shown.beforeHost ??= renderBefore(doc, shown);
    const box = document.createElement("div");
    box.className = "proposal-compare";
    const added = [],
      removed = [],
      targets = [],
      sides = [];
    shown.revs.forEach((rev, i) => {
      const state = shown.states[i];
      const card = document.createElement("section");
      card.className = "proposal-card";
      if (i === shown.at) card.classList.add("proposal-current");
      if (stateClass(state)) card.classList.add(stateClass(state));
      card.dataset.change = String(i);
      const head = document.createElement("div");
      head.className = "proposal-card-head";
      head.textContent = t("第 {n} 处", { n: i + 1 });
      if (state !== "pending") {
        const tag = document.createElement("span");
        tag.className = `proposal-tag ${stateClass(state)}`;
        tag.textContent = stateLabel(state);
        head.append(tag);
      }
      const side = (label, kind, host, from, to) => {
        const col = document.createElement("div");
        col.className = `proposal-side proposal-${kind}`;
        const title = document.createElement("div");
        title.className = "proposal-side-title";
        title.textContent = label;
        col.append(title);
        const blocks = pick(host, from, to);
        if (!blocks.length) {
          const none = document.createElement("p");
          none.className = "proposal-none";
          none.textContent = t("（无）");
          col.append(none);
        }
        for (const block of blocks) {
          const copy = block.cloneNode(true);
          copy.removeAttribute("id");
          for (const el of copy.querySelectorAll("[id]"))
            el.removeAttribute("id");
          col.append(copy);
        }
        return col;
      };
      const before = side(
        t("原文"),
        "before",
        shown.beforeHost,
        rev.oldFrom,
        rev.oldTo,
      );
      const after = side(t("修改后"), "after", content, rev.from, rev.to);
      // Marked once in place: moving nodes (as appending several at once
      // does, through a fragment) collapses the ranges in them.
      sides.push([rev, before, after]);
      const row = document.createElement("div");
      row.className = "proposal-sides";
      row.append(before, after);
      card.append(head, row);
      card.onclick = () => shown.at !== i && go(doc, i);
      box.append(card);
      const kinds = new Set(
        rev.pieces.flatMap((piece) => [
          ...(piece.to > piece.from ? ["add"] : []),
          ...(piece.oldTo > piece.oldFrom ? ["del"] : []),
        ]),
      );
      targets.push({
        el: card,
        kind: kinds.size === 1 ? [...kinds][0] : "mix",
        state,
      });
    });
    content.classList.add("proposal-comparing");
    content.prepend(box);
    for (const [rev, before, after] of sides)
      for (const piece of rev.pieces) {
        markText(before, piece.oldFrom, piece.oldTo, removed);
        markText(after, piece.from, piece.to, added);
      }
    highlight("folio-proposal-add", added);
    highlight("folio-proposal-del", removed);
    return targets;
  }
  function renderBefore(doc, shown) {
    const host = document.createElement("div");
    host.innerHTML = renderDocument({
      text: shown.before,
      name: shown.name,
      fileId: doc.fileId,
    }).html;
    return host;
  }

  // The Markdown, in place of the note: every line (whole) or each change's
  // lines with three around them (changes), removed lines red and added
  // green, the words that differ stronger. Returns each change's hunk.
  function source(shown, goTo) {
    const box = sourceLines(shown);
    content.classList.add("proposal-sourcing");
    content.prepend(box);
    const hunks = [...box.querySelectorAll(".src-hunk")];
    return shown.revs.map((rev, i) => {
      const hunk = hunks.find((el) =>
        el.dataset.changes.split(" ").includes(String(i)),
      );
      if (hunk) hunk.onclick = () => shown.at !== i && goTo(i);
      const kinds = new Set(
        rev.pieces.flatMap((piece) => [
          ...(piece.to > piece.from ? ["add"] : []),
          ...(piece.oldTo > piece.oldFrom ? ["del"] : []),
        ]),
      );
      return {
        el: hunk,
        kind: kinds.size === 1 ? [...kinds][0] : "mix",
        state: shown.states[i],
      };
    });
  }

  // Marks on the reader's right edge, one per change, where it is in the
  // note; a click goes to it. A decided change's mark is hollow (accepted)
  // or grey (rejected).
  function rail(targets, shown, goTo) {
    const reader = content.parentElement;
    if (!reader || !targets.length) return;
    const box = document.createElement("div");
    box.className = "proposal-rail";
    const track = document.createElement("div");
    track.className = "proposal-rail-track";
    box.append(track);
    reader.prepend(box);
    const place = () => {
      const height = reader.clientHeight,
        total = Math.max(reader.scrollHeight, 1),
        top = reader.getBoundingClientRect().top - reader.scrollTop;
      track.style.height = height + "px";
      track.replaceChildren(
        ...targets.map(({ el, kind, state }, i) => {
          const mark = document.createElement("button");
          mark.type = "button";
          mark.tabIndex = -1;
          mark.className = `proposal-rail-mark proposal-rail-${kind}`;
          if (stateClass(state)) mark.classList.add(stateClass(state));
          if (i === shown.at) mark.classList.add("proposal-current");
          mark.title = t("第 {n} 处", { n: i + 1 });
          mark.setAttribute("aria-hidden", "true");
          const rect = el?.getBoundingClientRect();
          const y = rect ? rect.top - top : 0;
          mark.style.top = (y / total) * height + "px";
          mark.style.height =
            Math.max(4, ((rect?.height || 0) / total) * height) + "px";
          mark.onclick = () => goTo(i);
          return mark;
        }),
      );
    };
    place();
    railPlace = place;
  }
  let railPlace = null;
  const sized = new ResizeObserver(() => railPlace?.());
  sized.observe(content);
  if (content.parentElement) sized.observe(content.parentElement);

  button.onclick = (event) =>
    showContext(
      event,
      list.map((p) => [
        p.name,
        () =>
          open(p).catch(async (error) => {
            report(
              error.message.replace(
                /^Error invoking remote method '[^']+': (?:Error: )?/,
                "",
              ),
            );
            await refresh();
          }),
        false,
        `${authorOf(p)}：${p.summary}`,
      ]),
      { wide: true },
    );
  api.on("proposals", () => run(refresh)());
  window.addEventListener("focus", () => run(refresh)());
  run(refresh)();

  return {
    paint,
    shown,
    leave,
    // After the reader rendered a note: mark what a review changes, or
    // take the marks of an earlier review away.
    rendered() {
      railPlace = null;
      marks();
    },
    // Read-only while reviewing.
    previewing: (doc = getActive()) => !!doc?.preview,
  };
}

const highlight = (name, ranges) => {
  if (!CSS.highlights) return;
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
};

// Takes a review's marks out of the reader (the rendered note is kept and
// reused, so they must not stay in it).
function unmark(content) {
  for (const name of [
    "folio-proposal-add",
    "folio-proposal-del",
    "folio-proposal-dropped",
  ])
    CSS.highlights?.delete(name);
  content.parentElement
    ?.querySelectorAll(":scope > .proposal-rail")
    .forEach((el) => el.remove());
  content.classList.remove("proposal-comparing", "proposal-sourcing");
  content
    .querySelectorAll(":scope > .proposal-compare, :scope > .proposal-srcview")
    .forEach((el) => el.remove());
  content.querySelectorAll(".proposal-tag").forEach((el) => el.remove());
  const parents = new Set();
  for (const el of content.querySelectorAll(".proposal-del")) {
    parents.add(el.parentNode);
    el.remove();
  }
  for (const parent of parents) parent?.normalize();
  const classes = [
    "proposal-added",
    "proposal-removed",
    "proposal-current",
    "proposal-ok",
    "proposal-no",
  ];
  for (const el of content.querySelectorAll(
    classes.map((name) => "." + name).join(","),
  ))
    el.classList.remove(...classes);
}

// The text nodes of a run of rendered text, without removed text or labels
// a review put in.
const shownText = (leaf) =>
  document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT, (node) =>
    node.parentElement?.closest(".proposal-del, .proposal-tag")
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT,
  );

// Text runs carry their source range (data-text-from/to); collect DOM ranges
// for the part of from..to they show, marking their blocks with blockClass
// (a class or a list of classes). Returns the block of the first run.
export function markText(host, from, to, out, blockClass = null) {
  if (to <= from) return null;
  let block = null;
  const classes = [blockClass || []].flat();
  for (const leaf of host.querySelectorAll("[data-text-from]")) {
    const start = Number(leaf.dataset.textFrom),
      end = Number(leaf.dataset.textTo);
    if (end <= from || start >= to) continue;
    const walker = shownText(leaf);
    let at = start,
      node;
    while ((node = walker.nextNode())) {
      const a = Math.max(from, at),
        b = Math.min(to, at + node.length);
      if (a < b) {
        const range = document.createRange();
        range.setStart(node, a - at);
        range.setEnd(node, b - at);
        out.push(range);
      }
      at += node.length;
    }
    block ??= leaf.closest("[data-from]");
    if (classes.length) leaf.closest("[data-from]")?.classList.add(...classes);
  }
  return block;
}

// Puts removed text back where it was, struck through: in the line where a
// run of text shows that place, or as a block of its own where no text
// shows it (a removed paragraph) or when it held line breaks and nothing
// took its place.
function insertRemoved(host, pos, removed, replaced) {
  let place = null;
  for (const leaf of host.querySelectorAll("[data-text-from]")) {
    const start = Number(leaf.dataset.textFrom),
      end = Number(leaf.dataset.textTo);
    if (start <= pos && pos < end) {
      place = leaf;
      break;
    }
    if (end === pos) place ??= leaf;
  }
  const lines = /\n/.test(removed.trim()) || /^\n|\n$/.test(removed);
  if (place && (replaced || !lines)) {
    const walker = shownText(place);
    let at = Number(place.dataset.textFrom),
      node,
      last = null;
    while ((node = walker.nextNode())) {
      if (pos <= at + node.length) {
        const del = document.createElement("del");
        del.className = "proposal-del";
        del.textContent = removed;
        const range = document.createRange();
        range.setStart(node, pos - at);
        range.collapse(true);
        range.insertNode(del);
        return del;
      }
      at += node.length;
      last = node;
    }
    if (last === null && !lines) {
      const del = document.createElement("del");
      del.className = "proposal-del";
      del.textContent = removed;
      place.append(del);
      return del;
    }
  }
  const del = document.createElement("del");
  del.className = "proposal-del proposal-del-block";
  del.textContent = removed.replace(/^\n+|\n+$/g, "");
  if (place) {
    (place.closest("[data-from]") || place).after(del);
    return del;
  }
  const block = nearestBlock(host, pos);
  if (!block) host.append(del);
  else if (Number(block.dataset.from) < pos) block.after(del);
  else block.before(del);
  return del;
}

// The blocks a range of the text touches: the smallest one holding all of
// it, or else the outermost ones it overlaps (a section is too large).
function pick(host, from, to) {
  const blocks = [...host.querySelectorAll("[data-from]")].filter(
    (el) => !el.matches(".note-section, .section-body"),
  );
  const span = (el) => [Number(el.dataset.from), Number(el.dataset.to)];
  const end = Math.max(to, from + 1);
  let best = null;
  for (const el of blocks) {
    const [a, b] = span(el);
    if (
      a <= from &&
      end <= b &&
      (!best || b - a < span(best)[1] - span(best)[0])
    )
      best = el;
  }
  if (best) return [best];
  const touching = blocks.filter((el) => {
    const [a, b] = span(el);
    return a < end && b > from;
  });
  return touching.filter(
    (el) => !touching.some((other) => other !== el && other.contains(el)),
  );
}

// The smallest block holding a position (a section is too large to mark);
// between blocks, as where a paragraph was deleted, the block after it.
function nearestBlock(host, from) {
  const blocks = [...host.querySelectorAll("[data-from]")].filter(
    (el) => !el.matches(".note-section, .section-body"),
  );
  let best = null;
  for (const el of blocks) {
    const start = Number(el.dataset.from),
      end = Number(el.dataset.to);
    if (
      start <= from &&
      from < end &&
      (!best ||
        end - start < Number(best.dataset.to) - Number(best.dataset.from))
    )
      best = el;
  }
  return (
    best ||
    blocks.find((el) => Number(el.dataset.from) >= from) ||
    blocks.at(-1) ||
    null
  );
}

// The source of a review: every line, or each hunk with three lines around
// it and a gap mark between; each hunk knows its changes.
function sourceLines(shown) {
  const box = document.createElement("div");
  box.className = "proposal-srcview";
  const row = ({ kind, line, old, new: now }) => {
    const el = document.createElement("div");
    el.className =
      "src-row " +
      (kind === "+" ? "src-add" : kind === "-" ? "src-del" : "src-ctx");
    for (const number of [old, now]) {
      const no = document.createElement("span");
      no.className = "src-no";
      no.textContent = number ?? "";
      el.append(no);
    }
    const sign = document.createElement("span");
    sign.className = "src-sign";
    sign.textContent = kind === "=" ? " " : kind;
    const text = document.createElement("span");
    text.className = "src-text";
    text.textContent = line;
    el.append(sign, text);
    return el;
  };
  const gap = () => {
    const el = document.createElement("div");
    el.className = "src-gap";
    el.textContent = "⋯";
    return el;
  };
  if (shown.kind === "note") {
    const hunk = document.createElement("div");
    hunk.className = "src-hunk";
    hunk.dataset.changes = "";
    const lines = shown.text.split("\n");
    if (lines.length > 1 && lines.at(-1) === "") lines.pop();
    lines.forEach((line, i) =>
      hunk.append(row({ kind: "+", line, old: null, new: i + 1 })),
    );
    box.append(hunk);
    return box;
  }
  const { oldLines, hunks } = sourceHunks(shown.before, shown.text, shown.revs);
  const whole = shown.scope === "full",
    around = 3;
  // The empty line after a final newline is not a line of the note.
  const last = oldLines.length - (shown.before.endsWith("\n") ? 1 : 0);
  let o = 0,
    shift = 0;
  const context = (from, to) => {
    for (let k = from; k < to; k++)
      box.append(
        row({ kind: "=", line: oldLines[k], old: k + 1, new: k + 1 + shift }),
      );
  };
  hunks.forEach((hunk, h) => {
    // Unchanged lines before the hunk: all, or the last few after a gap.
    if (whole) context(o, hunk.o1);
    else {
      const start = Math.max(o, hunk.o1 - around);
      if (start > o) box.append(gap());
      context(start, hunk.o1);
    }
    const el = document.createElement("div");
    el.className = "src-hunk";
    el.dataset.changes = hunk.changes.join(" ");
    const states = new Set(hunk.changes.map((i) => shown.states[i]));
    if (hunk.changes.includes(shown.at)) el.classList.add("proposal-current");
    if (states.size === 1) {
      const [state] = states;
      if (state !== "pending") {
        el.classList.add(state === "accepted" ? "proposal-ok" : "proposal-no");
        const tag = document.createElement("span");
        tag.className = `proposal-tag ${state === "accepted" ? "proposal-ok" : "proposal-no"}`;
        tag.textContent = state === "accepted" ? t("已接受") : t("已拒绝");
        el.append(tag);
      }
    }
    const rows = hunk.rows.map((r) => {
      const line = row(r);
      el.append(line);
      return [r.kind, line];
    });
    // The words that differ, in each removed line and the added line that
    // took its place.
    for (let i = 0; i < rows.length;) {
      if (rows[i][0] !== "-") {
        i++;
        continue;
      }
      const dels = [];
      while (i < rows.length && rows[i][0] === "-") dels.push(rows[i++][1]);
      const adds = [];
      while (i < rows.length && rows[i][0] === "+") adds.push(rows[i++][1]);
      for (let k = 0; k < Math.min(dels.length, adds.length); k++)
        markWords(
          dels[k].querySelector(".src-text"),
          adds[k].querySelector(".src-text"),
        );
    }
    box.append(el);
    shift += hunk.n2 - hunk.n1 - (hunk.o2 - hunk.o1);
    o = hunk.o2 + 1;
    // A few lines after it, up to the next hunk.
    if (!whole) {
      const end = Math.min(hunks[h + 1]?.o1 ?? last, last, o + around);
      context(o, end);
      o = end;
    }
  });
  if (whole) context(o, last);
  else if (o < last) box.append(gap());
  return box;
}
function markWords(del, add) {
  const a = del.textContent,
    b = add.textContent;
  if (a.length + b.length > 4000) return;
  const ops = diffSequence(words(a), words(b));
  // Mostly rewritten: the whole line is the change.
  if (ops.filter(([kind]) => kind === "=").length < 1) return;
  const paint = (el, keep) => {
    el.replaceChildren();
    let run = "",
      changed = false;
    const flush = () => {
      if (!run) return;
      if (changed) {
        const span = document.createElement("span");
        span.className = "proposal-word";
        span.textContent = run;
        el.append(span);
      } else el.append(run);
      run = "";
    };
    for (const [kind, word] of ops) {
      if (kind !== "=" && kind !== keep) continue;
      const isChange = kind !== "=";
      if (isChange !== changed) {
        flush();
        changed = isChange;
      }
      run += word;
    }
    flush();
  };
  paint(del, "-");
  paint(add, "+");
}
