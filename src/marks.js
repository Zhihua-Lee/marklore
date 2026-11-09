import { t } from "../desktop/i18n.mjs";
import { anchorOf, locateAnchor } from "../desktop/comment-anchors.mjs";
import { atPoint, selectionSource } from "./positions.js";
import { markText } from "./proposals.js";
import { icon } from "./icons.js";
import "./marks.css";

// Marks for the AI: the reader marks passages of their notes with what they
// want of the AI about each (select text, "Mark for AI…", or Ctrl+Alt+M),
// as many as they like across notes. Nothing is sent: an assistant connected
// to Marklore reads them when told (get_marks; the list offers the sentence
// to say), or a background run takes them (desktop/ai-runs.mjs). The AI
// answers with proposals, reviewed as any, and a mark goes once a proposal
// answering it is accepted; a mark it does not act on gets its reply.
// Marks live in Marklore's data folder, never in the note. Underlined in the
// text: solid while the AI has not taken it, dotted while a run works on it
// or a proposal answering it waits.
//
// The note being read and the text selected in it are told to the main
// process as they change, so the AI can be asked about "this" (get_context).

const MAX_QUOTE = 1000;
// What to tell an assistant to look at the marks.
const ASK = () => t("看一下 Marklore 的标记");
const samePath = (a, b) =>
  !!a &&
  !!b &&
  a.replace(/[\\/]+/g, "/").toLowerCase() ===
    b.replace(/[\\/]+/g, "/").toLowerCase();
const oneLine = (s, max = 80) => {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
};

