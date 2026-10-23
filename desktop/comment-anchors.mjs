// Where a comment sits in a note: the text it is about (quote) with a little
// of what comes before and after it, so it can be found again after the note
// changes elsewhere, and told apart when the same words occur twice. Pure
// JavaScript, shared by the MCP server, the main process and the page.

const CONTEXT = 32;

export function anchorOf(text, from, to) {
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
  };
}

// How many characters two strings share at their end (a) / start (b).
function sharedEnd(a, b) {
  let n = 0;
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  )
    n++;
  return n;
}
function sharedStart(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// The quote's place in the text now ({ from, to }), the occurrence whose
// surroundings match best; null when the quote is gone.
export function locateAnchor(text, anchor) {
  const quote = anchor?.quote;
  if (!quote) return null;
  let best = null,
    score = -1;
  for (
    let at = text.indexOf(quote);
    at >= 0;
    at = text.indexOf(quote, at + 1)
  ) {
    const s =
      sharedEnd(
        text.slice(Math.max(0, at - CONTEXT), at),
        anchor.prefix || "",
      ) +
      sharedStart(
        text.slice(at + quote.length, at + quote.length + CONTEXT),
        anchor.suffix || "",
      );
    if (s > score) {
      score = s;
      best = { from: at, to: at + quote.length };
    }
  }
  return best;
}

// The 1-based line a position is on.
export const lineAt = (text, at) => text.slice(0, at).split("\n").length;
