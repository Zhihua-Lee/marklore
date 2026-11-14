// What a format from the page did to a note, as rendered: the note's text,
// formulas and other pieces in order, each with the formats it shows in
// (format-check.js reads them from the page). A bold, italic or strike from
// inside other emphasis is kept only when the selected pieces gained that
// one format and nothing else changed.

// The changes, from the same text and in order, applied.
export function applyChanges(text, changes) {
  let out = "",
    at = 0;
  for (const { from, to, insert } of changes) {
    out += text.slice(at, from) + insert;
    at = to;
  }
  return out + text.slice(at);
}

// `before` and `after`: [{ key, formats: [names] }]; `selected(unit, i)`:
// the unit was selected. True when the units are the same, the selected ones
// with `format` added and the others with their formats as they were. A
// selected space may stay as it was (delimiters go around words: `**a** b`).
export function addsOnly(before, after, selected, format) {
  if (before.length !== after.length) return false;
  const names = (list) => [...new Set(list)].sort().join(" ");
  return before.every((unit, i) => {
    const other = after[i];
    if (unit.key !== other.key) return false;
    const now = names(other.formats);
    if (!selected(unit, i)) return now === names(unit.formats);
    return (
      now === names([...unit.formats, format]) ||
      (/^\s$/.test(unit.key) && now === names(unit.formats))
    );
  });
}
