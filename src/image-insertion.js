import { isolateHistory } from "@codemirror/commands";
import { markdownEdit } from "./markdown-edits.js";

export const isImageFile = (file) =>
  /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(file.name) ||
  /^image\//i.test(file.type);
export function createImageInsertion({
  view,
  getDocument,
  getBlockEditor,
  api,
  report,
}) {
  let busy = false;
  function capture(event) {
    const doc = getDocument();
    if (!doc?.fileId) throw Error("请先保存笔记，再插入本地图片。");
    const local = getBlockEditor().imageInsertion();
    if (local) return { doc, commit: local };
    const state = view.state;
    let { from, to } = state.selection.main;
    if (event?.type === "drop" && event.target?.closest?.("#editor")) {
      from = to =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? to;
    } else if (doc.mode === "read" || event?.target?.closest?.("#reader")) {
      const target = event?.target?.closest?.("[data-edit-to]");
      from = to =
        target && doc.previewText === doc.text
          ? Number(target.dataset.editTo)
          : state.doc.length;
    }
    return {
      doc,
      commit(images) {
        if (doc !== getDocument() || state.doc !== view.state.doc) return false;
        view.dispatch({
          ...markdownEdit(state.doc.toString(), from, to, "images", { images }),
          annotations: isolateHistory.of("full"),
          userEvent: "input.image",
        });
        return true;
      },
    };
  }
  async function insert(files, event) {
    if (busy) {
      report("正在插入图片，请稍后。");
      return;
    }
    busy = true;
    try {
      const { doc, commit } = capture(event);
      if (!api?.pickImage || (files && !api?.insertImages))
        throw Error("请在桌面版中插入图片。");
      const result = files
        ? await api.insertImages(doc.fileId, files)
        : {
            images: [await api.pickImage(doc.fileId)].filter(Boolean),
            errors: [],
          };
      if (result.images.length && !commit(result.images))
        report(
          "图片已复制到 assets；笔记已切换或修改，未插入到其他位置。请重新插入。",
        );
      if (result.errors.length) report(result.errors.slice(0, 3).join("；"));
    } catch (error) {
      report(error.message);
    } finally {
      busy = false;
    }
  }
  document.addEventListener(
    "paste",
    (event) => {
      if (
        document.querySelector("dialog[open]") ||
        !event.target.closest(".cm-editor,#reader")
      )
        return;
      const files = [...(event.clipboardData?.files || [])].filter(isImageFile);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      insert(files, event);
    },
    true,
  );
  return { insert, pick: () => insert(null) };
}
