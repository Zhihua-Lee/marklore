// The outline panel (本文目录): the note's headings without its title (the
// leading level-one heading that names it, markdown.js markTitle), indented
// below the shallowest level shown; for a folder's index file, also its
// level-one entries, each in its place among the headings. The
// entry of the part being read is marked (scroll-spy), and an entry clicked
// stays marked until the reader scrolls by hand (near a note's end the
// heading clicked may not reach the top).

// The outline's entries: { kind: "heading" | "entry", label, from, level,
// depth (0 for the shallowest shown), index (a heading's place in
// `headings`, as its element's data-heading), line (an index entry's line) }.
// `entries`: an index file's level-one entries ({ label, from, depth, line },
// depth 0), or null.
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
        key: entry.key ?? null,
        nested: Boolean(entry.nested),
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
// editor(): Edit mode's editor when it shows the note ({ root, scroller }),
// else null. position(): where the source pane is read (a source offset)
// when it is what is shown, else null. go(item, button): an entry clicked.
export function createOutline({
  nav,
  content,
  reader,
  renderLabel,
  editor = () => null,
  position = () => null,
  go,
}) {
  let targets = null,
    current = null,
    pinned = null,
    frame = 0,
    following = true,
    sawOffscreen = false,
    cameBackInView = false,
    noteScrolled = false,
    programmaticTop = null;
  const SCROLL_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
  ]);
  const entries = () => [
    ...nav.querySelectorAll(":scope > button[data-from]:not(.outline-anchor)"),
  ];
  function inView(element) {
    if (!element?.isConnected) return false;
    const box = nav.getBoundingClientRect();
    if (!box.height) return false;
    const own = element.getBoundingClientRect();
    return own.top >= box.top - 1 && own.bottom <= box.bottom + 1;
  }
  function syncManualScroll() {
    if (!current) {
      if (nav.scrollTop > 0) {
        sawOffscreen = true;
        cameBackInView = false;
      }
      return;
    }
    if (!inView(current)) {
      sawOffscreen = true;
      cameBackInView = false;
    } else if (sawOffscreen) {
      cameBackInView = true;
    }
  }
  function pauseFollowing() {
    following = false;
    syncManualScroll();
  }
  function resetFollowing() {
    following = true;
    sawOffscreen = false;
    cameBackInView = false;
    noteScrolled = false;
  }
  function rememberProgrammaticScroll() {
    const target = nav.scrollTop;
    programmaticTop = target;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (programmaticTop === target) programmaticTop = null;
      }),
    );
  }
  for (const name of ["wheel", "touchstart"])
    nav.addEventListener(
      name,
      () => {
        programmaticTop = null;
        pauseFollowing();
      },
      { passive: true },
    );
  nav.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target instanceof Element && event.target.closest("button"))
        return;
      programmaticTop = null;
      pauseFollowing();
    },
    { passive: true },
  );
  nav.addEventListener(
    "keydown",
    (event) => {
      const isSpace =
        event.key === " " &&
        !(event.target instanceof Element && event.target.closest("button"));
      if (!SCROLL_KEYS.has(event.key) && !isSpace) return;
      programmaticTop = null;
      pauseFollowing();
    },
    { passive: true },
  );
  nav.addEventListener(
    "scroll",
    () => {
      if (
        programmaticTop !== null &&
        Math.abs(nav.scrollTop - programmaticTop) <= 2
      ) {
        programmaticTop = null;
        return;
      }
      programmaticTop = null;
      if (!nav.childElementCount) return;
      if (following) pauseFollowing();
      else syncManualScroll();
    },
    { passive: true },
  );
  function build(items) {
    pinned = null;
    current = null;
    targets = null;
    resetFollowing();
    nav.toggleAttribute(
      "data-nested",
      items.some((item) => item.depth > 0),
    );
    const before = nav.scrollTop;
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
          if (item.key) button.dataset.ixKey = String(item.key);
        }
        button.title = item.label;
        button.dataset.depth = String(item.depth);
        button.dataset.from = String(item.from);
        button.style.paddingLeft = 12 + item.depth * 12 + "px";
        button.onclick = () => {
          nav.scrollTo({ top: nav.scrollTop, behavior: "instant" });
          rememberProgrammaticScroll();
          resetFollowing();
          pin(button);
          go(item, button);
        };
        return button;
      }),
    );
    nav.scrollTop = 0;
    if (nav.scrollTop !== before) rememberProgrammaticScroll();
    else programmaticTop = null;
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
    const before = nav.scrollTop;
    nav.replaceChildren();
    nav.removeAttribute("data-nested");
    targets = null;
    current = pinned = null;
    resetFollowing();
    if (before > 0 && nav.scrollTop !== before) rememberProgrammaticScroll();
    else programmaticTop = null;
  }
  // What each entry stands for on the page: its heading, or its index row.
  // Found in one pass over the page: a query per entry made folding a long
  // note (hundreds of headings) stall.
  function resolve(buttons) {
    if (targets && targets.length === buttons.length) {
      const shown = new Set(buttons);
      if (
        targets.every(
          ([button, element]) =>
            shown.has(button) && (!element || element.isConnected),
        )
      )
        return targets;
    }
    const first = (map, key, value) => {
      if (key != null && !map.has(key)) map.set(key, value);
    };
    const headings = new Map(),
      byId = new Map(),
      byLine = new Map();
    for (const h of content.querySelectorAll(
      ":is(h1,h2,h3,h4,h5,h6)[data-heading]",
    ))
      first(headings, h.dataset.heading, h);
    if (buttons.some((button) => !button.dataset.heading))
      for (const row of content.querySelectorAll(".ix-item > .ix-row")) {
        first(byId, row.parentElement.dataset.ixId, row);
        first(byLine, row.parentElement.dataset.line, row);
      }
    targets = buttons.map((button) => [
      button,
      button.dataset.heading
        ? headings.get(button.dataset.heading) || null
        : (button.dataset.ixKey && byId.get(button.dataset.ixKey)) ||
          byLine.get(button.dataset.line) ||
          null,
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
    const scrolledNote = noteScrolled;
    noteScrolled = false;
    const buttons = entries();
    let now = null;
    if (pinned?.isConnected) now = pinned;
    else if (buttons.length) {
      const pane = editor();
      const from = pane ? null : position();
      if (from != null) {
        for (const button of buttons)
          if (Number(button.dataset.from) <= from) now = button;
          else break;
      } else if (pane?.root) {
        // The editor draws the note's headings in the same order.
        const headings = pane.root.querySelectorAll("h1,h2,h3,h4,h5,h6");
        now = passed(
          buttons
            .map((button) => [button, headings[Number(button.dataset.heading)]])
            .filter(([, element]) => element),
          pane.scroller,
          (element) => element.getBoundingClientRect().top,
        );
      } else if (reader.getClientRects().length)
        now = passed(
          resolve(buttons).filter(([, element]) => element),
          reader,
          topOf,
        );
      else now = current?.isConnected ? current : null;
    }
    if (!following && scrolledNote && cameBackInView && inView(current))
      resetFollowing();
    mark(now);
    if (!following) syncManualScroll();
  }
  // The last entry whose place is above the reading line of `scroller`
  // (pairs in the order of the page).
  function passed(pairs, scroller, top) {
    const line = scroller.getBoundingClientRect().top + 40;
    let low = 0,
      high = pairs.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (top(pairs[mid][1]) <= line) low = mid + 1;
      else high = mid;
    }
    return low ? pairs[low - 1][0] : null;
  }
  function mark(now, reveal = false) {
    if (now !== current) {
      current?.removeAttribute("aria-current");
      current = now;
      if (!now) return;
      now.setAttribute("aria-current", "location");
    } else if (!now || !reveal) return;
    if (!following) return;
    // Kept in view in the panel (scrolling only the panel).
    const box = nav.getBoundingClientRect(),
      own = now.getBoundingClientRect();
    if (!box.height) return;
    const before = nav.scrollTop;
    if (own.top < box.top) nav.scrollTop -= box.top - own.top + 8;
    else if (own.bottom > box.bottom)
      nav.scrollTop += own.bottom - box.bottom + 8;
    if (nav.scrollTop !== before) rememberProgrammaticScroll();
  }
  function schedule(fromNoteScroll = false) {
    if (fromNoteScroll) noteScrolled = true;
    if (!frame) frame = requestAnimationFrame(spy);
  }
  function pin(button) {
    pinned = button;
    mark(button, true);
  }
  // The reader scrolls by hand: the place read decides again.
  const release = () => {
    if (!pinned) return;
    pinned = null;
    schedule();
  };
  return { build, move, clear, schedule, release, spy };
}
