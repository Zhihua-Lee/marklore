// Marks the section under the pointer (the innermost one) and the one whose
// fold control has the keyboard focus, for the styles of its marker and rail.
// An index file's entries with pages under them fold the same way
// (folder-index-view.js) and are marked alike.
const FOLDING = ".note-section, .ix-item[aria-expanded]";
export function watchSections(host) {
  let over = null,
    focused = null;
  const mark = (now, next, name) => {
    if (next !== now) {
      now?.classList.remove(name);
      next?.classList.add(name);
    }
    return next;
  };
  host.addEventListener("pointerover", (event) => {
    const section = event.target.closest?.(FOLDING);
    over = mark(
      over,
      section && host.contains(section) ? section : null,
      "section-hover",
    );
  });
  host.addEventListener(
    "pointerleave",
    () => (over = mark(over, null, "section-hover")),
  );
  host.addEventListener("focusin", (event) => {
    const control = event.target.closest?.(
      ".fold, .section-rail, .ix-twisty, .ix-rail",
    );
    focused = mark(
      focused,
      control?.matches(":focus-visible") ? control.closest(FOLDING) : null,
      "section-focus",
    );
  });
  host.addEventListener(
    "focusout",
    () => (focused = mark(focused, null, "section-focus")),
  );
}
export function setSectionCollapsed(section, collapsed) {
  section.classList.toggle("collapsed", collapsed);
  const fold = section.firstElementChild?.querySelector(".fold");
  if (fold) {
    fold.textContent = collapsed ? "▸" : "▾";
    fold.setAttribute("aria-expanded", String(!collapsed));
  }
  const rail = section.querySelector(":scope > .section-rail");
  if (rail) rail.setAttribute("aria-expanded", String(!collapsed));
}
