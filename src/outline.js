// The outline panel (本文目录): the note's headings without its title (the
// leading level-one heading that names it, markdown.js markTitle), indented
// below the shallowest level shown; for a folder's index file, also its
// first two levels of entries, each in its place among the headings. The
// entry of the part being read is marked (scroll-spy), and an entry clicked
// stays marked until the reader scrolls by hand (near a note's end the
// heading clicked may not reach the top).

// The outline's entries: { kind: "heading" | "entry", label, from, level,
// depth (0 for the shallowest shown), index (a heading's place in
// `headings`, as its element's data-heading), line (an index entry's line) }.
// `entries`: an index file's entries ({ label, from, depth, line }, depth 0
// or 1), or null.
export function outlineItems(headings, entries = null) {
  const items = [];
  headings.forEach((heading, index) => {
    if (heading.title) return;
    items.push({
      kind: "heading",
      label: heading.label,
      id: heading.id,
      from: heading.from,
      level: heading.level,
      index,
    });
  });
  if (entries?.length) {
    for (const entry of entries)
      items.push({
        kind: "entry",
        label: entry.label,
        from: entry.from,
        depth: entry.depth,
        line: entry.line,
      });
    items.sort((a, b) => a.from - b.from);
    // An entry is a step below the heading above it; before any, below the
    // note's title (level one), as a `##` section would be.
    let base = 1;
    for (const item of items)
      if (item.kind === "heading") base = item.level;
      else item.level = base + 1 + item.depth;
  }
  const top = Math.min(...items.map((item) => item.level));
  for (const item of items) item.depth = item.level - top;
  return items;
}

// The panel in `nav`. renderLabel(label): a heading's label as HTML.
// position(): where the pane shown is read (a source offset) when that is
// not the reading view (Edit mode's editor, the source pane), else null.
// go(item, button): an entry clicked.
export function createOutline({
  nav,
  content,
  reader,
  renderLabel,
  position,
  go,
}) {
  let targets = null,
    current = null,
    pinned = null,
    frame = 0;
  const entries = () => [
    ...nav.querySelectorAll(":scope > button[data-from]:not(.outline-anchor)"),
  ];
  function build(items) {
    pinned = null;
    current = null;
    targets = null;
    nav.toggleAttribute(
      "data-nested",
      items.some((item) => item.depth > 0),
    );
    nav.replaceChildren(
      ...items.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        if (item.kind === "heading") {
          button.innerHTML = renderLabel(item.label);
          button.dataset.heading = String(item.index);
        } else {
          button.className = "outline-entry";
          button.textContent = item.label;
          button.dataset.line = String(item.line);
        }
        button.title = item.label;
        button.dataset.depth = String(item.depth);
        button.dataset.from = String(item.from);
        button.style.paddingLeft = 12 + item.depth * 12 + "px";
        button.onclick = () => {
          pin(button);
          go(item, button);
        };
        return button;
      }),
    );
    schedule();
  }
  // The same entries, at new places in the text.
  function move(items) {
    entries().forEach((button, i) => {
      if (items[i]) button.dataset.from = String(items[i].from);
    });
    targets = null;
    schedule();
  }
  function clear() {
    nav.replaceChildren();
    nav.removeAttribute("data-nested");
    targets = null;
    current = pinned = null;
  }
  // What each entry stands for on the page: its heading, or its index row.
  function resolve(buttons) {
    if (
      targets &&
      targets.length === buttons.length &&
      targets.every(
        ([button, element]) =>
          buttons.includes(button) && (!element || element.isConnected),
      )
    )
      return targets;
    targets = buttons.map((button) => [
      button,
      button.dataset.heading
        ? content.querySelector(
            `:is(h1,h2,h3,h4,h5,h6)[data-heading="${button.dataset.heading}"]`,
          )
        : content.querySelector(
            `.ix-item[data-line="${button.dataset.line}"] > .ix-row`,
          ),
    ]);
    return targets;
  }
  // Where an element is, cheaply: a part skipped off screen
  // (offscreen-blocks.js) is measured by its box, never inside it (it lies
  // wholly above or below the reading line); a hidden one (in a folded
  // section or entry) by the bottom of what shows of it.
  function topOf(element) {
    let node = element.closest(".reading-skip") || element,
      hidden = false;
    while (node && node !== content && !node.getClientRects().length) {
      node = node.parentElement;
      hidden = true;
    }
    if (!node || node === content) return Infinity;
    const box = node.getBoundingClientRect();
    return hidden ? box.bottom : box.top;
  }
  function spy() {
    frame = 0;
    const buttons = entries();
    let now = null;
    if (pinned?.isConnected) now = pinned;
    else if (buttons.length) {
      const from = position();
      if (from != null) {
        for (const button of buttons)
          if (Number(button.dataset.from) <= from) now = button;
          else break;
      } else if (reader.getClientRects().length) {
        const pairs = resolve(buttons).filter(([, element]) => element);
        const line = reader.getBoundingClientRect().top + 40;
        let low = 0,
          high = pairs.length;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (topOf(pairs[mid][1]) <= line) low = mid + 1;
          else high = mid;
        }
        now = low ? pairs[low - 1][0] : null;
      } else now = current?.isConnected ? current : null;
    }
    mark(now);
  }
  function mark(now) {
    if (now === current) return;
    current?.removeAttribute("aria-current");
    current = now;
    if (!now) return;
    now.setAttribute("aria-current", "location");
    // Kept in view in the panel (scrolling only the panel).
    const box = nav.getBoundingClientRect(),
      own = now.getBoundingClientRect();
    if (!box.height) return;
    if (own.top < box.top) nav.scrollTop -= box.top - own.top + 8;
    else if (own.bottom > box.bottom)
      nav.scrollTop += own.bottom - box.bottom + 8;
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(spy);
  }
  function pin(button) {
    pinned = button;
    mark(button);
  }
  // The reader scrolls by hand: the place read decides again.
  const release = () => {
    if (!pinned) return;
    pinned = null;
    schedule();
  };
  return { build, move, clear, schedule, release, spy };
}
