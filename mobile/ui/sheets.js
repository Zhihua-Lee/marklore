import { renderHeadingLabel } from "../../src/markdown.js";
import { FONT_SIZE_STEPS } from "./prefs.js";
import { STRINGS } from "./strings.js";

function createButton(text, className = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  if (className) btn.className = className;
  btn.textContent = text;
  return btn;
}

/**
 * Presents a reusable modal bottom sheet. Returns `{ body, close }`.
 */
function openBottomSheet(title, onClose) {
  const backdrop = document.createElement("div");
  backdrop.className = "mobile-sheet-backdrop";
  backdrop.setAttribute("role", "presentation");

  const sheet = document.createElement("section");
  sheet.className = "mobile-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", title);

  const header = document.createElement("header");
  header.className = "mobile-sheet-header";
  const heading = document.createElement("h2");
  heading.className = "mobile-sheet-title";
  heading.textContent = title;
  const closeBtn = createButton(STRINGS.close, "mobile-sheet-close");
  closeBtn.setAttribute("aria-label", STRINGS.close);
  header.append(heading, closeBtn);

  const body = document.createElement("div");
  body.className = "mobile-sheet-body";
  sheet.append(header, body);
  backdrop.append(sheet);
  document.body.append(backdrop);

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.body.style.overflow = prevOverflow;
    window.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
    onClose?.();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  window.addEventListener("keydown", onKeyDown);
  closeBtn.focus?.();

  return { body, close };
}

/**
 * Opens the note outline sheet; tapping any heading scrolls and closes.
 */
export function openOutlineSheet({ headings, onSelect, onClose }) {
  const { body, close } = openBottomSheet(STRINGS.outlineTitle, onClose);
  if (!headings || headings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "mobile-sheet-empty";
    empty.textContent = STRINGS.emptyOutline;
    body.append(empty);
    return close;
  }

  const minLevel = Math.min(...headings.map((h) => h.level));
  const list = document.createElement("div");
  list.className = "mobile-outline-list";
  for (const h of headings) {
    const labelHtml = renderHeadingLabel(
      String(h.label ?? h.text ?? h.id ?? ""),
    );
    const btn = createButton("", "mobile-outline-item");
    btn.innerHTML = labelHtml;
    btn.dataset.level = String(h.level);
    btn.style.setProperty(
      "--outline-indent",
      String(Math.max(0, h.level - minLevel)),
    );
    btn.addEventListener("click", () => {
      close();
      onSelect(h);
    });
    list.append(btn);
  }
  body.append(list);
  return close;
}

function buildSegmentedGroup(labelText, options, currentValue, onChange) {
  const group = document.createElement("div");
  group.className = "mobile-setting-row";
  const label = document.createElement("span");
  label.className = "mobile-setting-label";
  label.textContent = labelText;

  const seg = document.createElement("div");
  seg.className = "mobile-segmented";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", labelText);

  const buttons = [];
  const syncPressed = (activeValue) => {
    for (const item of buttons) {
      const active = item.value === activeValue;
      item.btn.classList.toggle("is-active", active);
      item.btn.setAttribute("aria-pressed", String(active));
    }
  };

  for (const opt of options) {
    const btn = createButton(opt.label, "mobile-seg-btn");
    btn.addEventListener("click", () => {
      syncPressed(opt.value);
      onChange(opt.value);
    });
    buttons.push({ value: opt.value, btn });
    seg.append(btn);
  }
  syncPressed(currentValue);
  group.append(label, seg);
  return group;
}

function buildFontSizeControl(currentSize, onChange) {
  const group = document.createElement("div");
  group.className = "mobile-setting-row mobile-setting-row-stack";

  const top = document.createElement("div");
  top.className = "mobile-setting-header";
  const label = document.createElement("span");
  label.className = "mobile-setting-label";
  label.textContent = STRINGS.fontSizeLabel;
  const readout = document.createElement("span");
  readout.className = "mobile-setting-value";
  top.append(label, readout);

  const controls = document.createElement("div");
  controls.className = "mobile-font-controls";
  const decBtn = createButton("A−", "mobile-step-btn");
  decBtn.setAttribute("aria-label", STRINGS.fontSizeSmaller);
  const incBtn = createButton("A+", "mobile-step-btn");
  incBtn.setAttribute("aria-label", STRINGS.fontSizeLarger);

  const range = document.createElement("input");
  range.type = "range";
  range.className = "mobile-font-range";
  range.min = "0";
  range.max = String(FONT_SIZE_STEPS.length - 1);
  range.step = "1";
  range.setAttribute("aria-label", STRINGS.fontSizeLabel);

  let stepIndex = Math.max(0, FONT_SIZE_STEPS.indexOf(currentSize));
  const update = (nextIndex) => {
    stepIndex = Math.max(0, Math.min(FONT_SIZE_STEPS.length - 1, nextIndex));
    const px = FONT_SIZE_STEPS[stepIndex];
    range.value = String(stepIndex);
    readout.textContent = `${px}px`;
    decBtn.disabled = stepIndex === 0;
    incBtn.disabled = stepIndex === FONT_SIZE_STEPS.length - 1;
    onChange(px);
  };

  decBtn.addEventListener("click", () => update(stepIndex - 1));
  incBtn.addEventListener("click", () => update(stepIndex + 1));
  range.addEventListener("input", () => update(Number(range.value)));

  update(stepIndex);
  controls.append(decBtn, range, incBtn);
  group.append(top, controls);
  return group;
}

