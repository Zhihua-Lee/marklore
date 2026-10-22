// Whether an input method is composing anywhere in the page. While it is,
// background work (lazy formulas, diagrams, table widths, link marks, hover
// marks, memory release) leaves the page alone: on Windows the input method is
// told when the text around its composition changes, and some (Sogou Pinyin)
// then end the composition halfway through the pinyin.
//
// It counts from the key that starts a composition: the input method takes
// the key (keyCode 229) before the page hears of the composition, and a
// render in between ends it before it began.
let composition = false,
  starting = 0;
const waiting = [];
const end = () => {
  if (composition || starting) return;
  for (const resolve of waiting.splice(0)) resolve();
};
// (No page when a test imports a module that uses this.)
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (event) => {
      if (composition || event.keyCode !== 229) return;
      clearTimeout(starting);
      // A key the input method types at once (punctuation) starts none.
      starting = setTimeout(() => {
        starting = 0;
        end();
      }, 500);
    },
    true,
  );
  document.addEventListener(
    "compositionstart",
    () => {
      composition = true;
      clearTimeout(starting);
      starting = 0;
    },
    true,
  );
  document.addEventListener(
    "compositionend",
    () => {
      composition = false;
      end();
    },
    true,
  );
  // A composition cut short by the window losing focus never reports its end.
  window.addEventListener("blur", () => {
    composition = false;
    clearTimeout(starting);
    starting = 0;
    end();
  });
}

export const composing = () => composition || Boolean(starting);
// Resolves now, or once the composition ends.
export const settled = () =>
  composing()
    ? new Promise((resolve) => waiting.push(resolve))
    : Promise.resolve();
