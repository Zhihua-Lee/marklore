import { caretAt } from "./positions.js";

// Direct editing makes each top-level block of the note its own editing host
// instead of the whole note: the browser's work for a keystroke grows with the
// host it types into (on an 1,800-line note, about 40 ms a key for the note
// against 20 for a block). Making the note editable again for a moment is no
// way around it: it restyles the whole note (~0.3 s there).
//
// The browser keeps the caret and the selection inside one host, so what
// crosses blocks is done here: the arrow keys at a block's edge (with Shift,
// selecting), Ctrl+A, Ctrl+Home/End, Page Up/Down, a drag or a Shift+click
// into another block, and a click between blocks. A selection over several
// blocks is kept by the page as set (typing over it goes through the source,
// direct-editing.js) and extended here.

export const HOST = "data-direct-host";

// `keys` sees a key first and returns whether it took it (direct-editing.js:
// arrow keys into formulas and out of emphasis at a block's edge).
export function createHosts({
  content,
  scroller,
  islands,
  active,
  keys,
  appendBlock,
}) {
  const hostOf = (node) => {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    const host = el?.closest(`[${HOST}]`);
    return host && content.contains(host) ? host : null;
  };
  const shown = (el) => el.getClientRects().length > 0;
  const all = () => [...content.querySelectorAll(`[${HOST}]`)].filter(shown);

  // The hosts among these top-level nodes: a section holds its heading and,
  // in its body, its blocks; a code block taking typing, its code (not its
  // toolbar).
  const heading = (el) => /^H[1-6]$/.test(el.tagName);
  function candidates(node, out = []) {
    if (node.nodeType !== 1) return out;
    if (node.classList.contains("note-section")) {
      for (const child of node.children)
        if (heading(child)) out.push(child);
        else if (child.classList.contains("section-body"))
          for (const block of child.children) candidates(block, out);
    } else if (node.classList.contains("code-direct")) {
      const pre = node.querySelector(":scope > pre");
      if (pre) out.push(pre);
    } else if (!node.matches(islands)) out.push(node);
    return out;
  }
  function mark(nodes = [...content.children]) {
    for (const node of nodes)
      for (const el of candidates(node))
        if (!el.hasAttribute(HOST)) {
          el.setAttribute(HOST, "");
          el.contentEditable = "true";
          el.spellcheck = false;
        }
  }
  function unmark() {
    for (const el of content.querySelectorAll(`[${HOST}]`)) {
      el.removeAttribute(HOST);
      el.removeAttribute("contenteditable");
      el.removeAttribute("spellcheck");
    }
  }
  // A block that came into the note outside a render (a new empty paragraph).
  function adopt(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    for (let top = el; top && top !== content; top = top.parentElement) {
      const parent = top.parentElement;
      if (
        parent === content ||
        parent?.classList.contains("section-body") ||
        (parent?.classList.contains("note-section") && heading(top))
      ) {
        mark([top]);
        return hostOf(node);
      }
    }
    return null;
  }

  // Text positions, outside islands (a formula's own text is not a caret place).
  function textNodes(host) {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement.closest(islands) &&
        host.contains(node.parentElement.closest(islands))
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }
  const nodeEnd = (host, node) =>
    host?.tagName === "PRE" &&
    node === textNodes(host).at(-1) &&
    node.data.endsWith("\n")
      ? node.length - 1
      : node.length;
  // A host's first (last) caret place: its text's edge, or beside a formula
  // or image that comes before (after) the text; in a block of only such
  // things, beside them.
  function edge(host, end) {
    const nodes = textNodes(host).filter((node) => node.data.trim());
    const node = end ? nodes.at(-1) : nodes[0];
    const things = [...host.querySelectorAll(".formula,img")].filter(
      (el) =>
        !el.parentElement.closest(".formula") &&
        (!node ||
          (end
            ? node.compareDocumentPosition(el) &
              Node.DOCUMENT_POSITION_FOLLOWING
            : node.compareDocumentPosition(el) &
              Node.DOCUMENT_POSITION_PRECEDING)),
    );
    const thing = end ? things.at(-1) : things[0];
    if (thing) {
      const at = [...thing.parentNode.childNodes].indexOf(thing);
      return { node: thing.parentNode, offset: end ? at + 1 : at };
    }
    return node
      ? { node, offset: node.data === "​" || !end ? 0 : nodeEnd(host, node) }
      : null;
  }
  // The caret's box; a collapsed range has none at some places.
  function caretRect(node, offset) {
    const range = document.createRange();
    range.setStart(node, offset);
    let rect = range.getClientRects()[0];
    if (!rect && node.nodeType === 3) {
      if (offset > 0) {
        range.setStart(node, offset - 1);
        range.setEnd(node, offset);
        const r = range.getClientRects();
        rect = r[r.length - 1];
        if (rect)
          return { left: rect.right, top: rect.top, bottom: rect.bottom };
      } else if (node.length) {
        range.setEnd(node, 1);
        rect = range.getClientRects()[0];
      }
    }
    rect ??= (
      node.nodeType === 1 ? node : node.parentElement
    ).getBoundingClientRect();
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  }
  function lineBoxes(host) {
    const range = document.createRange();
    range.selectNodeContents(host);
    return [...range.getClientRects()].filter(
      (r) => r.height > 0 && r.width > 0,
    );
  }
  const middle = (r) => (r.top + r.bottom) / 2;
  const sameLine = (a, b) => middle(a) > b.top && middle(a) < b.bottom;

  // The caret position in a host on the line nearest y, near x.
  function onLine(host, line, x) {
    reveal(line);
    const boxes = lineBoxes(host);
    if (!boxes.length) return edge(host, false);
    const box =
      boxes.find((b) => sameLine(line, b)) ||
      boxes.reduce((best, b) =>
        Math.abs(middle(b) - middle(line)) <
        Math.abs(middle(best) - middle(line))
          ? b
          : best,
      );
    const point = caretAt(
      Math.max(box.left + 1, Math.min(box.right - 1, x)),
      middle(box),
    );
    return point && hostOf(point.node) === host && usableNode(point.node)
      ? point
      : null;
  }
  const usableNode = (node) =>
    !(node.nodeType === 1 ? node : node.parentElement).closest(islands) ||
    !hostOf(node)?.contains(
      (node.nodeType === 1 ? node : node.parentElement).closest(islands),
    );
  // Scroll the note so a box is on screen.
  function reveal(box, margin = 24) {
    const view = scroller.getBoundingClientRect();
    if (box.top < view.top + margin)
      scroller.scrollTop -= view.top + margin - box.top;
    else if (box.bottom > view.bottom - margin)
      scroller.scrollTop += box.bottom - (view.bottom - margin);
  }

  function place(point, extend) {
    const selection = window.getSelection();
    const host = hostOf(point.node);
    if (extend && selection.anchorNode) {
      selection.setBaseAndExtent(
        selection.anchorNode,
        selection.anchorOffset,
        point.node,
        point.offset,
      );
    } else {
      if (host && document.activeElement !== host)
        host.focus({ preventScroll: true });
      selection.collapse(point.node, point.offset);
    }
    reveal(caretRect(point.node, point.offset));
  }

  // Kept over a run of Up/Down presses, like the browser's own.
  let goalX = null;
  // Where the caret goes from (node, offset) a line up or down: on the same
  // block's next line, else on the next block's first line (skipping what
  // cannot be typed into).
  function vertical(node, offset, down) {
    const host = hostOf(node);
    const rect = caretRect(node, offset);
    goalX ??= rect.left;
    const lines = lineBoxes(host).filter((b) =>
      down
        ? b.top >= rect.bottom - 2 && !sameLine(rect, b)
        : b.bottom <= rect.top + 2 && !sameLine(rect, b),
    );
    if (lines.length) {
      const line = down
        ? lines.reduce((a, b) => (b.top < a.top ? b : a))
        : lines.reduce((a, b) => (b.bottom > a.bottom ? b : a));
      return onLine(host, line, goalX);
    }
    const hosts = all(),
      at = hosts.indexOf(host);
    for (
      let i = at + (down ? 1 : -1);
      i >= 0 && i < hosts.length;
      i += down ? 1 : -1
    ) {
      const boxes = lineBoxes(hosts[i]);
      if (!boxes.length) {
        const point = edge(hosts[i], !down);
        if (point) return point;
        continue;
      }
      const line = down
        ? boxes.reduce((a, b) => (b.top < a.top ? b : a))
        : boxes.reduce((a, b) => (b.bottom > a.bottom ? b : a));
      const point = onLine(hosts[i], line, goalX) || edge(hosts[i], !down);
      if (point) return point;
    }
    return null;
  }
  // Whether (node, offset) is on its host's first (up) or last line.
  function atLineEdge(node, offset, down) {
    const rect = caretRect(node, offset);
    const boxes = lineBoxes(hostOf(node));
    if (!boxes.length) return true;
    return down
      ? !boxes.some((b) => b.top >= rect.bottom - 2 && !sameLine(rect, b))
      : !boxes.some((b) => b.bottom <= rect.top + 2 && !sameLine(rect, b));
  }
  // Whether nothing can be typed over between (node, offset) and the host's
  // start (back) or end.
  // Text only, not a heading's fold button or block count. A formula or
  // image on the way counts as something to move over.
  function atTextEdge(node, offset, forward) {
    const host = hostOf(node);
    const point = document.createRange();
    try {
      point.setStart(node, offset);
    } catch {
      return false;
    }
    const side = (target) => {
      const at = point.comparePoint(target, 0);
      return forward ? at > 0 : at < 0;
    };
    const text = textNodes(host)
      .map((text) =>
        text === node
          ? forward
            ? text.data.slice(offset)
            : text.data.slice(0, offset)
          : side(text)
            ? text.data
            : "",
      )
      .join("");
    if (text.replace(/[\s​]/g, "")) return false;
    return ![...host.querySelectorAll(".formula,img")].some(
      (el) => !el.parentElement.closest(".formula") && side(el),
    );
  }
  // The next caret position from (node, offset), one character or word on.
  function horizontal(node, offset, forward, word) {
    const host = hostOf(node);
    if (atTextEdge(node, offset, forward)) {
      const hosts = all(),
        at = hosts.indexOf(host);
      for (
        let i = at + (forward ? 1 : -1);
        i >= 0 && i < hosts.length;
        i += forward ? 1 : -1
      ) {
        const point = edge(hosts[i], !forward);
        if (point) return point;
      }
      return null;
    }
    const nodes = textNodes(host);
    let i = nodes.indexOf(node);
    if (i < 0) {
      // Between elements: the first text after (or the last before) the point.
      const point = document.createRange();
      point.setStart(node, offset);
      i = nodes.findIndex((n) => point.comparePoint(n, 0) >= 0);
      if (i < 0) i = nodes.length;
      if (!forward) i--;
      node = nodes[i];
      if (!node) return null;
      offset = forward ? 0 : nodeEnd(host, node);
    }
    const len = (n) => nodeEnd(host, n);
    const step = (n, at) => {
      const text = n.data.slice(0, len(n));
      if (!word) return forward ? at + 1 : at - 1;
      const pattern = forward ? /^\s*[^\s]+/ : /[^\s]+\s*$/;
      const match = forward
        ? text.slice(at).match(pattern)
        : text.slice(0, at).match(pattern);
      return match
        ? forward
          ? at + match[0].length
          : at - match[0].length
        : forward
          ? text.length
          : 0;
    };
    let next = step(node, Math.min(offset, len(node)));
    while (next < 0 || next > len(node)) {
      i += forward ? 1 : -1;
      const other = nodes[i];
      if (!other) return { node, offset: forward ? len(node) : 0 };
      node = other;
      next = forward
        ? Math.min(len(node), word ? step(node, 0) : 1)
        : word
          ? step(node, len(node))
          : len(node) - 1;
      if (next < 0) next = 0;
    }
    return { node, offset: next };
  }

  function onKeyDown(event) {
    if (
      !active() ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      keys?.(event)
    )
      return;
    const key = event.key,
      mod = event.ctrlKey || event.metaKey,
      shift = event.shiftKey;
    const vertical_ = key === "ArrowUp" || key === "ArrowDown";
    if (!vertical_ && !key.startsWith("Page")) goalX = null;
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const anchorHost = hostOf(selection.anchorNode),
      focusHost = hostOf(selection.focusNode);
    if (!focusHost) return;
    const spanning = anchorHost !== focusHost;
    const range = selection.getRangeAt(0);
    const take = () => event.preventDefault();

    if (mod && !shift && key.toLowerCase() === "a") {
      const hosts = all(),
        start = hosts.map((h) => edge(h, false)).find(Boolean),
        end = hosts
          .map((h) => edge(h, true))
          .filter(Boolean)
          .at(-1);
      if (!start || !end) return;
      take();
      hostOf(start.node).focus({ preventScroll: true });
      selection.setBaseAndExtent(
        start.node,
        start.offset,
        end.node,
        end.offset,
      );
      return;
    }
    if (mod && (key === "Home" || key === "End")) {
      const hosts = all(),
        list = key === "Home" ? hosts : [...hosts].reverse();
      const point = list.map((h) => edge(h, key === "End")).find(Boolean);
      if (!point) return;
      take();
      place(point, shift);
      return;
    }
    if (key === "PageDown" || key === "PageUp") {
      const down = key === "PageDown";
      const rect = caretRect(selection.focusNode, selection.focusOffset);
      take();
      goalX ??= rect.left;
      const before = scroller.scrollTop;
      scroller.scrollTop +=
        (down ? 1 : -1) * Math.max(40, scroller.clientHeight - 40);
      const moved = scroller.scrollTop - before;
      const y =
        rect.top +
        (moved ? 0 : down ? scroller.clientHeight : -scroller.clientHeight);
      const view = scroller.getBoundingClientRect();
      const target = caretAt(
        goalX,
        Math.max(view.top + 4, Math.min(view.bottom - 4, y)),
      );
      const point =
        target && hostOf(target.node) && usableNode(target.node)
          ? target
          : nearest(
              goalX,
              Math.max(view.top + 4, Math.min(view.bottom - 4, y)),
            );
      if (point) place(point, shift);
      return;
    }
    if (spanning && (key === "Home" || key === "End")) {
      // Home/End from a selection over blocks: from its focus, as usual;
      // with Shift, its focus goes to the start or end of that line.
      if (!shift) {
        selection.collapse(selection.focusNode, selection.focusOffset);
        return;
      }
      const rect = caretRect(selection.focusNode, selection.focusOffset);
      const line = lineBoxes(focusHost).filter((b) => sameLine(rect, b));
      if (!line.length) return;
      const x =
        key === "Home"
          ? Math.min(...line.map((b) => b.left)) + 1
          : Math.max(...line.map((b) => b.right)) - 1;
      const point = caretAt(x, middle(rect));
      if (!point || hostOf(point.node) !== focusHost) return;
      take();
      place(point, true);
      return;
    }
    const horizontal_ = key === "ArrowLeft" || key === "ArrowRight";
    if (!vertical_ && !horizontal_) return;
    const forward = key === "ArrowRight" || key === "ArrowDown";
    // A selection over blocks, without Shift: collapse to its start or end.
    if (spanning && !shift) {
      take();
      const point = forward
        ? { node: range.endContainer, offset: range.endOffset }
        : { node: range.startContainer, offset: range.startOffset };
      place(point, false);
      return;
    }
    const node = selection.focusNode,
      offset = selection.focusOffset;
    if (!spanning) {
      // Inside the block, the browser moves as usual.
      const leaving = vertical_
        ? atLineEdge(node, offset, forward)
        : atTextEdge(node, offset, forward);
      if (!leaving) return;
    }
    const point = vertical_
      ? vertical(node, offset, forward)
      : horizontal(node, offset, forward, mod);
    if (!point) return;
    take();
    place(point, shift);
  }

  // The caret position nearest a point of the page, in a host.
  function nearest(x, y) {
    const direct = caretAt(x, y);
    if (direct && hostOf(direct.node) && usableNode(direct.node)) return direct;
    let best = null,
      distance = Infinity;
    for (const host of all()) {
      const r = host.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < distance) {
        distance = d;
        best = host;
      }
      if (r.top > y && best) break;
    }
    if (!best) return null;
    const r = best.getBoundingClientRect();
    const line = { top: Math.max(r.top, Math.min(r.bottom - 1, y)) };
    line.bottom = line.top + 1;
    return onLine(best, line, x) || edge(best, y > r.bottom);
  }

  // A drag that leaves its block, and a Shift+click in another block, select
  // through the source's order here; a click between blocks puts the caret in
  // the nearest one.
  let drag = null;
  function onMouseDown(event) {
    if (!active() || event.button !== 0) return;
    goalX = null;
    const target = event.target;
    // Formulas, code, buttons and section headings keep their own clicks.
    if (
      target.nodeType !== 1 ||
      (target !== scroller && !content.contains(target)) ||
      target.closest(islands)
    )
      return;
    if (target === scroller) {
      const box = scroller.getBoundingClientRect();
      if (
        event.clientX >= box.left + scroller.clientWidth ||
        event.clientY >= box.top + scroller.clientHeight
      )
        return;
    }
    const host = hostOf(target);
    const selection = window.getSelection();
    if (
      event.shiftKey &&
      selection.anchorNode &&
      hostOf(selection.anchorNode)
    ) {
      if (host && host === hostOf(selection.anchorNode)) return;
      const point = nearest(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      selection.setBaseAndExtent(
        selection.anchorNode,
        selection.anchorOffset,
        point.node,
        point.offset,
      );
      drag = {
        host: hostOf(point.node),
        taken: true,
        anchor: { node: selection.anchorNode, offset: selection.anchorOffset },
      };
      return;
    }
    if (!host) {
      // A click below the note's last block: when that is not a paragraph or
      // a heading (a table, code, a list), a new paragraph after it. Sections
      // nest; a folded one ends with its heading.
      let bottom = [...content.children].findLast(shown);
      while (bottom?.classList.contains("note-section"))
        bottom =
          (!bottom.classList.contains("collapsed") &&
            [
              ...(bottom.querySelector(":scope > .section-body")?.children ||
                []),
            ].findLast(shown)) ||
          bottom.firstElementChild;
      if (
        bottom &&
        !bottom.matches("p,h1,h2,h3,h4,h5,h6") &&
        event.clientY > bottom.getBoundingClientRect().bottom + 12 &&
        appendBlock?.()
      ) {
        event.preventDefault();
        return;
      }
      const point = nearest(event.clientX, event.clientY);
      if (!point) return;
      event.preventDefault();
      place(point, false);
      drag = { host: hostOf(point.node), taken: true, anchor: point };
      return;
    }
    drag = { host, taken: false };
  }
  function onMouseMove(event) {
    if (!drag || !(event.buttons & 1)) return (drag = null);
    if (!drag.taken) {
      const over = hostOf(
        document.elementFromPoint(event.clientX, event.clientY),
      );
      if (over === drag.host) return;
      const selection = window.getSelection();
      if (!selection.anchorNode) return;
      drag.taken = true;
      drag.anchor = {
        node: selection.anchorNode,
        offset: selection.anchorOffset,
      };
    }
    event.preventDefault();
    // Past the note's top or bottom edge, it scrolls along.
    const view = scroller.getBoundingClientRect();
    if (event.clientY < view.top)
      scroller.scrollTop -= Math.min(40, view.top - event.clientY);
    else if (event.clientY > view.bottom)
      scroller.scrollTop += Math.min(40, event.clientY - view.bottom);
    const point = nearest(
      event.clientX,
      Math.max(view.top + 2, Math.min(view.bottom - 2, event.clientY)),
    );
    if (!point || !drag.anchor.node.isConnected) return;
    drag.focus = point;
    window
      .getSelection()
      .setBaseAndExtent(
        drag.anchor.node,
        drag.anchor.offset,
        point.node,
        point.offset,
      );
  }

  // The selection set here holds the point where the button went down, and
  // the browser would take the next move for dragging that text away.
  content.addEventListener("dragstart", (event) => {
    if (drag?.taken) event.preventDefault();
  });
  content.addEventListener("keydown", onKeyDown, true);
  scroller.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mousemove", onMouseMove, true);
  // The browser would end its own drag with a selection of its own.
  document.addEventListener(
    "mouseup",
    (event) => {
      const done = drag;
      drag = null;
      if (!done?.taken || !done.focus) return;
      event.preventDefault();
      const { anchor, focus } = done;
      setTimeout(() => {
        const selection = window.getSelection();
        if (
          anchor.node.isConnected &&
          focus.node.isConnected &&
          (selection.focusNode !== focus.node ||
            selection.focusOffset !== focus.offset)
        )
          selection.setBaseAndExtent(
            anchor.node,
            anchor.offset,
            focus.node,
            focus.offset,
          );
      });
    },
    true,
  );

  return { mark, unmark, adopt, hostOf };
}
