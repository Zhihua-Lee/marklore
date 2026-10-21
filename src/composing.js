// Whether an input method is composing anywhere in the page. While it is,
// background work (lazy formulas, diagrams, table widths, link marks, hover
// marks, memory release) leaves the page alone: on Windows the input method is
// told when the text around its composition changes, and some (Sogou Pinyin)
// then end the composition halfway through the pinyin.
let active = false;
const waiting = [];
const end = () => {
  active = false;
  for (const resolve of waiting.splice(0)) resolve();
};
// (No page when a test imports a module that uses this.)
if (typeof document !== "undefined") {
  document.addEventListener("compositionstart", () => (active = true), true);
  document.addEventListener("compositionend", end, true);
  // A composition cut short by the window losing focus never reports its end.
  window.addEventListener("blur", end);
}

export const composing = () => active;
// Resolves now, or once the composition ends.
export const settled = () =>
  active ? new Promise((resolve) => waiting.push(resolve)) : Promise.resolve();
