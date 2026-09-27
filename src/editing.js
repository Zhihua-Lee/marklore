import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { undo, redo, isolateHistory } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdownEdit } from "./markdown-edits.js";
import { icon } from "./icons.js";
import { openColorPicker } from "./color-picker.js";
import "./editing.css";

export const editingHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier], color: "var(--editor-keyword)" },
    {
      tag: [tags.string, tags.special(tags.string)],
      color: "var(--editor-string)",
    },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--editor-number)" },
    { tag: [tags.comment, tags.meta], color: "var(--editor-comment)" },
    { tag: tags.labelName, color: "var(--editor-link)" },
    {
      tag: [tags.typeName, tags.className, tags.function(tags.variableName)],
      color: "var(--editor-function)",
    },
    {
      tag: [tags.url, tags.link],
      color: "var(--editor-link)",
      textDecoration: "underline",
    },
    { tag: [tags.heading, tags.strong], fontWeight: "600" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.processingInstruction, color: "var(--editor-comment)" },
  ]),
);

const buttons = [
  ["bold", "粗体", "<b>B</b>", "Ctrl+B"],
  ["italic", "斜体", "<i>I</i>", "Ctrl+I"],
  ["strike", "删除线", "<s>S</s>"],
  ["highlight", "文字高亮", icon("highlight")],
  ["color", "文字颜色", icon("textColor")],
  ["bullet", "无序列表", icon("listBullet")],
  ["ordered", "有序列表", icon("listOrdered")],
  ["task", "任务列表", icon("task")],
  ["quote", "引用", icon("quote")],
  ["inline", "行内代码", "&lt;/&gt;", "Ctrl+E"],
  ["code", "代码块", icon("codeBlock")],
  ["math", "公式块", "∑"],
  ["link", "插入链接", icon("link"), "Ctrl+K"],
  ["image", "插入图片", icon("image")],
  ["table", "插入表格", icon("table")],
];
export function wireEditing({ view, getDocument, insertImage }) {
  const host = document.createElement("div");
  host.className = "editing-tools";
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "Markdown 格式工具");
  host.innerHTML = `<div class="edit-history"><button type="button" data-edit="undo" aria-label="撤销" title="撤销 Ctrl+Z">${icon("undo")}</button><button type="button" data-edit="redo" aria-label="重做" title="重做 Ctrl+Shift+Z">${icon("redo")}</button></div><select aria-label="段落样式" title="段落样式"><option value="">段落</option><option value="0">正文</option>${Array.from({ length: 6 }, (_, i) => `<option value="${i + 1}">标题 ${i + 1}</option>`).join("")}</select>${buttons.map(([id, label, content, shortcut]) => `<button type="button" data-edit="${id}" aria-label="${label}" title="${label}${shortcut ? " " + shortcut : ""}">${content}</button>`).join("")}<select aria-label="更多格式" title="更多格式"><option value="">更多</option><option value="inlineMath">行内公式</option><option value="rule">分割线</option></select>`;
  const groups = [
    ["编辑历史", [".edit-history"]],
    [
      "文字样式",
      [
        '[aria-label="段落样式"]',
        ...["bold", "italic", "strike", "highlight", "color", "inline"].map(
          (id) => `[data-edit="${id}"]`,
        ),
      ],
    ],
    [
      "段落结构",
      ["bullet", "ordered", "task", "quote"].map((id) => `[data-edit="${id}"]`),
    ],
    [
      "插入内容",
      [
        ...["link", "image", "table", "code", "math"].map(
          (id) => `[data-edit="${id}"]`,
        ),
        '[aria-label="更多格式"]',
      ],
    ],
  ];
  for (const [label, selectors] of groups) {
    const group = document.createElement("div");
    group.className = "edit-tool-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    for (const selector of selectors)
      group.append(host.querySelector(selector));
    host.append(group);
  }
  document.querySelector(".pane-caption").replaceWith(host);
  // Preserve the existing status target without taking up a toolbar row.
  const position = document.createElement("span");
  position.id = "editor-position";
  position.className = "sr-only";
  host.append(position);
  const dialog = document.createElement("dialog");
  dialog.id = "edit-insert";
  dialog.setAttribute("aria-labelledby", "edit-insert-title");
  document.body.append(dialog);
  const apply = (action, options = {}, expected = getDocument()) => {
    if (!expected || expected !== getDocument() || expected.mode === "read")
      return false;
    if (action === "undo" || action === "redo") {
      (action === "undo" ? undo : redo)(view);
    } else {
      const { from, to } = view.state.selection.main;
      const change = markdownEdit(
        view.state.doc.toString(),
        from,
        to,
        action,
        options,
      );
      view.dispatch({
        ...change,
        scrollIntoView: true,
        annotations: isolateHistory.of("full"),
        userEvent: "input.format",
      });
    }
    expected.pane = "editor";
    view.focus();
    return true;
  };
  function insertForm(action) {
    const doc = getDocument(),
      state = view.state;
    if (!doc || doc.mode === "read") return;
    const selection = state.selection.main;
    const title = { link: "插入链接", table: "插入表格", code: "代码块" }[
      action
    ];
    const fields =
      action === "table"
        ? '<div class="insert-grid"><label>列数<input name="columns" type="number" min="1" max="12" value="3" required></label><label>正文行数<input name="rows" type="number" min="1" max="30" value="3" required></label></div><p>首行为表头；插入后可按 Tab 在单元格间移动。</p>'
        : action === "code"
          ? '<label>语言<input name="language" list="code-languages" placeholder="text / python / javascript…" pattern="[a-zA-Z0-9_+#.\\-]*" maxlength="40" autofocus></label><datalist id="code-languages"><option value="python"><option value="javascript"><option value="typescript"><option value="r"><option value="julia"><option value="cpp"><option value="sql"><option value="bash"><option value="json"><option value="markdown"><option value="mermaid"></datalist>'
          : '<label>显示文字<input name="label" maxlength="2000"></label><label>链接或文件路径<input name="url" required placeholder="https://… 或 chapter.md#标题" autofocus></label>';
    dialog.innerHTML = `<form><h2 id="edit-insert-title">${title}</h2>${fields}<p class="insert-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" data-cancel>取消</button><button type="submit" class="primary">插入</button></div></form>`;
    if (action === "link")
      dialog.querySelector('[name="label"]').value = state.sliceDoc(
        selection.from,
        selection.to,
      );
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      try {
        if (doc !== getDocument() || state !== view.state)
          throw Error("笔记已改变，请关闭此窗口后重新插入。");
        apply(
          action,
          Object.fromEntries(new FormData(event.currentTarget)),
          doc,
        );
        dialog.close();
      } catch (error) {
        const message = dialog.querySelector(".insert-error");
        message.textContent = error.message;
        message.hidden = false;
      }
    };
    dialog.onclose = () => {
      if (doc === getDocument()) view.focus();
    };
    dialog.showModal();
  }
  function execute(action) {
    if (["highlight", "color"].includes(action)) {
      const doc = getDocument(),
        state = view.state;
      if (!doc || doc.mode === "read") return false;
      openColorPicker(
        action,
        (options) => {
          if (doc !== getDocument() || state !== view.state)
            throw Error("笔记已改变，请重新选择文字。");
          apply(action, options, doc);
        },
        () => {
          if (doc === getDocument()) view.focus();
        },
      );
    } else if (["link", "table", "code"].includes(action)) insertForm(action);
    else if (action === "image") insertImage();
    else apply(action);
    return true;
  }
  host.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  host.addEventListener("click", (event) => {
    const action = event.target.closest("[data-edit]")?.dataset.edit;
    if (action) execute(action);
  });
  host.querySelector('[aria-label="段落样式"]').onchange = (event) => {
    if (event.target.value !== "")
      apply("heading", { level: event.target.value });
    event.target.value = "";
  };
  host.querySelector('[aria-label="更多格式"]').onchange = (event) => {
    if (event.target.value) execute(event.target.value);
    event.target.value = "";
  };
  return Prec.highest(
    keymap.of([
      ...[
        ["Mod-b", "bold"],
        ["Mod-i", "italic"],
        ["Mod-e", "inline"],
        ["Mod-k", "link"],
      ].map(([key, action]) => ({ key, run: () => execute(action) })),
      { key: "Tab", run: () => tableCell(view, 1) },
      { key: "Shift-Tab", run: () => tableCell(view, -1) },
    ]),
  );
}

