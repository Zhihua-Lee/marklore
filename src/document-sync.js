import { t } from "../desktop/i18n.mjs";
// Disk synchronisation for open notes: save, save as, change detection and
// the conflict bar shown when a dirty note changed on disk.
export function createDocumentSync({
  api,
  tabs,
  getActive,
  dirty,
  run,
  report,
  conflictBar,
  capture,
  finishEditing,
  redisplay,
  updateStatus,
  updateTabs,
  changed,
}) {
  async function save(as = false, doc = getActive()) {
    if (!doc) return false;
    if (!api) {
      report(t("浏览器演示不写入磁盘；请运行桌面版"));
      return false;
    }
    if (doc.saving) return false;
    doc.saving = true;
    let conflict = false;
    try {
      const text = doc.text;
      if (as || !doc.fileId) {
        const excludedIds = tabs
          .filter((t) => t !== doc && t.fileId)
          .map((t) => t.fileId);
        const file = await api.saveAs(text, doc.name, excludedIds);
        if (!file) return false;
        const other = tabs.find(
          (t) => t !== doc && (t.fileId === file.id || t.path === file.path),
        );
        if (other) {
          report(
            t(
              "目标已在另一标签中打开，未合并标签；两份编辑内容均已保留，请检查目标文件。",
            ),
          );
          run(() => checkDisk(other))();
          return false;
        }
        doc.fileId = file.id;
        doc.path = file.path;
        doc.name = file.name;
        doc.version = file.version;
      } else {
        const result = await api.save(doc.fileId, text, doc.version);
        if (result.conflict) {
          conflict = true;
          return false;
        }
        doc.version = result.version;
      }
      doc.base = text;
      doc.conflict = null;
      doc.epoch++;
      doc.htmlText = null;
      if (doc === getActive()) {
        showConflict();
        updateStatus();
      }
      updateTabs();
      changed();
      return true;
    } finally {
      doc.saving = false;
      if (conflict) {
        // checkDisk deliberately ignores saves in flight; release that guard first.
        await checkDisk(doc, true);
        report(t("磁盘内容已改变，未覆盖。请处理冲突或另存副本。"));
      }
    }
  }
  // Replace a note's contents with a disk version, keeping the reading position.
  function loadFromDisk(doc, file) {
    const current = doc === getActive();
    if (current) {
      finishEditing();
      capture();
    }
    doc.text = file.text;
    doc.base = file.text;
    doc.version = file.version;
    doc.epoch++;
    doc.htmlText = null;
    doc.state = null;
    if (current) redisplay(doc);
  }
  async function checkDisk(doc = getActive(), manual = false) {
    if (!api || !doc?.fileId || doc.checking || doc.saving) return;
    doc.checking = true;
    const epoch = doc.epoch,
      text = doc.text;
    try {
      const result = await api.read(doc.fileId, doc.version);
      if (
        !tabs.includes(doc) ||
        doc.epoch !== epoch ||
        doc.text !== text ||
        doc.saving
      )
        return;
      if (result.unchanged) {
        if (manual) report(t("已是磁盘最新版本"));
        return;
      }
      if (dirty(doc)) {
        doc.conflict = result;
        if (doc === getActive()) showConflict();
        return;
      }
      loadFromDisk(doc, result);
      if (doc === getActive()) updateStatus();
      changed();
      if (manual) report(t("已从磁盘刷新"));
    } catch (e) {
      if (manual || doc === getActive())
        report(t("保留当前内容：{message}", { message: e.message }));
    } finally {
      doc.checking = false;
    }
  }
  function showConflict() {
    const bar = conflictBar;
    bar.replaceChildren();
    bar.hidden = !getActive()?.conflict;
    if (bar.hidden) return;
    const doc = getActive(),
      label = document.createElement("span");
    label.textContent = t("磁盘有新版本，你的未保存内容已保留。");
    bar.append(label);
    const load = document.createElement("button");
    load.textContent = t("加载磁盘版本");
    load.onclick = async () => {
      // Destructive resolution uses an explicit confirmation, not a one-click discard.
      if (
        !window.confirm(t("放弃当前未保存修改，加载磁盘版本？建议先另存副本。"))
      )
        return;
      loadFromDisk(doc, doc.conflict);
      doc.conflict = null;
      showConflict();
      updateTabs();
      changed();
    };
    const copy = document.createElement("button");
    copy.textContent = t("另存我的副本");
    copy.onclick = run(() => save(true, doc));
    const keep = document.createElement("button");
    keep.textContent = t("继续编辑");
    keep.onclick = () => {
      bar.hidden = true;
      report(t("保留编辑；原文件仍有冲突，保存时会再次检查。"));
    };
    bar.append(load, copy, keep);
  }
  return { save, checkDisk, showConflict };
}
