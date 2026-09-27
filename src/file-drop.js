import { isImageFile } from "./image-insertion.js";
export function wireFileDrop({ api, opened, report, insertImages }) {
  const isFiles = (event) =>
    [...(event.dataTransfer?.types || [])].includes("Files");
  let depth = 0;
  const clear = () => {
    depth = 0;
    document.body.classList.remove("file-drop");
  };
  document.addEventListener(
    "dragenter",
    (event) => {
      if (!isFiles(event)) return;
      event.preventDefault();
      depth++;
      document.body.classList.add("file-drop");
    },
    true,
  );
  document.addEventListener(
    "dragover",
    (event) => {
      if (!isFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    },
    true,
  );
  document.addEventListener(
    "dragleave",
    (event) => {
      if (isFiles(event) && --depth <= 0) clear();
    },
    true,
  );
  document.addEventListener(
    "drop",
    async (event) => {
      clear();
      if (!isFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const files = [...event.dataTransfer.files];
      if (!files.length) return;
      const images = files.filter(isImageFile);
      if (images.length) {
        if (images.length !== files.length)
          report("请将笔记文件和图片分开拖入，以免插入到错误的笔记。");
        else await insertImages(images, event);
        return;
      }
      if (!api?.openDroppedFiles) {
        report("请在桌面版中拖入本地 Markdown 文件");
        return;
      }
      try {
        const result = await api.openDroppedFiles(files);
        opened(result.documents);
        if (result.errors.length) report(result.errors.slice(0, 3).join("；"));
      } catch (error) {
        report(error.message);
      }
    },
    true,
  );
  window.addEventListener("blur", clear);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clear();
  });
}
