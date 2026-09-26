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
