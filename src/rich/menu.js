// The editor's right-click menu: links, table rows, columns and alignment,
// and inserting a table.
import { TextSelection } from "prosemirror-state";
import {
  isInTable,
  selectedRect,
  addRowBefore,
  addRowAfter,
  addColumnBefore,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
} from "prosemirror-tables";
import { t } from "../../desktop/i18n.mjs";
import { schema } from "./markdown.js";
import { linkAt, editLink, setHref } from "./links.js";

export function attachMenu(view, { follow }) {
  const menu = document.createElement("div");
  menu.className = "rich-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  document.body.append(menu);
  const close = () => (menu.hidden = true);
  const onDown = (e) => !menu.contains(e.target) && close();
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("mousedown", onDown);
  document.addEventListener("keydown", onKey);
  addEventListener("wheel", close, { capture: true, passive: true });
  addEventListener("resize", close);
  addEventListener("blur", close);

  const run = (cmd) => () => {
    cmd(view.state, view.dispatch, view);
    view.focus();
  };
  const align = (value) => () => {
    const { state } = view;
    const rect = selectedRect(state);
    const tr = state.tr;
    for (let r = 0; r < rect.map.height; r++) {
      const pos =
        rect.tableStart + rect.map.map[r * rect.map.width + rect.left];
      tr.setNodeMarkup(pos, null, {
        ...tr.doc.nodeAt(pos).attrs,
        align: value,
      });
    }
    view.dispatch(tr);
    view.focus();
  };
  const insertTable = () => {
    const S = schema.nodes;
    const cells = (type) => [type.create(), type.create()];
    const table = S.table.create(null, [
      S.table_row.create(null, cells(S.table_header)),
      S.table_row.create(null, cells(S.table_cell)),
    ]);
    const { $from } = view.state.selection;
    const at = $from.depth ? $from.after(1) : $from.pos;
    const tr = view.state.tr.insert(at, table);
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3)));
    view.dispatch(tr);
    view.focus();
  };

  const onMenu = (e) => {
    e.preventDefault();
    const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
    const { from, to } = view.state.selection;
    if (hit && (hit.pos < from || hit.pos > to))
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.near(view.state.doc.resolve(hit.pos)),
        ),
      );
    const state = view.state;
    const items = [];
    const link = linkAt(state);
    if (link) {
      items.push([t("编辑链接"), () => editLink(view)]);
      if (link.href) items.push([t("打开链接"), () => follow(link.href)]);
      items.push([t("移除链接"), () => setHref(view, link, "")]);
      items.push(null);
    } else if (!state.selection.empty) {
      items.push([t("添加链接…"), () => editLink(view), "Ctrl+K"]);
      items.push(null);
    }
    if (isInTable(state)) {
      items.push([t("上方插入行"), run(addRowBefore)]);
      items.push([t("下方插入行"), run(addRowAfter)]);
      items.push([t("左侧插入列"), run(addColumnBefore)]);
      items.push([t("右侧插入列"), run(addColumnAfter)]);
      items.push(null);
      items.push([t("这一列左对齐"), align("left")]);
      items.push([t("这一列居中"), align("center")]);
      items.push([t("这一列右对齐"), align("right")]);
      items.push(null);
      items.push([t("删除这一行"), run(deleteRow)]);
      items.push([t("删除这一列"), run(deleteColumn)]);
      items.push([t("删除表格"), run(deleteTable)]);
    } else items.push([t("插入表格"), insertTable]);
    while (items.at(-1) === null) items.pop();
    menu.replaceChildren(
      ...items.map((item) => {
        if (!item) return document.createElement("hr");
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.textContent = item[0];
        if (item[2]) {
          const key = document.createElement("kbd");
          key.textContent = item[2];
          b.append(key);
        }
        b.addEventListener("click", () => {
          close();
          item[1]();
        });
        return b;
      }),
    );
    menu.hidden = false;
    menu.style.left =
      Math.min(e.clientX, innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top =
      Math.min(e.clientY, innerHeight - menu.offsetHeight - 8) + "px";
  };
  view.dom.addEventListener("contextmenu", onMenu);
  return () => {
    view.dom.removeEventListener("contextmenu", onMenu);
    document.removeEventListener("mousedown", onDown);
    document.removeEventListener("keydown", onKey);
    removeEventListener("wheel", close, { capture: true });
    removeEventListener("resize", close);
    removeEventListener("blur", close);
    menu.remove();
  };
}
