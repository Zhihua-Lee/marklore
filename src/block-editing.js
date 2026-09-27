import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import {
  history,
  historyKeymap,
  defaultKeymap,
  isolateHistory,
  undo,
  redo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { editingHighlight } from "./editing.js";
import { markdownEdit } from "./markdown-edits.js";
import { atPoint, selectionSource } from "./positions.js";
import { icon } from "./icons.js";
import { wireColorButton, closeColorPicker } from "./color-picker.js";
import "./block-editing.css";

const labels = {
  paragraph_open: "段落",
  heading_open: "标题",
  bullet_list_open: "列表",
  ordered_list_open: "列表",
  blockquote_open: "引用",
  table_open: "表格",
  fence: "代码块",
  code_block: "代码块",
  folio_math_block: "公式",
  hr: "分割线",
};
export function createBlockEditor({
  content,
  reader,
  sourceView,
  getDocument,
  onFinish,
  report,
  insertImage,
}) {
  let session = null,
    target = null,
    pointer = null,
    applying = false,
    frame = 0;
  const launch = document.createElement("button");
  launch.id = "block-edit-launch";
  launch.type = "button";
  launch.hidden = true;
  launch.innerHTML = icon("pencil");
  launch.title = "就地编辑此块 · Alt+Enter";
  launch.setAttribute("aria-label", "就地编辑此块");
  document.body.append(launch);
  function position() {
    frame = 0;
    if (
      session ||
      !target?.isConnected ||
      !target.getClientRects().length ||
      getDocument()?.mode !== "edit"
    ) {
      launch.hidden = true;
      return;
    }
    const r = target.getBoundingClientRect(),
      viewport = reader.getBoundingClientRect();
    if (r.bottom < viewport.top || r.top > viewport.bottom) {
      launch.hidden = true;
      return;
    }
    launch.hidden = false;
    launch.style.left = Math.min(viewport.right - 38, r.right + 4) + "px";
    launch.style.top = Math.max(viewport.top + 40, r.top) + "px";
  }
  function selectTarget(element) {
    if (session || getDocument()?.mode !== "edit") return;
    const next = element?.closest("[data-edit-from]");
    if (!next || !content.contains(next)) return;
    if (target !== next) {
      target?.classList.remove("block-edit-hover");
      target = next;
      target.classList.add("block-edit-hover");
      position();
    }
  }
  content.addEventListener("pointermove", (event) => {
    if (event.target.closest(".block-editor")) return;
    pointer = { x: event.clientX, y: event.clientY };
    selectTarget(event.target);
  });
  document.addEventListener(
    "pointermove",
    (event) => {
      if (
        !target ||
        session ||
        reader.contains(event.target) ||
        launch.contains(event.target)
      )
        return;
      target.classList.remove("block-edit-hover");
      target = null;
      launch.hidden = true;
    },
    { passive: true },
  );
  reader.addEventListener(
    "scroll",
    () => {
      if (!frame) frame = requestAnimationFrame(position);
    },
    { passive: true },
  );
  const resize = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(position);
  });
  resize.observe(reader);
  reader.addEventListener("focus", () => {
    const viewport = reader.getBoundingClientRect();
    // Preview selection should not measure every preceding block in a long note.
    for (const x of [viewport.left + viewport.width / 2, viewport.left + 48]) {
      const element = document.elementFromPoint(x, viewport.top + 48);
      if (element?.closest("[data-edit-from]") && content.contains(element)) {
        selectTarget(element);
        return;
      }
    }
    selectTarget(
      [...content.querySelectorAll("[data-edit-from]")].find(
        (el) =>
          el.getBoundingClientRect().bottom > viewport.top &&
          el.getClientRects().length,
      ),
    );
  });
  launch.addEventListener("mousedown", (event) => event.preventDefault());
  launch.addEventListener("click", () => begin());
  reader.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "Enter" && !session) {
      event.preventDefault();
      if (!target?.isConnected) reader.dispatchEvent(new Event("focus"));
      begin();
    }
  });

  function begin() {
    const doc = getDocument();
    if (session || !doc || !target?.isConnected || doc.mode !== "edit") return;
    if (doc.previewText !== doc.text) {
      report("预览正在更新，请稍后再试。");
      return;
    }
    const from = Number(target.dataset.editFrom);
    let to = Number(target.dataset.editTo);
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to > doc.text.length ||
      to <= from
    )
      return;
    while (to > from && doc.text[to - 1] === "\n") to--;
    const original = doc.text.slice(from, to),
      kind = target.dataset.editKind;
    const selected = selectionSource(content),
      hit = pointer && atPoint(content, pointer.x, pointer.y);
    const point = selected?.from ?? hit?.from ?? from;
    const offset = Math.max(0, Math.min(original.length, point - from));
    const panel = document.createElement("section");
    panel.className = "block-editor";
    panel.dataset.kind = kind;
    panel.dataset.from = String(from);
    panel.dataset.to = String(to);
    panel.setAttribute("aria-label", `就地编辑${labels[kind] || "源码块"}`);
    panel.innerHTML = `<div class="block-edit-tools" role="group" aria-label="就地编辑格式"><span class="block-edit-label">${labels[kind] || "源码块"}</span><button type="button" data-format="bold" title="粗体 Ctrl+B" aria-label="就地加粗"><b>B</b></button><button type="button" data-format="italic" title="斜体 Ctrl+I" aria-label="就地斜体"><i>I</i></button><button type="button" data-format="inline" title="行内代码 Ctrl+E" aria-label="就地行内代码">&lt;/&gt;</button><button type="button" data-format="link" title="链接 Ctrl+K" aria-label="就地插入链接">${icon("link")}</button><span class="block-edit-spacer"></span><button type="button" data-history="undo" aria-label="就地撤销" title="撤销">${icon("undo")}</button><button type="button" data-history="redo" aria-label="就地重做" title="重做">${icon("redo")}</button></div><form class="block-edit-link" hidden><label>链接<input name="url" required placeholder="https://… 或 chapter.md"></label><button type="submit">插入</button><button type="button" data-link-cancel>取消</button><span role="alert"></span></form><div class="block-edit-input"></div><div class="block-edit-actions"><span>Markdown · Ctrl+Enter 完成</span><button type="button" data-cancel>取消</button><button type="button" data-done>完成</button></div>`;
    target.classList.remove("block-edit-hover");
    const picture = document.createElement("button");
    picture.type = "button";
    picture.setAttribute("aria-label", "就地插入图片");
    picture.title = "插入图片";
    picture.innerHTML = icon("image");
    panel.querySelector(".block-edit-spacer").before(picture);
    for (const [action, label, glyph] of [
      ["highlight", "文字高亮", "highlight"],
      ["color", "文字颜色", "textColor"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.format = action;
      button.setAttribute("aria-label", "就地" + label);
      button.title = label;
      button.innerHTML = icon(glyph);
      panel.querySelector('[data-format="inline"]').before(button);
    }
    for (const [label, controls] of [
      [
        "文字样式",
        [...panel.querySelectorAll('[data-format]:not([data-format="link"])')],
      ],
      ["插入内容", [panel.querySelector('[data-format="link"]'), picture]],
      ["编辑历史", [...panel.querySelectorAll("[data-history]")]],
    ]) {
      const group = document.createElement("div");
      group.className = "edit-tool-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", label);
      group.append(...controls);
      panel.querySelector(".block-edit-tools").append(group);
    }
    panel.querySelector(".block-edit-spacer").remove();
    target.before(panel);
    const wasHidden = target.hidden;
    target.hidden = true;
    launch.hidden = true;
    session = {
      doc,
      from,
      to,
      original,
      expected: doc.text,
      panel,
      target,
      wasHidden,
      editor: null,
    };
    doc.pane = "preview";
    const local = new EditorView({
      parent: panel.querySelector(".block-edit-input"),
      state: EditorState.create({
        doc: original,
        selection: {
          anchor: offset,
          head:
            selected && selected.to >= from && selected.to <= to
              ? selected.to - from
              : offset,
        },
        extensions: [
          markdown(),
          editingHighlight,
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "当前块 Markdown",
            spellcheck: "false",
          }),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  finish();
                  return true;
                },
              },
              {
                key: "Escape",
                run: () => {
                  cancel();
                  return true;
                },
              },
              ...[
                ["Mod-b", "bold"],
                ["Mod-i", "italic"],
                ["Mod-e", "inline"],
                ["Mod-k", "link"],
              ].map(([key, action]) => ({
                key,
                run: () => {
                  format(action);
                  return true;
                },
              })),
            ]),
          ),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) sync(update.state.doc.toString());
          }),
        ],
      }),
    });
    session.editor = local;
    sourceView.dispatch({ annotations: isolateHistory.of("before") });
    panel.addEventListener("dblclick", (event) => event.stopPropagation());
    panel.addEventListener("click", (event) => event.stopPropagation());
    panel.querySelector("[data-done]").onclick = finish;
    panel.querySelector("[data-cancel]").onclick = cancel;
    panel.querySelectorAll(".block-edit-tools button").forEach((button) => {
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () =>
        button.dataset.format
          ? format(button.dataset.format)
          : (button.dataset.history === "undo" ? undo : redo)(local);
    });
    picture.onclick = insertImage;
    for (const action of ["highlight", "color"])
      wireColorButton(
        panel.querySelector(`[data-format="${action}"]`),
        action,
        () => {
          const s = session,
            state = s?.editor.state;
          if (!s) return null;
          return {
            apply(options) {
              if (
                session !== s ||
                state.doc !== s.editor.state.doc ||
                state.selection !== s.editor.state.selection
              )
                throw Error("编辑内容或选区已改变，请重新选择文字。");
              if (!state.selection.main.empty) applyFormat(action, options);
            },
            focus() {
              if (session === s) s.editor.focus();
            },
          };
        },
      );
    const form = panel.querySelector("form");
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        applyFormat("link", { url: form.elements.url.value });
        form.hidden = true;
        local.focus();
      } catch (error) {
        form.querySelector('[role="alert"]').textContent = error.message;
      }
    };
    panel.querySelector("[data-link-cancel]").onclick = () => {
      form.hidden = true;
      local.focus();
    };
    local.focus();
  }
  function sync(value) {
    const s = session;
    if (
      !s ||
      s.doc !== getDocument() ||
      s.expected !== sourceView.state.doc.toString()
    ) {
      report("笔记已发生其他修改，就地编辑已停止。");
      finish();
      return;
    }
    applying = true;
    try {
      sourceView.dispatch({
        changes: { from: s.from, to: s.to, insert: value },
        userEvent: "input.block",
      });
      s.to = s.from + value.length;
      s.expected = sourceView.state.doc.toString();
      s.panel.dataset.to = String(s.to);
    } finally {
      applying = false;
    }
  }
  function applyFormat(action, options) {
    const local = session.editor,
      { from, to } = local.state.selection.main;
    local.dispatch({
      ...markdownEdit(local.state.doc.toString(), from, to, action, options),
      annotations: isolateHistory.of("full"),
      userEvent: "input.format",
      scrollIntoView: true,
    });
    local.focus();
  }
  function format(action) {
    if (action === "link") {
      const form = session.panel.querySelector("form");
      form.hidden = false;
      form.elements.url.focus();
    } else applyFormat(action);
  }
  function close(notify = true) {
    if (!session) return;
    closeColorPicker();
    const s = session,
      y =
        s.panel.getBoundingClientRect().top -
        reader.getBoundingClientRect().top;
    session = null;
    s.editor.destroy();
    s.panel.remove();
    s.target.hidden = s.wasHidden;
    target = null;
    launch.hidden = true;
    if (notify) {
      sourceView.dispatch({ annotations: isolateHistory.of("after") });
      onFinish({ from: s.from, y: Math.max(0, y) });
      reader.focus({ preventScroll: true });
    }
  }
  function finish() {
    close();
  }
  function cancel() {
    if (!session) return;
    if (session.expected === sourceView.state.doc.toString())
      sync(session.original);
    else report("笔记已有其他修改，未覆盖当前内容。");
    finish();
  }
  return {
    imageInsertion() {
      if (!session) return null;
      const s = session,
        state = s.editor.state;
      return (images) => {
        if (session !== s || state.doc !== s.editor.state.doc) return false;
        const { from, to } = state.selection.main;
        s.editor.dispatch({
          ...markdownEdit(state.doc.toString(), from, to, "images", { images }),
          annotations: isolateHistory.of("full"),
          userEvent: "input.image",
        });
        s.editor.focus();
        return true;
      };
    },
    get active() {
      return Boolean(session);
    },
    get applying() {
      return applying;
    },
    anchor: () =>
      session
        ? {
            from: session.from,
            y: Math.max(
              0,
              session.panel.getBoundingClientRect().top -
                reader.getBoundingClientRect().top,
            ),
          }
        : null,
    finish,
    sourceChanged() {
      if (session && !applying) close(false);
    },
    resetHover() {
      target?.classList.remove("block-edit-hover");
      target = null;
      launch.hidden = true;
    },
  };
}
