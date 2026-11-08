import { t } from "../desktop/i18n.mjs";
import { anchorOf, locateAnchor } from "../desktop/comment-anchors.mjs";
import { atPoint, selectionSource } from "./positions.js";
import { markText, clientName } from "./proposals.js";
import { icon } from "./icons.js";
import "./marks.css";

// Marks for the AI: the reader marks passages of their notes with what they
// want of the AI about each (select text, "Mark for AI…", or Ctrl+Alt+M),
// across notes, and sends the marks together, as one batch, to an assistant
// session (Claude Code, Codex…) the MCP server lists as running. The AI
// answers with proposals and one reply for the batch, read in the marks
// list (the toolbar's mark button). Marks are kept in Marklore's data
// folder, never in the note; a marked passage is underlined, solid until
// sent, dotted after. The first send asks where to send; that choice stays
// until changed.

const MAX_QUOTE = 1000;
const time = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const samePath = (a, b) =>
  !!a &&
  !!b &&
  a.replace(/[\\/]+/g, "/").toLowerCase() ===
    b.replace(/[\\/]+/g, "/").toLowerCase();
const oneLine = (s, max = 80) => {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max) + "…" : line;
};
const folderOf = (cwd) =>
  cwd
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1) || cwd;
export const targetName = (target) =>
  `${clientName(target.client)} · ${target.folder || folderOf(target.cwd)}`;

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
  getSettings,
  changeSettings,
  confirm = (question) => window.confirm(question),
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
  let state = { marks: [], batches: [], sessions: [] },
    // Mark id -> { from, to } in the text shown.
    placed = new Map(),
    card = null,
    panel = null,
    // The panel lists the places to send to instead of the marks.
    choosing = false,
    // A mark to show once its note, just opened, is rendered.
    pending = null;

  const drafts = () => state.marks.filter((m) => !m.batch);
  const onNote = (doc) =>
    doc?.path ? state.marks.filter((m) => samePath(m.file, doc.path)) : [];
  const batchOf = (mark) => state.batches.find((b) => b.id === mark.batch);

  async function load() {
    take(await api.marks());
  }
  function take(next) {
    state = next;
    rendered();
    if (panel) paintPanel();
  }

  function paintButton() {
    const count = drafts().length;
    const answered = state.batches.some((b) => b.status === "replied");
    button.hidden =
      !getActive()?.fileId && !state.marks.length && !state.batches.length;
    button.dataset.count = String(count);
    button.classList.toggle("settled", !count);
    button.classList.toggle("answered", answered);
    const label = answered
      ? t("标记（{count} 条未发送；AI 已回复）", { count })
      : t("标记（{count} 条未发送）", { count });
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  // After each render: place the note's marks in the text shown.
  function rendered() {
    paintButton();
    CSS.highlights?.delete("folio-mark");
    CSS.highlights?.delete("folio-mark-sent");
    placed = new Map();
    const doc = getActive();
    // A proposal under review shows other text: its marks wait.
    if (!doc || doc.preview) return;
    const text = surface() ? doc.text : (doc.previewText ?? doc.text),
      unsent = [],
      sent = [];
    for (const mark of onNote(doc)) {
      const at = locateAnchor(text, mark);
      if (!at) continue;
      placed.set(mark.id, at);
      range(at.from, at.to, mark.batch ? sent : unsent);
    }
    if (CSS.highlights) {
      if (unsent.length)
        CSS.highlights.set("folio-mark", new Highlight(...unsent));
      if (sent.length)
        CSS.highlights.set("folio-mark-sent", new Highlight(...sent));
    }
    if (pending && placed.has(pending)) {
      const id = pending;
      pending = null;
      reveal(state.marks.find((m) => m.id === id));
    }
    if (card) place();
  }

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
  const closer = (into, fn) => {
    const b = button$(into, "", fn, "icon mark-close");
    b.innerHTML = icon("close");
    b.setAttribute("aria-label", t("关闭"));
    return b;
  };
  // A card holding a passage and what the reader wants of the AI about it:
  // editable until sent.
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
    const actions = document.createElement("div");
    actions.className = "mark-actions";
    let field = null;
    if (mark?.batch) {
      const words = document.createElement("p");
      words.className = "mark-text";
      words.textContent = mark.text;
      const status = document.createElement("p");
      status.className = "mark-status";
      status.textContent = statusOf(batchOf(mark));
      element.append(words, status);
    } else {
      field = document.createElement("textarea");
      field.rows = 3;
      field.value = mark?.text || "";
      const hint = t("想让 AI 做什么…（Ctrl+Enter 保存）");
      field.placeholder = hint;
      field.setAttribute("aria-label", hint);
      element.append(field);
      const save = button$(
        actions,
        mark ? t("保存") : t("保存标记"),
        async () => {
          const text = field.value.trim();
          if (!text) return field.focus();
          save.disabled = true;
          try {
            if (mark) take(await api.changeMark("edit", { id: mark.id, text }));
            else {
              const doc = getActive();
              take(
                await api.changeMark("add", {
                  fileId: doc.fileId,
                  ...card.anchor,
                  text,
                }),
              );
              report(
                t("已存为标记，{count} 条待发送", { count: drafts().length }),
              );
            }
            close();
          } finally {
            save.disabled = false;
          }
        },
        "primary",
      );
      if (mark)
        button$(actions, t("删除"), async () => {
          take(await api.changeMark("remove", { id: mark.id }));
          close();
        });
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          save.click();
        }
      });
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

  const statusOf = (batch) =>
    !batch
      ? t("未发送")
      : batch.status === "replied"
        ? t("AI 已回复，回复在标记列表中")
        : batch.status === "read"
          ? t("AI 已读")
          : t("已发送，等 AI 读取");

  // The place marks go: the one chosen before, as a running session if
  // one is (the most recently active).
  const chosenTarget = () => getSettings().aiTarget || null;
  const liveFor = (target) =>
    target &&
    state.sessions.find(
      (s) => s.client === target.client && samePath(s.cwd, target.cwd),
    );

  async function send() {
    const target = chosenTarget();
    if (!target) {
      choosing = true;
      return paintPanel();
    }
    const live = liveFor(target);
    const name = targetName(target);
    take(
      await api.sendMarks({
        client: target.client,
        cwd: target.cwd,
        session: live?.id ?? null,
      }),
    );
    report(
      !live
        ? t("已发送。{target} 下次启动时会收到", { target: name })
        : live.push
          ? t("已发送给 {target}", { target: name })
          : t(
              "已发送。{client} 收不到推送：在 {client} 里让它读取 Marklore 的标记",
              {
                client: clientName(target.client),
              },
            ),
    );
  }
  function choose(session, thenSend) {
    changeSettings({
      aiTarget: {
        client: session.client,
        cwd: session.cwd,
        folder: session.folder,
      },
    });
    choosing = false;
    if (thenSend) return send();
    paintPanel();
  }

  // The list: marks not sent yet, by note, and where they go; then the
  // batches sent and not finished, with the AI's replies.
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
    if (choosing) return paintChoice();
    const unsent = drafts();
    const section = (label) => {
      const h = document.createElement("h3");
      h.textContent = label;
      panel.append(h);
    };
    section(t("未发送（{count}）", { count: unsent.length }));
    if (!unsent.length) {
      const empty = document.createElement("p");
      empty.className = "marks-empty";
      empty.textContent = t("选中文字，右键“标记给 AI…”。标好几处后一起发送。");
      panel.append(empty);
    }
    const byNote = new Map();
    for (const mark of unsent) {
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
        const open = button$(item, "", () => reveal(mark), "mark-item");
        const quote = document.createElement("span");
        quote.className = "mark-item-quote";
        quote.textContent = oneLine(mark.quote, 60);
        const words = document.createElement("span");
        words.className = "mark-item-text";
        words.textContent = mark.text;
        open.append(quote, words);
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
    if (unsent.length) {
      const row = document.createElement("div");
      row.className = "marks-send";
      const target = chosenTarget();
      const to = document.createElement("span");
      to.className = "marks-to";
      to.textContent = t("发送给");
      row.append(to);
      const where = button$(
        row,
        target
          ? targetName(target) + (liveFor(target) ? "" : t("（未运行）"))
          : t("选择…"),
        () => {
          choosing = true;
          paintPanel();
        },
        "marks-target",
      );
      where.title = t("更改发送对象");
      button$(
        row,
        t("发送 {count} 条", { count: unsent.length }),
        send,
        "primary",
      );
      panel.append(row);
    }
    if (state.batches.length) section(t("已发送"));
    for (const batch of state.batches) {
      const box = document.createElement("div");
      box.className = "marks-batch";
      box.dataset.status = batch.status;
      const line = document.createElement("div");
      line.className = "marks-batch-head";
      const when = document.createElement("span");
      when.textContent = `${time.format(new Date(batch.created))} · ${targetName(batch.target)} · ${t("{count} 条", { count: batch.marks.length })}`;
      const status = document.createElement("span");
      status.className = "marks-status";
      status.textContent =
        batch.status === "replied"
          ? t("AI 已回复")
          : batch.status === "read"
            ? t("AI 已读")
            : t("等 AI 读取");
      line.append(when, status);
      box.append(line);
      const list = document.createElement("ol");
      list.className = "marks-batch-list";
      for (const mark of batch.marks) {
        const item = document.createElement("li");
        const open = button$(
          item,
          "",
          () => reveal({ ...mark, batch: batch.id }),
          "mark-item",
        );
        const words = document.createElement("span");
        words.className = "mark-item-text";
        words.textContent = `${mark.name}：${mark.text}`;
        open.append(words);
        list.append(item);
      }
      box.append(list);
      for (const reply of batch.replies) {
        const answer = document.createElement("div");
        answer.className = "marks-reply";
        const who = document.createElement("strong");
        who.textContent = clientName(reply.by);
        const body = document.createElement("p");
        body.textContent = reply.text;
        answer.append(who, body);
        box.append(answer);
      }
      const actions = document.createElement("div");
      actions.className = "mark-actions";
      button$(actions, t("完成"), async () => {
        if (
          batch.status !== "replied" &&
          !confirm(t("AI 还没有回复这批标记。仍然完成，去掉这些标记？"))
        )
          return;
        take(await api.finishBatch(batch.id));
      }).title = t("这批处理完了：去掉正文里的这些标记");
      box.append(actions);
      panel.append(box);
    }
  }
  function paintChoice() {
    const sendAfter = !chosenTarget();
    const h = document.createElement("h3");
    h.textContent = t("发送给哪个 AI 会话？");
    panel.append(h);
    const note = document.createElement("p");
    note.className = "marks-empty";
    note.textContent = state.sessions.length
      ? t("以后都发给它，直到你更改。")
      : t("没有正在运行的 AI 会话：先在终端里启动 Claude Code 或 Codex。");
    panel.append(note);
    const list = document.createElement("ul");
    list.className = "marks-list marks-sessions";
    for (const session of state.sessions) {
      const item = document.createElement("li");
      const pick = button$(
        item,
        "",
        () => choose(session, sendAfter),
        "mark-item",
      );
      const name = document.createElement("span");
      name.className = "mark-item-text";
      name.textContent = targetName(session);
      const where = document.createElement("span");
      where.className = "mark-item-quote";
      where.textContent = session.push
        ? session.cwd
        : `${session.cwd} · ${t("收不到推送")}`;
      pick.append(name, where);
      pick.title = session.cwd;
      list.append(item);
    }
    panel.append(list);
    const actions = document.createElement("div");
    actions.className = "mark-actions";
    button$(actions, t("返回"), () => {
      choosing = false;
      paintPanel();
    });
    panel.append(actions);
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
    choosing = false;
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
