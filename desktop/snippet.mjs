// Cutting Markdown for snippets (backlink cards, search results, anchor
// labels) without breaking what the renderer must see whole: a formula cut
// in half, an unclosed code span or a dangling "**" renders as noise.
// A window is widened to take such a span whole, or narrowed to leave it out
// when it is long and holds no hit.

// Inline formula: "$" next to its content on both sides and not followed by a
// digit, so "$5 and $10" is not math (as in the renderer's own rule).
export const INLINE_MATH =
  /(?<![\\$])\$(?=[^\s$])(?:[^$\\\n]|\\.)+?(?<=[^\s\\])\$(?!\d)/g;
// Inline or display formulas.
export const MATH = new RegExp(
  `\\$\\$[\\s\\S]+?\\$\\$|${INLINE_MATH.source}`,
  "g",
);

const SPANS = [
  /\$\$[\s\S]+?\$\$/g,
  /\\\[[\s\S]+?\\\]/g,
  /\\\([\s\S]+?\\\)/g,
  /\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}/g,
  INLINE_MATH,
  /(`+)[\s\S]+?\1/g,
  /!?\[(?:[^[\]\n]|\[[^\]\n]*\])*\]\([^)\n]*\)/g,
  /<(span|mark|sub|sup|u|kbd|a|font|small|big|b|i|s|del|ins|em|strong|code|q|abbr)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
  /<\/?[a-z][^>\n]*>/gi,
  /(\*\*|__|~~|==)(?=\S)[\s\S]+?(?<=\S)\1/g,
];

// Every span to keep whole, as [start, end).
export function protectedSpans(text) {
  const spans = [];
  for (const pattern of SPANS)
    for (const m of text.matchAll(pattern))
      if (m[0].length) spans.push([m.index, m.index + m[0].length]);
  return spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
}

// [start, end) adjusted so that no protected span is cut. keep: the range
// that must stay (the hit); a span holding it is always kept whole. Other
// spans crossing an edge are taken whole up to maxSpan characters, longer
// ones are left out.
export function safeWindow(
  text,
  start,
  end,
  { keep = [start, start], maxSpan = 240, spans = protectedSpans(text) } = {},
) {
  for (let round = 0, changed = true; changed && round < 12; round++) {
    changed = false;
    for (const [a, b] of spans) {
      const atStart = a < start && start < b,
        atEnd = a < end && end < b;
      if (!atStart && !atEnd) continue;
      const holdsHit = a < Math.max(keep[1], keep[0] + 1) && b > keep[0];
      if (holdsHit || b - a <= maxSpan) {
        start = Math.min(start, a);
        end = Math.max(end, b);
      } else {
        if (atStart) start = b;
        if (atEnd) end = a;
      }
      changed = true;
    }
  }
  return [Math.max(0, start), Math.min(text.length, Math.max(start, end))];
}

// At most about max characters from the start, never inside a span; "…"
// when anything was left out.
export function safeTruncate(text, max) {
  if (text.length <= max) return text;
  const spans = protectedSpans(text);
  let [, end] = safeWindow(text, 0, max - 1, { keep: [0, 0], spans });
  // A long span at the edge (not at the very start): cut before it instead.
  if (end > max * 2) {
    const crossing = spans.find(([a, b]) => a > 0 && a < max && b > max);
    if (crossing) end = crossing[0];
  }
  const cut = text.slice(0, end).trimEnd();
  return end < text.length ? cut + "…" : cut;
}