export function createMarks({
  api,
  content,
  reader,
  button,
  getActive,
  add,
  jump,
  report,
  run,
  // The editor of Edit mode when it shows the note ({ ranges(from, to,
  // out), selected(), scroller }), else null: marks are placed in it.
  surface = () => null,
}) {
  if (!api?.marks) return null;
  // The text at note offsets from..to, as ranges, where the note shows.
  const range = (from, to, out) =>
    surface()?.ranges(from, to, out) ?? markText(content, from, to, out);
  const viewport = () =>
    (surface()?.scroller ?? reader).getBoundingClientRect();
  let state = { marks: [], run: null },
    // Mark id -> { from, to } in the text shown.
    placed = new Map(),
    card = null,
    panel = null,
    // A mark to show once its note, just opened, is rendered.
    pending = null;

  const open = () => state.marks.filter((m) => m.state === "open");
  const onNote = (doc) =>
    doc?.path ? state.marks.filter((m) => samePath(m.file, doc.path)) : [];
  const taken = (mark) =>
    mark.state === "background" || mark.state === "proposed";

  async function load() {
    take(await api.marks());
  }
  function take(next) {
    state = next;
    rendered();
    if (panel) paintPanel();
  }

  function paintButton() {
    const count = open().length;
    const answered = state.marks.some((m) => m.state === "replied");
    button.hidden = !getActive()?.fileId && !state.marks.length && !state.run;
    button.dataset.count = String(count);
    button.classList.toggle("settled", !count);
    button.classList.toggle("answered", answered);
    button.classList.toggle("working", state.run?.status === "running");
    const label = answered
      ? t("标记（{count} 条待处理；AI 有回复）", { count })
      : t("标记（{count} 条待处理）", { count });
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  // After each render: place the note's marks in the text shown.
  function rendered() {
    paintButton();
    tell();
    CSS.highlights?.delete("folio-mark");
    CSS.highlights?.delete("folio-mark-sent");
    placed = new Map();
    const doc = getActive();
    // A proposal under review shows other text: its marks wait.
    if (!doc || doc.preview) return;
    const text = surface() ? doc.text : (doc.previewText ?? doc.text),
      solid = [],
      dotted = [];
    for (const mark of onNote(doc)) {
      const at = locateAnchor(text, mark);
      if (!at) continue;
      placed.set(mark.id, at);
      range(at.from, at.to, taken(mark) ? dotted : solid);
    }
    if (CSS.highlights) {
      if (solid.length)
        CSS.highlights.set("folio-mark", new Highlight(...solid));
      if (dotted.length)
        CSS.highlights.set("folio-mark-sent", new Highlight(...dotted));
    }
    if (pending && placed.has(pending)) {
      const id = pending;
      pending = null;
      reveal(state.marks.find((m) => m.id === id));
    }
    if (card) place();
  }

  // The note and the selection, for the AI to ask about (get_context).
  let telling = null;
  function tell() {
    if (!api.setContext) return;
    clearTimeout(telling);
    telling = setTimeout(() => {
      const doc = getActive();
      let selection = null;
      if (doc?.fileId && !doc.preview) {
        const chosen = surface()
          ? surface().selected()
          : doc.previewText === doc.text
            ? selectionSource(content)
            : null;
        if (chosen && chosen.to > chosen.from)
          selection = {
            text: doc.text.slice(chosen.from, chosen.to),
            from: chosen.from,
          };
      }
      api
        .setContext({ fileId: doc?.fileId ?? null, selection })
        .catch(() => {});
    }, 400);
  }
  document.addEventListener("selectionchange", tell);

  // What a mark's state says.
  const statusOf = (mark) =>
    mark.state === "background"
      ? t("后台 AI 正在处理")
      : mark.state === "proposed"
        ? t("AI 提了修改，等你审阅")
        : mark.state === "replied"
          ? t("AI 回复了")
          : t("等 AI 处理");

  // The card: one mark, or a new one on a selection.
  function close() {
    card?.element.remove();
    card = null;
  }
  function place() {
    if (!card) return;
    const box = card.element,
      view = viewport();
    let rect = null;
    const at = card.mark ? placed.get(card.mark.id) : card.at;
    if (at) {
      const ranges = [];
      range(at.from, at.to, ranges);
      rect = ranges.flatMap((r) => [...r.getClientRects()]).at(-1) || null;
    }
    const width = Math.min(340, view.width - 16);
    box.style.width = width + "px";
    const left = rect
      ? Math.max(view.left + 8, Math.min(rect.left, view.right - width - 8))
      : view.right - width - 16;
    const below = rect ? rect.bottom + 8 : view.top + 12;
    const top =
      below + box.offsetHeight > innerHeight - 8 && rect
        ? Math.max(view.top + 4, rect.top - box.offsetHeight - 8)
        : below;
    box.style.left = left + "px";
    box.style.top = Math.max(view.top + 4, top) + "px";
  }
  const button$ = (into, label, fn, className = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (className) b.className = className;
    b.onclick = run(fn);
    into.append(b);
    return b;
  };
  const closer = (into, fn, label = t("关闭")) => {
    const b = button$(into, "", fn, "icon mark-close");
    b.innerHTML = icon("close");
    b.setAttribute("aria-label", label);
    b.title = label;
    return b;
  };
  // One turn of what was said about a mark: the reader's or the AI's.
  const turn = (by, text) => {
    const box = document.createElement("div");
    box.className = by === "owner" ? "mark-turn mark-mine" : "mark-turn";
    const who = document.createElement("strong");
    who.textContent = by === "owner" ? t("你：") : t("AI：");
    const body = document.createElement("span");
    body.textContent = text;
    box.append(who, body);
    return box;
  };
  // A card holding a passage and what the reader wants of the AI about it.
  // Not answered yet: the words can be changed (saved) or the mark deleted.
  // Answered: what was said, read only; the reader asks further (the
  // exchange stays for the AI) or is done with it. A background run's mark
  // is only shown.
  function build({ mark, quote }) {
    close();
    const element = document.createElement("div");
    element.className = "mark-card";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", t("标记"));
    const head = document.createElement("blockquote");
    head.className = "mark-quote";
    head.textContent = quote;
    element.append(head);
    for (const e of mark?.earlier || []) element.append(turn(e.by, e.text));
    const actions = document.createElement("div");
    actions.className = "mark-actions";
    let field = null;
    // A field for the reader's words, with its button (Ctrl+Enter too).
    const words$ = ({ value = "", hint, label, save: done }) => {
      const area = document.createElement("textarea");
      area.rows = 3;
      area.value = value;
      area.placeholder = hint;
      area.setAttribute("aria-label", hint);
      element.insertBefore(area, element.contains(actions) ? actions : null);
      const save = button$(
        actions,
        label,
        async () => {
          const text = area.value.trim();
          if (!text) return area.focus();
          save.disabled = true;
          try {
            await done(text);
            close();
          } finally {
            save.disabled = false;
          }
        },
        "primary",
      );
      actions.prepend(save);
      area.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          save.click();
        }
      });
      return area;
    };
    const remove = async () => {
      take(await api.changeMark("remove", { id: mark.id }));
      close();
    };
    if (!mark)
      field = words$({
        hint: t("想让 AI 做什么…（Ctrl+Enter 保存）"),
        label: t("保存标记"),
        save: async (text) => {
          const doc = getActive();
          take(
            await api.changeMark("add", {
              fileId: doc.fileId,
              ...card.anchor,
              text,
            }),
          );
          report(t("已存为标记，{count} 条待处理", { count: open().length }));
        },
      });
    else if (mark.state === "replied") {
      element.append(turn("owner", mark.text), turn("ai", mark.answer.text));
      const further = button$(
        actions,
        t("追问…"),
        () => {
          further.remove();
          finished.remove();
          words$({
            hint: t("接着对 AI 说…（Ctrl+Enter 确定）"),
            label: t("交给 AI"),
            save: async (text) =>
              take(await api.changeMark("edit", { id: mark.id, text })),
          }).focus();
        },
        "primary",
      );
      further.title = t("接着问；之前的问答会一起交给 AI");
      const finished = button$(actions, t("完成"), remove);
      finished.title = t("看完了，去掉这条标记");
    } else {
      if (mark.state === "background") {
        const words = document.createElement("p");
        words.className = "mark-text";
        words.textContent = mark.text;
        element.append(words);
      } else
        field = words$({
          value: mark.text,
          hint: t("想让 AI 做什么…（Ctrl+Enter 保存）"),
          label: t("保存"),
          save: async (text) => {
            if (text !== mark.text)
              take(await api.changeMark("edit", { id: mark.id, text }));
          },
        });
      const status = document.createElement("p");
      status.className = "mark-status";
      status.textContent = statusOf(mark);
      element.append(status);
      button$(actions, t("删除"), remove).title = t("删除这条标记");
    }
    closer(actions, close);
    element.append(actions);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    });
    document.body.append(element);
    return { element, field };
  }
  function showMark(mark) {
    if (!mark) return;
    const parts = build({ mark, quote: mark.quote });
    card = { ...parts, mark };
    place();
    parts.field?.focus();
  }

  // A new mark on the selected text.
  function startNew(
    selected = surface() ? surface().selected() : selectionSource(content),
  ) {
    const doc = getActive();
    if (!doc) return;
    if (!doc.fileId) return report(t("请先保存笔记，再标记"));
    if (doc.preview) return report(t("审阅 AI 提议时不能标记"));
    if (!selected || selected.to <= selected.from)
      return report(t("先选中要标记的文字"));
    if (!surface() && doc.previewText !== doc.text)
      return report(t("预览正在更新，请稍后再试。"));
    if (selected.to - selected.from > MAX_QUOTE)
      return report(t("标记的文字太长，请选短一些"));
    const anchor = anchorOf(doc.text, selected.from, selected.to);
    const parts = build({ quote: anchor.quote });
    card = { ...parts, anchor, at: { from: selected.from, to: selected.to } };
    place();
    parts.field.focus();
  }

  // Where a mark is: its note opened (if it is another), the passage in
  // view, its card.
  function reveal(mark) {
    if (!mark) return;
    const doc = getActive();
    if (!doc || !samePath(mark.file, doc.path)) {
      pending = mark.id;
      closePanel();
      run(async () => {
        const opened = await api.openMarked(mark.id);
        add(opened);
      })();
      return;
    }
    closePanel();
    const at = placed.get(mark.id);
    if (at) jump(at.from);
    // After the jump has scrolled the note.
    setTimeout(() => requestAnimationFrame(() => showMark(mark)), 160);
  }

  // The background run, if one runs or has news.
  function paintRun(into) {
    const r = state.run;
    if (!r) return;
    const box = document.createElement("div");
    box.className = "marks-run";
    box.dataset.status = r.status;
    const line = document.createElement("p");
    line.className = "marks-run-line";
    if (r.status === "running") {
      line.textContent = t("后台 AI 正在处理 {count} 条标记…", {
        count: r.count,
      });
      box.append(line);
      const actions = document.createElement("div");
      actions.className = "mark-actions";
      button$(actions, t("停止"), async () => take(await api.stopRun(r.id)));
      box.append(actions);
    } else {
      line.textContent =
        r.status === "done"
          ? t("后台 AI 处理完了：提了 {count} 条修改", { count: r.proposals })
          : r.status === "stopped"
            ? t("后台 AI 已停止")
            : t("后台 AI 没有完成：{reason}", { reason: r.error || "" });
      const head = document.createElement("div");
      head.className = "marks-run-head";
      head.append(line);
      closer(head, async () => take(await api.dismissRun(r.id)), t("收起"));
      box.append(head);
      if (r.status === "done" && r.result) {
        const said = document.createElement("p");
        said.className = "marks-run-result";
        said.textContent = r.result;
        box.append(said);
      }
    }
    into.append(box);
  }

  // The list: the marks by note, with their state; how to have the AI take
  // them; the background run.
  function paintPanel() {
    if (!panel) return;
    panel.replaceChildren();
    const head = document.createElement("div");
    head.className = "marks-head";
    const title = document.createElement("strong");
    title.textContent = t("标记");
    head.append(title);
    closer(head, closePanel);
    panel.append(head);
    paintRun(panel);
    if (!state.marks.length) {
      const empty = document.createElement("p");
      empty.className = "marks-empty";
      empty.textContent = t(
        "选中文字，右键“标记给 AI…”，写下想让 AI 做什么。可以在多篇笔记里标多处。",
      );
      panel.append(empty);
    }
    const byNote = new Map();
    for (const mark of state.marks) {
      const k = mark.file.toLowerCase();
      if (!byNote.has(k)) byNote.set(k, []);
      byNote.get(k).push(mark);
    }
    for (const marks of byNote.values()) {
      const note = document.createElement("div");
      note.className = "marks-note";
      note.textContent = marks[0].name;
      panel.append(note);
      const list = document.createElement("ul");
      list.className = "marks-list";
      for (const mark of marks) {
        const item = document.createElement("li");
        item.dataset.state = mark.state;
        const go = button$(item, "", () => reveal(mark), "mark-item");
        const quote = document.createElement("span");
        quote.className = "mark-item-quote";
        quote.textContent = oneLine(mark.quote, 60);
        const words = document.createElement("span");
        words.className = "mark-item-text";
        words.textContent = mark.text;
        go.append(quote, words);
        if (mark.state !== "open") {
          const status = document.createElement("span");
          status.className = "mark-item-status";
          status.textContent =
            mark.state === "replied"
              ? `${t("AI：")}${oneLine(mark.answer?.text || "", 120)}`
              : statusOf(mark);
          go.append(status);
        }
        const remove = button$(
          item,
          "",
          async () => take(await api.changeMark("remove", { id: mark.id })),
          "icon mark-remove",
        );
        remove.innerHTML = icon("close");
        remove.setAttribute("aria-label", t("删除这条标记"));
        remove.title = t("删除这条标记");
        list.append(item);
      }
      panel.append(list);
    }
    const waiting = open().length;
    if (waiting) {
      // Two ways for the AI to take them: told in its chat, or a run.
      const how = document.createElement("div");
      how.className = "marks-how";
      const say = document.createElement("p");
      say.className = "marks-hint";
      say.textContent = t("在你的 AI 对话里说：");
      const ask = document.createElement("button");
      ask.type = "button";
      ask.className = "marks-ask";
      ask.textContent = ASK();
      ask.title = t("复制这句话");
      ask.onclick = run(async () => {
        await api.copyText(ASK());
        report(t("已复制，粘贴到 AI 的对话里"));
      });
      say.append(ask);
      how.append(say);
      const row = document.createElement("div");
      row.className = "marks-send";
      const background = button$(
        row,
        t("交给后台 AI（{count} 条）", { count: waiting }),
        async () => take(await api.startRun()),
        "primary",
      );
      background.disabled = state.run?.status === "running";
      background.title = t(
        "Claude Code 在后台处理这些标记，结果作为提议等你审阅；会用到你的 Claude 用量",
      );
      how.append(row);
      panel.append(how);
    }
  }
  function openPanel() {
    close();
    panel = document.createElement("div");
    panel.className = "marks-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("标记"));
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePanel();
      }
    });
    document.body.append(panel);
    paintPanel();
    const r = button.getBoundingClientRect();
    panel.style.top = r.bottom + 6 + "px";
    panel.style.right = Math.max(8, innerWidth - r.right - 40) + "px";
    run(load)();
  }
  function closePanel() {
    panel?.remove();
    panel = null;
  }
  button.onclick = () => (panel ? closePanel() : openPanel());

  // Read mode: a click on a marked passage opens its card.
  content.addEventListener("click", (event) => {
    const doc = getActive();
    if (doc?.mode !== "read" || !placed.size) return;
    if (event.target.closest("a,button,input,summary,.fold")) return;
    if (!window.getSelection()?.isCollapsed) return;
    const hit = atPoint(content, event.clientX, event.clientY);
    if (!hit) return;
    const mark = onNote(doc).find((m) => {
      const at = placed.get(m.id);
      return at && at.from <= hit.from && hit.from < at.to;
    });
    if (mark) showMark(mark);
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (card && !card.element.contains(event.target)) close();
      if (
        panel &&
        !panel.contains(event.target) &&
        !button.contains(event.target)
      )
        closePanel();
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    // The list closes with Escape wherever the focus is.
    if (event.key === "Escape" && panel && !card) {
      closePanel();
      return;
    }
    if (
      event.key.toLowerCase() === "m" &&
      event.ctrlKey &&
      event.altKey &&
      !event.shiftKey &&
      !document.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      startNew();
    }
  });
  // Either pane scrolling moves the card with its passage.
  document.addEventListener("scroll", () => card && place(), {
    passive: true,
    capture: true,
  });
  api.on("marks", () => run(load)());
  window.addEventListener("focus", () => run(load)());
  run(load)();

  return {
    rendered,
    startNew,
    close,
    switched: () => {
      close();
      rendered();
    },
    // What the context menu needs to offer "Mark for AI".
    available: (doc = getActive()) => !!doc?.fileId && !doc.preview,
  };
}
