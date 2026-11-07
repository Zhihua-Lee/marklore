import { t } from "../desktop/i18n.mjs";
import {
  locateEdits,
  applyChanges,
  revisions,
  unifiedDiff,
  diffSequence,
  words,
} from "../desktop/proposal-edits.mjs";
import { renderDocument } from "./document-render.js";
import { icon } from "./icons.js";
import "./proposals.css";

// Changes proposed by AI assistants through Marklore's MCP server
// (desktop/mcp.mjs). A note with proposals shows a bar above it. Preview
// shows the note as it would read in one of three ways: with the changes
// marked in it (removed words struck in red, new words underlined in green),
// each change's passage before and after side by side, or the source diff.
// Each change can be accepted or rejected on its own, or all at once; an
// accepted change is applied to the note as one undoable change and saved,
// unless the note has unsaved changes of the reader's own: those are not
// saved behind their back, so the change stays in the draft for Ctrl+S.
// Nothing else changes the note: the preview is read-only.

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

// The ways a preview shows the proposal.
const views = () => [
  ["revise", t("修订")],
  ["compare", t("前后对照")],
  ["source", t("源码")],
];

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
    if (fresh.length === 1)
      report(
        t("{client} 提议修改《{name}》", {
          client: clientName(fresh[0].client),
          name: fresh[0].name,
        }),
      );
    else if (fresh.length > 1)
      report(t("收到 {count} 条 AI 提议", { count: fresh.length }));
    // A proposal withdrawn (or decided elsewhere) while it was previewed.
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

  // The bar of the active note: who proposes what, and the actions.
  function paint() {
    paintButton();
    const doc = getActive(),
      mine = forDoc(doc),
      p = doc && chosen(doc);
    const located = p?.kind === "edit" ? locate(doc.text, p) : null;
    const shown = p && doc.preview?.id === p.id ? doc.preview : null;
    // Rendering repaints after each pause in typing: rebuild only on change.
    const state = JSON.stringify([
      doc?.id,
      p?.id,
      mine.length,
      p?.results,
      shown && [shown.view, shown.at],
      p && dirty(doc),
      located?.error?.edit,
      located?.changes?.length,
    ]);
    if (state === painted) return;
    painted = state;
    bar.replaceChildren();
    bar.hidden = !p;
    if (!p) return;
    const text = document.createElement("span");
    text.className = "proposal-text";
    const who = document.createElement("strong");
    who.textContent = clientName(p.client);
    const mark = document.createElement("span");
    mark.className = "proposal-mark";
    mark.innerHTML = icon("spark");
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
    const summary = document.createElement("span");
    summary.className = "proposal-summary";
    summary.textContent = located?.error
      ? t("第 {n} 处修改的原文已改变", { n: located.error.edit + 1 })
      : p.summary;
    summary.title = p.summary;
    text.append(summary);
    bar.append(text);
    const actions = document.createElement("span");
    actions.className = "proposal-actions";
    const action = (label, fn, { primary = false, pressed, into } = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (primary) b.className = "primary";
      if (pressed !== undefined)
        b.setAttribute("aria-pressed", String(pressed));
      b.onclick = run(fn);
      (into || actions).append(b);
      return b;
    };
    const arrow = (name, label, fn, into) => {
      const b = action("", fn, { into });
      b.innerHTML = icon(name);
      b.className = "icon";
      b.setAttribute("aria-label", label);
      b.title = label;
      return b;
    };
    const counter = (value, into = actions) => {
      const count = document.createElement("span");
      count.className = "proposal-count";
      count.textContent = value;
      into.append(count);
    };
    if (mine.length > 1) {
      const at = mine.indexOf(p);
      const step = (d) => () => {
        leave();
        current.set(doc.id, mine[(at + d + mine.length) % mine.length].id);
        paint();
      };
      arrow("chevronLeft", t("上一条提议"), step(-1));
      counter(`${at + 1} / ${mine.length}`);
      arrow("chevronRight", t("下一条提议"), step(1));
    }
    if (located?.error) {
      action(t("关闭提议"), () =>
        decide(p, {
          status: "failed",
          error: `Not applied: ${reasons[located.error.reason]} (edit ${located.error.edit + 1}). Read the note again and propose anew.`,
        }),
      );
      bar.append(actions);
      return;
    }
    action(t("预览"), () => (shown ? leave() : preview(doc, p)), {
      pressed: !!shown,
    });
    if (shown && p.kind === "edit") {
      const group = document.createElement("span");
      group.className = "proposal-views";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", t("预览方式"));
      for (const [name, label] of views())
        action(label, () => show(doc, name), {
          pressed: shown.view === name,
          into: group,
        });
      actions.append(group);
    }
    const count = located?.changes.length ?? 1;
    const own = p.kind === "edit" && dirty(doc);
    const draftTip = t(
      "笔记有未保存的修改：AI 的修改写入草稿，按 Ctrl+S 一起保存",
    );
    // One change at a time, while its place is shown.
    if (shown && count > 1 && shown.view !== "source") {
      const one = document.createElement("span");
      one.className = "proposal-one";
      one.setAttribute("role", "group");
      one.setAttribute("aria-label", t("逐处审阅"));
      arrow("chevronLeft", t("上一处修改"), () => go(doc, shown.at - 1), one);
      counter(t("第 {i} / {n} 处", { i: shown.at + 1, n: count }), one);
      arrow("chevronRight", t("下一处修改"), () => go(doc, shown.at + 1), one);
      action(t("接受这处"), () => acceptOne(doc, p), { into: one }).title = own
        ? draftTip
        : "";
      action(t("拒绝这处"), () => rejectOne(doc, p), { into: one });
      actions.append(one);
    }
    action(
      p.kind === "note"
        ? t("接受并创建")
        : count > 1
          ? t("全部接受")
          : own
            ? t("接受到草稿")
            : t("接受并保存"),
      () => accept(doc, p),
      { primary: true },
    ).title = own ? draftTip : count > 1 ? t("接受全部修改并保存") : "";
    action(count > 1 ? t("全部拒绝") : t("拒绝"), () =>
      decide(p, { status: "rejected" }),
    );
    bar.append(actions);
  }

  // Show the note as the proposal would leave it (read mode, read-only),
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
      before: doc.text,
      name: p.name,
      view: before?.view || "revise",
      at: Math.max(0, Math.min(at, revs.length - 1)),
      revs,
      indexes,
      anchor: before ? before.anchor : doc.anchor,
    };
    doc.htmlText = null;
    render();
    focus(doc);
    paint();
  }
  function show(doc, name) {
    const shown = doc.preview;
    if (!shown || shown.view === name) return;
    shown.view = name;
    doc.htmlText = null;
    render();
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
    if (shown.view === "compare")
      content
        .querySelector(`.proposal-card[data-change="${shown.at}"]`)
        ?.scrollIntoView({ block: "center" });
    else if (shown.view === "revise")
      restore(doc, { from: rev.from, y: 120 }, { expand: true });
  }
  // Back to the note itself, where it was read before the preview; returns
  // that place (nothing when there was no preview).
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
  // The text the reader shows for a note under preview; a source diff
  // renders as a .diff document (by its name, which the path would override).
  function shown(doc) {
    const p = doc.preview;
    if (!p) return null;
    if (p.view !== "source" || p.kind === "note") return { text: p.text };
    return {
      text: unifiedDiff(p.before, p.text, p.name) || " ",
      name: (p.name || "note") + ".diff",
      path: (p.name || "note") + ".diff",
    };
  }

  async function decide(p, decision) {
    const doc = getActive();
    if (doc?.preview?.id === p.id) leave(doc);
    await api.decideProposal(p.id, decision);
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
  const applied = ({ saved, own }, done) =>
    report(
      saved
        ? done
        : own
          ? t("已写入草稿，按 Ctrl+S 保存")
          : t("已写入草稿，但未能保存"),
    );

  async function accept(doc, p) {
    if (p.kind === "note") {
      const file = await api.createProposedNote(p.id);
      doc.preview = null;
      doc.proposalNote = null;
      await closeTab(doc);
      add(file);
      report(t("已创建《{name}》", { name: file.name }));
      return refresh();
    }
    const located = locate(doc.text, p);
    if (located.error) return paint();
    leave(doc);
    // One transaction: one Ctrl+Z takes the whole proposal back.
    const result = await apply(doc, located.changes);
    await api.decideProposal(p.id, { status: "accepted", saved: result.saved });
    applied(result, t("已接受并保存"));
    await refresh();
  }

  // The change shown as current: its change in the note and its edit.
  function currentChange(doc, p) {
    const shown = doc.preview;
    if (shown?.id !== p.id) return null;
    const located = locate(doc.text, p);
    if (located.error) return null;
    const at = Math.min(shown.at, located.changes.length - 1);
    return { at, change: located.changes[at], edit: located.indexes[at] };
  }
  async function acceptOne(doc, p) {
    const one = currentChange(doc, p);
    if (!one) return paint();
    const result = await apply(doc, [one.change]);
    await api.decideProposal(p.id, {
      status: "accepted",
      saved: result.saved,
      edit: one.edit,
    });
    applied(result, t("已接受这处修改并保存"));
    await next(doc, p, one.at);
  }
  async function rejectOne(doc, p) {
    const one = currentChange(doc, p);
    if (!one) return paint();
    await api.decideProposal(p.id, { status: "rejected", edit: one.edit });
    report(t("已拒绝这处修改"));
    await next(doc, p, one.at);
  }
  // After one change was decided: the rest of the proposal, from the change
  // that took its place.
  async function next(doc, p, at) {
    list = await api.proposals();
    const fresh = list.find((x) => x.id === p.id);
    if (fresh && doc === getActive()) return preview(doc, fresh, { at });
    if (doc.preview?.id === p.id) leave(doc);
    await refresh();
  }

  // Opens a proposal from the toolbar's list: its note, then the preview.
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

  // The marks of the shown preview, drawn again.
  function marks() {
    unmark(content);
    const doc = getActive(),
      shown = doc?.preview;
    if (!shown || shown.kind === "note") return;
    if (shown.view === "source") return markSource(content);
    const targets =
      shown.view === "compare" ? compare(doc, shown) : revise(shown);
    rail(targets, shown, (i) => go(doc, i));
  }

  // Revision marks in the note: new words washed green and underlined,
  // removed words struck through in red where they were, a bar beside each
  // changed block. Returns each change's first element and kind.
  function revise(shown) {
    const added = [],
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
          const block = markText(content, piece.from, piece.to, added, [
            "proposal-added",
            ...(i === shown.at ? ["proposal-current"] : []),
          ]);
          earliest(i, block);
          found[i].kinds.add("add");
        }
    });
    highlight("folio-proposal-add", added);
    return found.map(({ first, kinds }) => ({
      el: first,
      kind: kinds.size === 1 ? [...kinds][0] : "mix",
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
      const card = document.createElement("section");
      card.className = "proposal-card";
      if (i === shown.at) card.classList.add("proposal-current");
      card.dataset.change = String(i);
      const head = document.createElement("div");
      head.className = "proposal-card-head";
      head.textContent = t("第 {n} 处", { n: i + 1 });
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

  // Marks on the reader's right edge, one per change, where it is in the
  // note; a click goes to it.
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
        ...targets.map(({ el, kind }, i) => {
          const mark = document.createElement("button");
          mark.type = "button";
          mark.tabIndex = -1;
          mark.className = `proposal-rail-mark proposal-rail-${kind}`;
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
        `${clientName(p.client)}：${p.summary}`,
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
    // After the reader rendered a note: mark what a preview changes, or
    // take the marks of an earlier preview away.
    rendered() {
      railPlace = null;
      marks();
    },
    // Read-only while previewing.
    previewing: (doc = getActive()) => !!doc?.preview,
  };
}

const highlight = (name, ranges) => {
  if (!CSS.highlights) return;
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
};

// Takes a preview's marks out of the reader (the rendered note is kept and
// reused, so they must not stay in it).
function unmark(content) {
  CSS.highlights?.delete("folio-proposal-add");
  CSS.highlights?.delete("folio-proposal-del");
  content.parentElement
    ?.querySelectorAll(":scope > .proposal-rail")
    .forEach((el) => el.remove());
  content.classList.remove("proposal-comparing", "proposal-source");
  content.querySelector(":scope > .proposal-compare")?.remove();
  const parents = new Set();
  for (const el of content.querySelectorAll(".proposal-del")) {
    parents.add(el.parentNode);
    el.remove();
  }
  for (const parent of parents) parent?.normalize();
  for (const el of content.querySelectorAll(
    ".proposal-added, .proposal-removed, .proposal-current",
  ))
    el.classList.remove(
      "proposal-added",
      "proposal-removed",
      "proposal-current",
    );
  for (const el of content.querySelectorAll("[data-proposal-text]")) {
    el.textContent = el.dataset.proposalText;
    delete el.dataset.proposalText;
  }
}

// The text nodes of a run of rendered text, without removed text a preview
// put in.
const shownText = (leaf) =>
  document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT, (node) =>
    node.parentElement?.closest(".proposal-del")
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

// The source diff: in each removed line and the added line that replaced
// it, the words that differ stand out from the rest of the line.
function markSource(content) {
  content.classList.add("proposal-source");
  const lines = [...content.querySelectorAll(".diff-line")];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].matches(".diff-del")) {
      i++;
      continue;
    }
    const dels = [];
    while (i < lines.length && lines[i].matches(".diff-del"))
      dels.push(lines[i++]);
    const adds = [];
    while (i < lines.length && lines[i].matches(".diff-add"))
      adds.push(lines[i++]);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++)
      markWords(dels[k], adds[k]);
  }
}
function markWords(del, add) {
  const body = (el) => el.textContent.slice(1).replace(/\n$/, "");
  const a = body(del),
    b = body(add);
  if (a.length + b.length > 4000) return;
  const wa = words(a),
    wb = words(b);
  const ops = diffSequence(wa, wb);
  // Mostly rewritten: the whole line is the change.
  if (ops.filter(([kind]) => kind === "=").length < 1) return;
  const paint = (el, keep) => {
    const text = el.textContent;
    el.dataset.proposalText = text;
    el.replaceChildren(text[0]);
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
    if (text.endsWith("\n")) el.append("\n");
  };
  paint(del, "-");
  paint(add, "+");
}