// Navigate existing pipe cells, excluding escaped pipes and code spans.
function tableCell(view, direction) {
  const { head, empty } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  if (!/^\s*\|/.test(line.text)) return false;
  const cells = (row) => {
    const pipes = [];
    let ticks = 0;
    for (let i = 0; i < row.text.length; i++) {
      if (row.text[i] === "\\") {
        i++;
        continue;
      }
      if (row.text[i] === "`") {
        let end = i + 1;
        while (row.text[end] === "`") end++;
        const length = end - i;
        if (!ticks) ticks = length;
        else if (ticks === length) ticks = 0;
        i = end - 1;
      } else if (row.text[i] === "|" && !ticks) pipes.push(i);
    }
    return pipes
      .slice(0, -1)
      .map((p, i) => ({ from: row.from + p + 1, to: row.from + pipes[i + 1] }));
  };
  const current = cells(line),
    index = current.findIndex((c) => head >= c.from && head <= c.to);
  if (
    index < 0 ||
    (!empty && view.state.selection.main.from < current[index].from)
  )
    return false;
  let target = current[index + direction];
  for (
    let n = line.number + direction;
    !target && n >= 1 && n <= view.state.doc.lines;
    n += direction
  ) {
    const row = view.state.doc.line(n);
    if (!/^\s*\|/.test(row.text)) break;
    if (row.text.includes("-") && /^\s*\|[\s:|\-]+$/.test(row.text)) continue;
    const adjacent = cells(row);
    target = direction > 0 ? adjacent[0] : adjacent.at(-1);
  }
  if (!target) return false;
  const value = view.state.sliceDoc(target.from, target.to);
  const leading = value.match(/^\s*/)[0].length,
    trailing = value.match(/\s*$/)[0].length;
  const from = target.from + Math.min(leading, value.length);
  view.dispatch({
    selection: { anchor: from, head: Math.max(from, target.to - trailing) },
    scrollIntoView: true,
  });
  return true;
}
