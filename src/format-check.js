import { renderMarkdown } from "./markdown.js";
import { textOffset } from "./positions.js";
import { addsOnly, applyChanges } from "./format-units.js";

// Whether a bold, italic or strike from the page renders as meant: the note
// around the change is rendered before and after it, as the page renders it
// (the CJK emphasis setting included), and only the selected text may have
// gained the format. Emphasis delimiters next to other emphasis, punctuation
// or CJK text do not always open or close where they were put.

// The format each action adds, by the names below.
export const ADDED = { bold: "strong", italic: "em", strike: "s" };
const SAME = { b: "strong", i: "em", del: "s", strike: "s" };
const FORMATS =
  "strong,b,em,i,s,del,strike,mark,u,ins,sub,sup,small,kbd,a,span[style]";
// Taken whole: compared by their text, selected when inside a piece.
const ATOMS = ".formula,code,img,input,br,sup.footnote-ref";
const SKIPPED = "button,.section-summary,.backlink-badge";
const BLOCKS =
  "p,h1,h2,h3,h4,h5,h6,li,td,th,dt,dd,blockquote,pre,ul,ol,dl,table,tr,hr,details,summary";

function formatName(el) {
  const tag = el.tagName.toLowerCase();
  const name = SAME[tag] || tag;
  return tag === "span" || tag === "mark"
    ? name + "|" + (el.getAttribute("style") || "")
    : name;
}
function formatsOf(node) {
  const names = [];
  for (let el = node.parentElement; el; el = el.parentElement)
    if (el.matches(FORMATS)) names.push(formatName(el));
  return names;
}
const number = (value) => (value == null ? null : Number(value));
// The rendered units in order: characters (with their source position when
// known), whole pieces (formulas, code), and block edges.
function units(root) {
  const list = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const leaf = child.parentElement?.closest(
          "[data-text-from],.md-escape",
        );
        const start = !leaf
          ? null
          : leaf.matches(".md-escape")
            ? number(leaf.dataset.srcFrom)
            : number(leaf.dataset.textFrom) + textOffset(leaf, child, 0);
        const formats = formatsOf(child);
        [...child.data].forEach((ch, i) =>
          list.push({
            key: ch,
            formats,
            from:
              start == null
                ? null
                : leaf.matches(".md-escape")
                  ? start
                  : start + i,
            to: null,
          }),
        );
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.matches(SKIPPED)) continue;
        if (child.matches(ATOMS)) {
          const data = child.dataset;
          list.push({
            key: child.tagName + ":" + child.textContent,
            formats: formatsOf(child),
            from: number(data.from ?? data.textFrom ?? data.srcFrom),
            to: number(data.to ?? data.textTo ?? data.srcTo),
          });
          continue;
        }
        const block = child.matches(BLOCKS);
        if (block) list.push({ key: "<" + child.tagName, formats: [] });
        walk(child);
        if (block) list.push({ key: ">", formats: [] });
      }
    }
  };
  walk(root);
  return list;
}

// `changes`: the edit, from `text`; `pieces`: [{ from, to }] of `text`, the
// selected text to carry the format of `action`.
export function rendersAsMeant(text, changes, pieces, action) {
  const format = ADDED[action];
  if (!format || !pieces.length) return false;
  const first = pieces[0].from,
    last = pieces.at(-1).to;
  const blank = text.lastIndexOf("\n\n", first),
    start = blank < 0 ? 0 : blank + 2,
    gap = text.indexOf("\n\n", last),
    end = gap < 0 ? text.length : gap;
  if (changes.some((change) => change.from < start || change.to > end))
    return false;
  const next = applyChanges(text, changes),
    nextEnd = end + next.length - text.length;
  const render = (source) =>
    units(
      renderMarkdown(source, null, { deferMath: true, base: start }).fragment,
    );
  const inside = (unit) =>
    unit.from != null &&
    pieces.some(({ from, to }) =>
      unit.to == null
        ? unit.from >= from && unit.from < to
        : unit.from >= from && unit.to <= to,
    );
  try {
    return addsOnly(
      render(text.slice(start, end)),
      render(next.slice(start, nextEnd)),
      inside,
      format,
    );
  } catch {
    return false;
  }
}
