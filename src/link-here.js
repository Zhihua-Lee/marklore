// "Copy link to here": a link to the heading, definition or paragraph under
// the pointer. A heading has its anchor already; a paragraph without one gets
// <a id="..."></a> above it (a list item, at its start), named after its bold
// lead and editable. The link carries the note's full path; pasting it into a
// note in Marklore turns it into a path relative to that note.
import { headingSlug } from "../desktop/slug.mjs";
import { t } from "../desktop/i18n.mjs";
import { explicitAnchors, markedBlock, blockLabel } from "./backlinks.js";

const HEADINGS = "h1,h2,h3,h4,h5,h6";
// Blocks that take an anchor line above them, outermost first.
const LINE_BLOCKS = "blockquote,table,pre,.math-block,figure,dl,p";
const ID = /^[\p{L}\p{N}_-]+$/u;
const FILE_LINK = /^\[([^\]\n]*)\]\((file:\/\/\/[^)\s]+)\)$/;

// A whole note when there is no anchor id.
function fileUrl(path, id) {
  const url = "file:///" + path.replace(/\\/g, "/").replace(/^\/+/, "");
  return (
    encodeURI(url).replace(/[()]/g, (c) => encodeURIComponent(c)) +
    (id ? "#" + encodeURIComponent(id) : "")
  );
}

// A path relative to a folder (Windows rules: either separator, any case).
export function relativePath(fromFolder, to) {
  const split = (p) => p.replace(/\\/g, "/").split("/").filter(Boolean);
  const from = split(fromFolder),
    target = split(to);
  if (
    !from.length ||
    !target.length ||
    from[0].toLowerCase() !== target[0].toLowerCase()
  )
    return null;
  let common = 0;
  while (
    common < from.length &&
    common < target.length - 1 &&
    from[common].toLowerCase() === target[common].toLowerCase()
  )
    common++;
  return [
    ...Array(from.length - common).fill(".."),
    ...target.slice(common),
  ].join("/");
}

// A copied file:/// link to a note, rewritten relative to the note it is
// pasted into ("#id" within the same note). Other text is left alone.
export function pastedLink(text, doc) {
  const match = text.trim().match(FILE_LINK);
  if (!match || !doc?.path) return null;
  let url;
  try {
    url = new URL(match[2]);
  } catch {
    return null;
  }
  const target = decodeURIComponent(url.pathname).replace(
    /^\/([A-Za-z]:)/,
    "$1",
  );
  if (!/\.(md|markdown|mdown|mkd|txt)$/i.test(target)) return null;
  const hash = url.hash;
  const folder = doc.path.replace(/[\\/][^\\/]*$/, "");
  const same =
    target.replace(/\\/g, "/").toLowerCase() ===
    doc.path.replace(/\\/g, "/").toLowerCase();
  const rel = same ? "" : relativePath(folder, target);
  if (rel === null) return null;
  const href =
    rel
      .split("/")
      .map((part) => part.replace(/[ ()<>%]/g, (c) => encodeURIComponent(c)))
      .join("/") + hash;
  return `[${match[1]}](${href})`;
}

export function createLinkHere({
  content,
  view,
  getActive,
  render,
  report,
  copyText,
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "anchor-dialog";
  dialog.setAttribute("aria-labelledby", "anchor-dialog-title");
  document.body.append(dialog);

  // What to link to: a heading, an anchored block, or a block needing one.
  function locate(element) {
    const heading = element.closest(HEADINGS);
    if (heading && content.contains(heading))
      return { id: heading.id, label: blockLabel(heading) };
    const item = element.closest("li");
    const block =
      (item && content.contains(item) && item) ||
      [...LINE_BLOCKS.split(",")]
        .map((selector) => element.closest(selector))
        .find((el) => el && content.contains(el));
    if (!block) return null;
    const anchor = explicitAnchors(content).find(
      (a) => markedBlock(a, content) === block,
    );
    return { id: anchor?.id, label: blockLabel(block), block };
  }

  function suggestId(label, doc) {
    let base =
      headingSlug(
        label.replace(/[（）()【】\[\]、，,。.:：;；!?！？'"“”‘’]/g, " "),
      ).slice(0, 48) || "section";
    let id = base,
      n = 2;
    while (
      content.querySelector("#" + CSS.escape(id)) ||
      doc.text.includes(`id="${id}"`)
    )
      id = `${base}-${n++}`;
    return id;
  }

  // Where the anchor goes in the source, and what is inserted there.
  function insertion(block, id, text) {
    const from = Number(block.closest("[data-from]")?.dataset.from);
    if (!Number.isFinite(from)) return null;
    const tag = `<a id="${id}"></a>`;
    if (block.matches("li")) {
      const marker = text
        .slice(from)
        .match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/);
      if (!marker) return null;
      return { from: from + marker[0].length, insert: tag };
    }
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    return { from: lineStart, insert: tag + "\n\n" };
  }

  function ask(doc, place) {
    return new Promise((resolve) => {
      const id = suggestId(place.label, doc);
      dialog.innerHTML = `<form method="dialog"><h2 id="anchor-dialog-title">${t("复制指向这里的链接")}</h2><p class="anchor-dialog-what"></p><label>${t("锚点名称")}<input name="id" required spellcheck="false" maxlength="60"></label><p class="anchor-dialog-hint">${t("将在这一段上方加入锚点，保存本笔记后，其他笔记中的链接即可跳到这里。")}</p><p class="insert-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" data-cancel>${t("取消")}</button><button type="submit" class="primary">${t("加入锚点并复制")}</button></div></form>`;
      dialog.querySelector(".anchor-dialog-what").textContent = place.label;
      const input = dialog.querySelector("input");
      input.value = id;
      dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
      dialog.querySelector("form").onsubmit = (event) => {
        const value = input.value.trim();
        const error = dialog.querySelector(".insert-error");
        const taken =
          content.querySelector("#" + CSS.escape(value)) ||
          doc.text.includes(`id="${value}"`);
        if (!ID.test(value) || taken) {
          event.preventDefault();
          error.textContent = taken
            ? t("这个名称已被本笔记使用")
            : t("名称只能包含文字、数字、- 和 _");
          error.hidden = false;
          return;
        }
        resolve(value);
      };
      dialog.onclose = () => resolve(null);
      dialog.showModal();
      input.select();
    });
  }

  async function copy(element) {
    const doc = getActive();
    if (!doc?.path) return report(t("请先保存当前笔记，链接需要它的位置"));
    const place = locate(element);
    if (!place) return report(t("这里无法加入锚点"));
    let id = place.id,
      added = false;
    if (!id) {
      id = await ask(doc, place);
      if (!id || doc !== getActive()) return;
      const text = view.state.doc.toString();
      const change = insertion(place.block, id, text);
      if (!change) return report(t("这里无法加入锚点"));
      view.dispatch({ changes: change, userEvent: "input.anchor" });
      render();
      added = true;
    }
    const label = place.label.replace(/[[\]]/g, "");
    await copyText(`[${label}](${fileUrl(doc.path, id)})`);
    report(
      added
        ? t("已加入锚点并复制链接；保存本笔记后链接生效")
        : t("已复制指向“{label}”的链接", { label }),
    );
  }

  // From the library: a link to a whole note.
  async function copyNote(path) {
    const label = path
      .replace(/^.*[\\/]/, "")
      .replace(/\.(md|markdown|mdown|mkd|txt)$/i, "")
      .replace(/[[\]]/g, "");
    await copyText(`[${label}](${fileUrl(path)})`);
    report(t("已复制指向“{label}”的链接", { label }));
  }

  return { copy, copyNote };
}
