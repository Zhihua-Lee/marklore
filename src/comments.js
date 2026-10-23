import { t } from "../desktop/i18n.mjs";
import { anchorOf, locateAnchor } from "../desktop/comment-anchors.mjs";
import { atPoint, selectionSource } from "./positions.js";
import { markText, clientName } from "./proposals.js";
import { icon } from "./icons.js";
import "./comments.css";

// Comment threads on a passage of a note, by the reader and by AI
// assistants (through the MCP server), kept beside the note in Marklore's
// data folder, never in the note. A thread's passage is underlined; in Read
// mode a click on it opens the thread. Select text and choose "Add comment"
// (right-click, or Ctrl+Alt+M) to start one. The toolbar lists the note's
// threads.

const MAX_QUOTE = 1000;
const time = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const author = (by) => (by === "owner" ? t("你") : clientName(by));

export function createComments({
  api,
  content,
  reader,
  button,
  getActive,
  jump,
  report,
  run,
  showContext,
}) {
  if (!api?.comments) return null;
  let threads = [],
    loadedFor = null,
    // Thread id -> { from, to } in the rendered text.
    placed = new Map(),
    card = null;

  async function load(doc = getActive()) {
    const id = doc?.fileId || null;
    threads = id ? await api.comments(id) : [];
    loadedFor = id;
    if (doc === getActive()) rendered();
  }

  const open = () => threads.filter((x) => !x.resolved);
  function paintButton() {
    const count = open().length;
    // Every saved note can take comments; the count is of open threads.
    button.hidden = !getActive()?.fileId;
    button.dataset.count = String(count);
    button.classList.toggle("settled", !count);
    const label = t("批注（{count}）", { count });
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  // After each render: place the threads in the text shown and underline
  // the open ones.
  function rendered() {
    const doc = getActive();
    if ((doc?.fileId || null) !== loadedFor) {
      run(() => load(doc))();
      return;
    }
    paintButton();
    CSS.highlights?.delete("folio-comment");
    placed = new Map();
    // A proposal under preview shows other text: its threads wait.
    if (!doc || doc.preview) return;
    const text = doc.previewText ?? doc.text,
      ranges = [];
    for (const thread of threads) {
      const at = locateAnchor(text, thread);
      if (!at) continue;
      placed.set(thread.id, at);
      if (!thread.resolved) markText(content, at.from, at.to, ranges);
    }
    if (ranges.length && CSS.highlights)
      CSS.highlights.set("folio-comment", new Highlight(...ranges));
    if (card) place();
  }

  // The card: one thread, or a new comment on a selection.
  function close() {
    card?.element.remove();
    card = null;
  }
  function place() {
    if (!card) return;
    const box = card.element,
      view = reader.getBoundingClientRect();
    let rect = null;
    const at = card.thread ? placed.get(card.thread.id) : card.at;
    if (at) {
      const ranges = [];
      markText(content, at.from, at.to, ranges);
      const rects = ranges.flatMap((r) => [...r.getClientRects()]);
      rect = rects.at(-1) || null;
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
  function build({ thread, quote, onSend, sendLabel, placeholder }) {
    close();
    const element = document.createElement("div");
    element.className = "comment-card";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", t("批注"));
    const head = document.createElement("blockquote");
    head.className = "comment-quote";
    head.textContent = quote;
    element.append(head);
    if (thread) {
      if (!placed.has(thread.id)) {
        const lost = document.createElement("p");
        lost.className = "comment-lost";
        lost.textContent = t("批注的原文已改动或删除");
        element.append(lost);
      }
      const list = document.createElement("ol");
      list.className = "comment-messages";
      for (const message of thread.messages) {
        const item = document.createElement("li"),
          who = document.createElement("strong"),
          when = document.createElement("time"),
          body = document.createElement("p");
        item.dataset.by = message.by === "owner" ? "owner" : "ai";
        who.textContent = author(message.by);
        when.dateTime = message.at;
        when.textContent = time.format(new Date(message.at));
        body.textContent = message.text;
        item.append(who, when, body);
        list.append(item);
      }
      element.append(list);
    }
    const field = document.createElement("textarea");
    field.rows = thread ? 2 : 3;
    field.placeholder = placeholder;
    field.setAttribute("aria-label", placeholder);
    element.append(field);
    const actions = document.createElement("div");
    actions.className = "comment-actions";
    const action = (label, fn, { primary = false } = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (primary) b.className = "primary";
      b.onclick = run(fn);
      actions.append(b);
      return b;
    };
    const send = action(
      sendLabel,
      async () => {
        const text = field.value.trim();
        if (!text) return field.focus();
        send.disabled = true;
        try {
          await onSend(text);
        } finally {
          send.disabled = false;
        }
      },
      { primary: true },
    );
    if (thread) {
      action(thread.resolved ? t("重新打开") : t("解决"), () =>
        change("resolve", { id: thread.id, resolved: !thread.resolved }),
      );
      action(t("删除"), () => {
        if (!window.confirm(t("删除这条批注及其回复？"))) return;
        return change("remove", { id: thread.id });
      });
    }
    const cancel = action("", close);
    cancel.className = "icon comment-close";
    cancel.innerHTML = icon("close");
    cancel.setAttribute("aria-label", t("关闭"));
    element.append(actions);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        send.click();
      }
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    });
    document.body.append(element);
    return { element, field };
  }

  async function change(action, args) {
    const doc = getActive();
    if (!doc?.fileId) return;
    threads = await api.changeComment(doc.fileId, action, args);
    const id = card?.thread?.id;
    close();
    rendered();
    // Still open after an answer: show the thread with it.
    if (action === "reply") showThread(threads.find((x) => x.id === id));
  }

  function showThread(thread) {
    if (!thread) return;
    const parts = build({
      thread,
      quote: thread.quote,
      sendLabel: t("回复"),
      placeholder: t("回复…（Ctrl+Enter 发送）"),
      onSend: (text) => change("reply", { id: thread.id, text }),
    });
    card = { ...parts, thread };
    place();
  }

  // A new comment on the selected text.
  function startNew(selected = selectionSource(content)) {
    const doc = getActive();
    if (!doc) return;
    if (!doc.fileId) return report(t("请先保存笔记，再添加批注"));
    if (doc.preview) return report(t("预览 AI 提议时不能添加批注"));
    if (!selected || selected.to <= selected.from)
      return report(t("先选中要批注的文字"));
    if (doc.previewText !== doc.text)
      return report(t("预览正在更新，请稍后再试。"));
    if (selected.to - selected.from > MAX_QUOTE)
      return report(t("批注的文字太长，请选短一些"));
    const anchor = anchorOf(doc.text, selected.from, selected.to);
    const parts = build({
      quote: anchor.quote,
      sendLabel: t("添加批注"),
      placeholder: t("写下批注…（Ctrl+Enter 发送）"),
      onSend: async (text) => {
        await change("add", { ...anchor, text });
        report(t("已添加批注"));
      },
    });
    card = { ...parts, at: { from: selected.from, to: selected.to } };
    place();
    parts.field.focus();
  }

  // The toolbar's list: open threads first, then settled ones.
  button.onclick = (event) => {
    const sorted = [...open(), ...threads.filter((x) => x.resolved)];
    // The selection stays while a toolbar button is clicked.
    const selected = selectionSource(content),
      doc = getActive();
    showContext(
      event,
      [
        [
          t("添加批注… Ctrl+Alt+M"),
          () => startNew(selected),
          !selected || !doc?.fileId || !!doc?.preview,
          selected ? "" : t("先选中要批注的文字"),
        ],
        ...sorted.map((thread) => {
          const last = thread.messages.at(-1);
          return [
            thread.quote.replace(/\s+/g, " ").slice(0, 60),
            () => reveal(thread),
            false,
            (thread.resolved ? t("已解决 · ") : "") +
              `${author(last.by)}：${last.text.replace(/\s+/g, " ")}`,
          ];
        }),
      ],
      { wide: true },
    );
  };
  function reveal(thread) {
    const at = placed.get(thread.id);
    if (at) jump(at.from);
    // After the jump has scrolled the note.
    setTimeout(() => requestAnimationFrame(() => showThread(thread)), 160);
  }

  // Read mode: a click on underlined text opens its thread.
  content.addEventListener("click", (event) => {
    const doc = getActive();
    if (doc?.mode !== "read" || !placed.size) return;
    if (event.target.closest("a,button,input,summary,.fold")) return;
    if (!window.getSelection()?.isCollapsed) return;
    const hit = atPoint(content, event.clientX, event.clientY);
    if (!hit) return;
    const thread = threads.find((x) => {
      const at = placed.get(x.id);
      return !x.resolved && at && at.from <= hit.from && hit.from < at.to;
    });
    if (thread) showThread(thread);
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (card && !card.element.contains(event.target)) close();
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
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
  reader.addEventListener("scroll", () => card && place(), { passive: true });
  api.on("comments", () => run(() => load())());
  window.addEventListener("focus", () => run(() => load())());

  return {
    rendered,
    startNew,
    close,
    // Switching notes: the next note's threads.
    switched: () => {
      close();
      run(() => load())();
    },
    // What the context menu needs to offer "Add comment".
    available: (doc = getActive()) => !!doc?.fileId && !doc.preview,
  };
}
