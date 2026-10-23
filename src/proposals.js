import { t } from "../desktop/i18n.mjs";
import {
  locateEdits,
  applyChanges,
  changedRanges,
  unifiedDiff,
} from "../desktop/proposal-edits.mjs";
import { icon } from "./icons.js";
import "./proposals.css";

// Changes proposed by AI assistants through Marklore's MCP server
// (desktop/mcp.mjs). A note with proposals shows a bar above it; Preview
// renders the note as it would read, the changed text marked, or the source
// diff. Accept applies the edits to the note as one undoable change and saves
// it, unless the note has unsaved changes of the reader's own: those are not
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
    const located = p?.kind === "edit" ? locateEdits(doc.text, p.edits) : null;
    // Rendering repaints after each pause in typing: rebuild only on change.
    const state = JSON.stringify([
      doc?.id,
      p?.id,
      mine.length,
      p && doc.preview?.id,
      p && doc.preview?.diff,
      p && dirty(doc),
      located?.error?.edit,
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
    const action = (label, fn, { primary = false, pressed } = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (primary) b.className = "primary";
      if (pressed !== undefined)
        b.setAttribute("aria-pressed", String(pressed));
      b.onclick = run(fn);
      actions.append(b);
      return b;
    };
    if (mine.length > 1) {
      const at = mine.indexOf(p);
      const step = (d) => () => {
        leave();
        current.set(doc.id, mine[(at + d + mine.length) % mine.length].id);
        paint();
      };
      const back = action("", step(-1));
      back.innerHTML = icon("chevronLeft");
      back.className = "icon";
      back.setAttribute("aria-label", t("上一条提议"));
      const count = document.createElement("span");
      count.className = "proposal-count";
      count.textContent = `${at + 1} / ${mine.length}`;
      actions.append(count);
      const forward = action("", step(1));
      forward.innerHTML = icon("chevronRight");
      forward.className = "icon";
      forward.setAttribute("aria-label", t("下一条提议"));
    }
    if (located?.error) {
      action(t("关闭提议"), () =>
        decide(p, {
          status: "failed",
          error: `Not applied: ${reasons[located.error.reason]} (edit ${located.error.edit + 1}). Read the note again and propose anew.`,
        }),
      );
    } else {
      const previewing = doc.preview?.id === p.id;
      action(t("预览"), () => (previewing ? leave() : preview(doc, p)), {
        pressed: previewing,
      });
      if (previewing && p.kind === "edit")
        action(t("源码对比"), () => toggleDiff(doc), {
          pressed: !!doc.preview.diff,
        });
      action(
        p.kind === "note"
          ? t("接受并创建")
          : dirty(doc)
            ? t("接受到草稿")
            : t("接受并保存"),
        () => accept(doc, p),
        { primary: true },
      ).title =
        p.kind === "edit" && dirty(doc)
          ? t("笔记有未保存的修改：AI 的修改写入草稿，按 Ctrl+S 一起保存")
          : "";
      action(t("拒绝"), () => decide(p, { status: "rejected" }));
    }
    bar.append(actions);
  }

  // Show the note as the proposal would leave it (read mode, read-only).
  function preview(doc, p) {
    if (doc !== getActive()) return;
    if (doc.mode !== "read") setMode("read");
    let text, ranges;
    if (p.kind === "note") {
      text = p.text;
      ranges = [{ from: 0, to: text.length, removed: 0 }];
    } else {
      const located = locateEdits(doc.text, p.edits);
      if (located.error) return paint();
      text = applyChanges(doc.text, located.changes);
      ranges = changedRanges(doc.text, located.changes);
    }
    doc.preview = {
      id: p.id,
      text,
      ranges,
      before: doc.text,
      name: p.name,
      diff: false,
      anchor: doc.anchor,
    };
    doc.htmlText = null;
    render();
    // The first change in view.
    const first = ranges[0];
    if (first && p.kind === "edit")
      restore(doc, { from: first.from, y: 120 }, { expand: true });
    paint();
  }
  function toggleDiff(doc) {
    const shown = doc.preview;
    if (!shown) return;
    shown.diff = !shown.diff;
    doc.htmlText = null;
    render();
    paint();
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
    if (!p.diff) return { text: p.text };
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
    const located = locateEdits(doc.text, p.edits);
    if (located.error) return paint();
    leave(doc);
    const own = dirty(doc);
    // One transaction: one Ctrl+Z takes the whole proposal back.
    view.dispatch({
      changes: located.changes,
      userEvent: "input.proposal",
      scrollIntoView: false,
    });
    const saved = !own && (await save(false, doc)) && !dirty(doc);
    await api.decideProposal(p.id, { status: "accepted", saved });
    report(
      saved
        ? t("已接受并保存")
        : own
          ? t("已写入草稿，按 Ctrl+S 保存")
          : t("已写入草稿，但未能保存"),
    );
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
    // After the reader rendered a note under preview: mark what changed.
    rendered() {
      CSS.highlights?.delete("folio-proposal");
      const doc = getActive();
      if (!doc?.preview || doc.preview.diff) return;
      const ranges = [];
      for (const change of doc.preview.ranges) {
        const marked = markText(
          content,
          change.from,
          change.to,
          ranges,
          "proposal-changed",
        );
        const block = marked || nearestBlock(content, change.from);
        block?.classList.add(
          change.to > change.from ? "proposal-changed" : "proposal-removed",
        );
      }
      if (ranges.length && CSS.highlights)
        CSS.highlights.set("folio-proposal", new Highlight(...ranges));
    },
    // Read-only while previewing.
    previewing: (doc = getActive()) => !!doc?.preview,
  };
}

// Text runs carry their source range (data-text-from/to); collect DOM ranges
// for the part of from..to they show, marking their blocks with blockClass.
// Returns the block of the first run.
export function markText(host, from, to, out, blockClass = null) {
  if (to <= from) return null;
  let block = null;
  for (const leaf of host.querySelectorAll("[data-text-from]")) {
    const start = Number(leaf.dataset.textFrom),
      end = Number(leaf.dataset.textTo);
    if (end <= from || start >= to) continue;
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
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
    if (blockClass) leaf.closest("[data-from]")?.classList.add(blockClass);
  }
  return block;
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