/**
 * Opens the Settings bottom sheet containing reading prefs and account actions.
 */
export function openSettingsSheet({
  settings,
  status,
  wakeLockSupported,
  onUpdateSettings,
  onChangeFolder,
  onSetOfflineImages,
  onSignOut,
  onSetClientId,
  onToast,
  onClose,
}) {
  const { body, close } = openBottomSheet(STRINGS.settingsTitle, onClose);

  const readingSection = document.createElement("div");
  readingSection.className = "mobile-settings-group";

  readingSection.append(
    buildFontSizeControl(settings.size, (size) => onUpdateSettings({ size })),
    buildSegmentedGroup(
      STRINGS.themeLabel,
      [
        { value: "system", label: STRINGS.themeSystem },
        { value: "light", label: STRINGS.themeLight },
        { value: "dark", label: STRINGS.themeDark },
      ],
      settings.theme,
      (theme) => onUpdateSettings({ theme }),
    ),
    buildSegmentedGroup(
      STRINGS.typefaceLabel,
      [
        { value: "sans", label: STRINGS.typefaceSans },
        { value: "serif", label: STRINGS.typefaceSerif },
      ],
      settings.typeface,
      (typeface) => onUpdateSettings({ typeface }),
    ),
  );

  if (wakeLockSupported) {
    const row = document.createElement("label");
    row.className = "mobile-setting-row mobile-toggle-row";
    const text = document.createElement("span");
    text.className = "mobile-setting-label";
    text.textContent = STRINGS.keepAwakeLabel;
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "mobile-switch";
    toggle.checked = settings.keepAwake;
    toggle.addEventListener("change", () =>
      onUpdateSettings({ keepAwake: toggle.checked }),
    );
    row.append(text, toggle);
    readingSection.append(row);
  }
  body.append(readingSection);

  const accountSection = document.createElement("div");
  accountSection.className = "mobile-settings-group mobile-account-group";
  const accountTitle = document.createElement("h3");
  accountTitle.className = "mobile-settings-subtitle";
  accountTitle.textContent = STRINGS.accountSection;
  accountSection.append(accountTitle);

  if (status.user) {
    const userRow = document.createElement("div");
    userRow.className = "mobile-kv-row";
    const k = document.createElement("span");
    k.className = "mobile-kv-key";
    k.textContent = STRINGS.accountUserLabel;
    const v = document.createElement("span");
    v.className = "mobile-kv-val";
    v.textContent = status.user;
    userRow.append(k, v);
    accountSection.append(userRow);
  }

  const folderRow = document.createElement("div");
  folderRow.className = "mobile-kv-row";
  const fk = document.createElement("span");
  fk.className = "mobile-kv-key";
  fk.textContent = STRINGS.accountFolderLabel;
  const fv = document.createElement("span");
  fv.className = "mobile-kv-val";
  fv.textContent = status.folder?.name || STRINGS.accountUnknownFolder;
  folderRow.append(fk, fv);
  accountSection.append(folderRow);

  if (onSetOfflineImages) {
    const row = document.createElement("label");
    row.className = "mobile-setting-row mobile-toggle-row";
    const text = document.createElement("span");
    text.className = "mobile-setting-label";
    text.textContent = STRINGS.offlineImagesLabel;
    const hint = document.createElement("span");
    hint.className = "mobile-setting-hint";
    hint.textContent = STRINGS.offlineImagesHint;
    text.append(document.createElement("br"), hint);
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "mobile-switch";
    toggle.checked = Boolean(status.offlineImages);
    toggle.addEventListener("change", () => onSetOfflineImages(toggle.checked));
    row.append(text, toggle);
    accountSection.append(row);
  }

  const actions = document.createElement("div");
  actions.className = "mobile-account-actions";
  const changeFolderBtn = createButton(
    STRINGS.changeFolder,
    "mobile-btn-secondary",
  );
  changeFolderBtn.addEventListener("click", () => {
    close();
    onChangeFolder();
  });
  const signOutBtn = createButton(STRINGS.signOut, "mobile-btn-danger");
  signOutBtn.addEventListener("click", () => {
    close();
    onSignOut();
  });
  actions.append(changeFolderBtn, signOutBtn);
  accountSection.append(actions);

  const clientForm = document.createElement("form");
  clientForm.className = "mobile-clientid-form";
  const clientLabel = document.createElement("label");
  clientLabel.className = "mobile-setting-label";
  clientLabel.textContent = STRINGS.clientIdLabel;
  clientLabel.htmlFor = "mobile-settings-clientid";
  const clientRow = document.createElement("div");
  clientRow.className = "mobile-clientid-row";
  const clientInput = document.createElement("input");
  clientInput.id = "mobile-settings-clientid";
  clientInput.type = "text";
  clientInput.className = "mobile-input";
  clientInput.placeholder = STRINGS.clientIdPlaceholder;
  const clientBtn = document.createElement("button");
  clientBtn.type = "submit";
  clientBtn.className = "mobile-btn-secondary";
  clientBtn.textContent = STRINGS.clientIdUpdate;
  clientForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const trimmed = clientInput.value.trim();
    if (!trimmed) {
      onToast(STRINGS.clientIdRequired);
      return;
    }
    onSetClientId(trimmed);
    clientInput.value = "";
    onToast(STRINGS.clientIdSaved);
  });
  clientRow.append(clientInput, clientBtn);
  clientForm.append(clientLabel, clientRow);
  accountSection.append(clientForm);

  body.append(accountSection);
  return close;
}
