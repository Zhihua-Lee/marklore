import { unfold } from "./positions.js";

// Find in the rendered note (Ctrl+F while reading). The editor keeps
// CodeMirror's own search panel. Matches are shown with the CSS Custom
// Highlight API, so the note's DOM (and its source mapping) is never touched.
const SKIP =
  ".katex-mathml, .code-toolbar, .table-sort, .section-summary, .fold, [aria-hidden='true']";
const BLOCK =
  "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption, summary, .math-block";
const MAX_MATCHES = 5000;

export function createFindBar({ panes, content, reader }) {
  const bar = document.createElement("div");
  bar.id = "find-bar";
  bar.setAttribute("role", "search");
  bar.hidden = true;
  bar.innerHTML =
    // type="text": a search input's built-in clear button sat beside our close "×".
    '<input type="text" placeholder="在笔记中查找" aria-label="在笔记中查找" spellcheck="false">' +
    '<span class="find-count" aria-live="polite"></span>' +
    '<button type="button" data-find="prev" aria-label="上一个" title="上一个（Shift+Enter）">↑</button>' +
    '<button type="button" data-find="next" aria-label="下一个" title="下一个（Enter）">↓</button>' +
    '<button type="button" data-find="close" aria-label="关闭查找" title="关闭（Esc）">×</button>';
  panes.append(bar);
  const input = bar.querySelector("input"),
    count = bar.querySelector(".find-count");
  let matches = [],
    current = -1,
    refreshTimer = null;

  // One searchable string per note: text nodes joined, with a line break
  // between blocks so a match never spans two paragraphs or cells.
  function index() {
    const segments = [];
    let text = "",
      lastBlock = null;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeValue && !node.parentElement?.closest(SKIP)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    for (let node; (node = walker.nextNode());) {
      const block = node.parentElement.closest(BLOCK);
      if (block !== lastBlock && text) text += "\n";
      lastBlock = block;
      segments.push({ node, start: text.length });
      text += node.nodeValue;
    }
    return { text, segments };
  }
  function locate(segments, offset, end) {
    // Last segment starting at or before offset (an end offset may sit at a boundary).
    let low = 0,
      high = segments.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (
        segments[mid].start < offset ||
        (!end && segments[mid].start === offset)
      )
        low = mid;
      else high = mid - 1;
    }
    const { node, start } = segments[low];
    return [node, Math.min(node.nodeValue.length, offset - start)];
  }
  function search({ keep = false } = {}) {
    const query = input.value;
    const previous = keep ? matches[current] : null;
    matches = [];
    current = -1;
    if (query) {
      const { text, segments } = index();
      const folded = text.toLowerCase(),
        needle = query.toLowerCase();
      // Case folding must not shift offsets; otherwise match case exactly.
      const [haystack, target] =
        folded.length === text.length ? [folded, needle] : [text, query];
      for (
        let at = haystack.indexOf(target);
        at !== -1 && matches.length < MAX_MATCHES;
        at = haystack.indexOf(target, at + target.length)
      ) {
        const range = document.createRange();
        range.setStart(...locate(segments, at, false));
        range.setEnd(...locate(segments, at + target.length, true));
        matches.push(range);
      }
    }
    if (previous && matches.length) {
      // After a re-render, stay on the match nearest the one that was current.
      const top = previous.getBoundingClientRect().top;
      let best = 0;
      matches.forEach((range, i) => {
        if (
          Math.abs(range.getBoundingClientRect().top - top) <
          Math.abs(matches[best].getBoundingClientRect().top - top)
        )
          best = i;
      });
      current = best;
    }
    paint();
  }
  function paint() {
    if (!CSS.highlights) return;
    CSS.highlights.set("folio-find", new Highlight(...matches));
    if (matches[current])
      CSS.highlights.set("folio-find-current", new Highlight(matches[current]));
    else CSS.highlights.delete("folio-find-current");
    count.textContent = !input.value
      ? ""
      : matches.length
        ? `${current + 1 || "–"}/${matches.length}${matches.length >= MAX_MATCHES ? "+" : ""}`
        : "无结果";
  }
  function go(step) {
    if (!matches.length) return;
    current = (current + step + matches.length) % matches.length;
    const range = matches[current];
    // Folded sections, <details> and collapsed code open to reveal the match.
    unfold(range.startContainer.parentElement);
    const box = range.getBoundingClientRect(),
      view = reader.getBoundingClientRect();
    if (box.top < view.top + 40 || box.bottom > view.bottom - 40)
      reader.scrollTo({
        behavior: "instant",
        top: reader.scrollTop + box.top - view.top - reader.clientHeight / 3,
      });
    paint();
  }
  function clear() {
    matches = [];
    current = -1;
    CSS.highlights?.delete("folio-find");
    CSS.highlights?.delete("folio-find-current");
    count.textContent = "";
  }

  input.addEventListener("input", () => {
    search();
    go(1);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "F3") {
      event.preventDefault();
      go(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  bar.addEventListener("click", (event) => {
    const action = event.target.closest("[data-find]")?.dataset.find;
    if (action === "close") close();
    else if (action) go(action === "prev" ? -1 : 1);
  });
  // Edits, tab switches and lazy formulas change the note; keep results current.
  new MutationObserver(() => {
    if (bar.hidden || !input.value) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => search({ keep: true }), 150);
  }).observe(content, { childList: true, subtree: true, characterData: true });

  function open() {
    const selected = window.getSelection()?.toString().trim();
    if (selected && !selected.includes("\n") && selected.length <= 200)
      input.value = selected;
    bar.hidden = false;
    input.focus();
    input.select();
    if (input.value) {
      search();
      go(1);
    }
  }
  function close() {
    bar.hidden = true;
    clearTimeout(refreshTimer);
    clear();
    reader.focus({ preventScroll: true });
  }
  return {
    open,
    close,
    next: () => (bar.hidden ? open() : go(1)),
    previous: () => (bar.hidden ? open() : go(-1)),
    get isOpen() {
      return !bar.hidden;
    },
  };
}
