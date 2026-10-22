// Keep recent previews alive, reconciling source skeletons rather than expanded
// KaTeX/diagram DOM. Matching siblings by content also survives insertions/deletions.
export function createPreviewCache({
  maxDocuments = 4,
  maxHtmlBytes = 4 * 1024 * 1024,
} = {}) {
  const entries = new Map(),
    signatures = new WeakMap(),
    // Blocks typed into (direct editing) since they were last described.
    typed = new WeakSet();
  let active = null,
    bytes = 0;
  // The source positions the renderer writes (markdown.js).
  const keys = ["", "text", "edit", "block", "src", "srcInner"].flatMap(
    (kind) => (kind ? [kind + "From", kind + "To"] : ["from", "to"]),
  );
  const mappedSelector = keys
    .map(
      (key) => `[data-${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}]`,
    )
    .join(",");
  const mapped = (node) =>
    node.nodeType === 1 ? [node, ...node.querySelectorAll(mappedSelector)] : [];
  const shell = (node) =>
    node.nodeType === 1 &&
    (node.classList.contains("note-section") ||
      node.classList.contains("section-body"));
  // A section or section body, and of which level.
  const kind = (node) =>
    JSON.stringify([
      node.className.replace(/\s*collapsed\b/, ""),
      node.dataset.level,
    ]);
  const shellKey = (node) => JSON.stringify([kind(node), node.dataset.foldKey]);

  // Without positions, and without what direct editing sets on blocks in the
  // page (editing hosts, islands).
  const plain = (raw) =>
    raw.replace(
      / data-(?:text-|edit-|block-|src-(?:inner-)?)?(?:from|to)="\d+"| contenteditable="(?:true|false)"| data-direct-host=""| spellcheck="false"/g,
      "",
    );
  function describe(node) {
    let value = signatures.get(node);
    if (value && typed.has(node)) {
      typed.delete(node);
      value = retyped(node, value);
      if (value) signatures.set(node, value);
    }
    if (!value) {
      const raw = node.nodeType === 1 ? node.outerHTML : node.textContent;
      value = {
        raw,
        signature: node.nodeType === 1 ? plain(raw) : raw,
        ranges: mapped(node).map((element) =>
          keys.map((key) => element.dataset[key]),
        ),
      };
      signatures.set(node, value);
    }
    return value;
  }
  // A block typed into: as it was rendered, with the text its runs hold now.
  // A render of the same text then keeps the block (only its positions
  // change): it holds the caret, and an input method composing there on
  // Windows ends the composition when the block is replaced. Null when the
  // typing did more than change the runs' text.
  function retyped(node, value) {
    const template = node.ownerDocument.createElement("template");
    template.innerHTML = value.raw;
    const skeleton = template.content.firstElementChild,
      runs = skeleton ? [...skeleton.querySelectorAll("[data-text-from]")] : [],
      live = [...node.querySelectorAll("[data-text-from]")];
    if (
      runs.length !== live.length ||
      live.some((run) => [...run.childNodes].some((n) => n.nodeType !== 3))
    )
      return null;
    // A space typed at a run's edge shows as a no-break space.
    runs.forEach((run, i) => {
      run.textContent = live[i].textContent.replace(/\u00a0/g, " ");
    });
    const raw = skeleton.outerHTML;
    return { raw, signature: plain(raw), ranges: value.ranges };
  }
  function identity(node) {
    return shell(node)
      ? "shell:" + shellKey(node)
      : "leaf:" + describe(node).signature;
  }
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entry.hydrate?.deactivate?.();
    bytes -= entry.bytes;
    entries.delete(key);
  }

  // Use the original source-order snapshot, NOT current DOM order: table sorting
  // moves rows without moving their source ranges. Keep every row's mapping intact.
  function remap(old, before, after) {
    const elements = mapped(old);
    if (
      before.ranges.length !== after.ranges.length ||
      elements.length !== after.ranges.length
    )
      return false;
    const translations = keys.map(() => new Map());
    for (let i = 0; i < before.ranges.length; i++) {
      for (let k = 0; k < keys.length; k++) {
        const previous = before.ranges[i][k],
          next = after.ranges[i][k];
        if (
          translations[k].has(previous) &&
          translations[k].get(previous) !== next
        )
          return false;
        translations[k].set(previous, next);
      }
    }
    // Validate everything before mutating anything; external DOM edits may add ranges.
    if (
      elements.some((element) =>
        keys.some((key, k) => !translations[k].has(element.dataset[key])),
      )
    )
      return false;
    for (const element of elements) {
      keys.forEach((key, k) => {
        const next = translations[k].get(element.dataset[key]);
        if (next === undefined) delete element.dataset[key];
        else if (element.dataset[key] !== next) element.dataset[key] = next;
      });
    }
    return true;
  }
  function reuse(node, old, hydrate) {
    if (shell(node)) {
      if (old && shell(old) && kind(node) === kind(old)) {
        for (const key of ["blockCount", "foldKey"])
          if (
            node.dataset[key] !== undefined &&
            node.dataset[key] !== old.dataset[key]
          )
            old.dataset[key] = node.dataset[key];
        reconcile(
          old,
          children([...node.childNodes], [...old.childNodes], hydrate),
        );
        return old;
      }
      children([...node.childNodes], [], hydrate);
      return node;
    }
    const next = describe(node),
      previous = old && describe(old);
    if (
      previous?.signature === next.signature &&
      (previous.raw === next.raw || remap(old, previous, next))
    ) {
      signatures.set(old, next);
      return old;
    }
    hydrate?.(node);
    return node;
  }
  function children(candidates, previous, hydrate) {
    const buckets = new Map();
    for (const node of previous) {
      const key = identity(node);
      if (!buckets.has(key)) buckets.set(key, { nodes: [], cursor: 0 });
      buckets.get(key).nodes.push(node);
    }
    const olds = candidates.map((node) => {
      const bucket = buckets.get(identity(node));
      return bucket?.nodes[bucket.cursor++];
    });
    // A section whose heading changed (typed into, renamed) is still the
    // section left over in its place: its heading and blocks are kept where
    // they render the same, and the heading being typed into keeps the focus.
    const used = new Set(olds),
      spare = previous.filter((node) => shell(node) && !used.has(node));
    candidates.forEach((node, i) => {
      if (olds[i] || !shell(node)) return;
      const at = spare.findIndex((old) => kind(old) === kind(node));
      if (at >= 0) olds[i] = spare.splice(at, 1)[0];
    });
    return keepFocused(
      previous,
      candidates.map((node, i) => reuse(node, olds[i], hydrate)),
    );
  }
  // The block holding the focus (being typed into) stays in the page even
  // when it renders differently: it takes the new block's attributes and
  // content (morph). The focus moving to another element tells the input
  // method its text field changed, and some (Sogou Pinyin) end their
  // composition then.
  // What the page sets on rendered elements, kept as it is: editing hosts
  // and islands, an open <details>, a broken link's mark; classes the
  // reader toggles or the page marks with; and what it adds (backlink
  // counts).
  const own = [
      "contenteditable",
      "data-direct-host",
      "spellcheck",
      "open",
      "data-broken",
    ],
    toggled = [
      "collapsed",
      "code-collapsed",
      "code-wrap",
      "has-backlinks",
      "link-broken",
    ],
    added = (node) =>
      node.nodeType === 1 &&
      (node.classList.contains("backlink-badge") ||
        // A place direct editing made to type into, not typed into yet.
        node.classList.contains("direct-empty") ||
        node.classList.contains("direct-empty-block"));
  // Typeset formulas and diagrams are taken whole from the new block (it was
  // hydrated); buttons showing a state the reader set (a folded section, an
  // expanded code block) are kept.
  const whole = ".formula,.math-block,.mermaid,svg,img";
  const stated = (a, b) =>
    ["aria-expanded", "aria-pressed"].some(
      (name) => a.getAttribute(name) !== b.getAttribute(name),
    );
  function morph(live, next) {
    for (const { name } of [...live.attributes])
      if (!next.hasAttribute(name) && !own.includes(name) && name !== "class")
        live.removeAttribute(name);
    for (const { name, value } of [...next.attributes])
      if (name !== "class" && live.getAttribute(name) !== value)
        live.setAttribute(name, value);
    const classes = new Set(next.classList);
    for (const name of toggled)
      if (live.classList.contains(name)) classes.add(name);
      else classes.delete(name);
    const className = [...classes].join(" ");
    if (live.className !== className)
      if (className) live.className = className;
      else live.removeAttribute("class");
    const a = [...live.childNodes].filter((node) => !added(node)),
      b = [...next.childNodes];
    if (
      a.length !== b.length ||
      a.some(
        (node, i) =>
          node.nodeType !== b[i].nodeType ||
          (node.nodeType === 1 && node.tagName !== b[i].tagName),
      )
    )
      return live.replaceChildren(...b);
    a.forEach((node, i) => {
      const other = b[i];
      if (node.nodeType !== 1) {
        // The text being typed into stays, a typed space shown as a no-break
        // one included.
        if (node.data.replace(/\u00a0/g, " ") !== other.data)
          node.data = other.data;
      } else if (node.matches(whole)) node.replaceWith(other);
      else if (!(node.tagName === "BUTTON" && stated(node, other)))
        morph(node, other);
    });
  }
  function keepFocused(previous, nodes) {
    const active = previous[0]?.ownerDocument.activeElement;
    const focused =
      active &&
      previous.find(
        (node) => node.nodeType === 1 && !shell(node) && node.contains(active),
      );
    if (!focused || nodes.includes(focused)) return nodes;
    // An empty paragraph direct editing made (Enter) is not in the source's
    // render yet: it stays where it is, after the blocks before it.
    // The new block in its place: after as many kept blocks as preceded it
    // (the text between blocks aside).
    const old = new Set(previous),
      kept = new Set(nodes),
      elements = (list) => list.filter((node) => node.nodeType === 1);
    const before = elements(
      previous.slice(0, previous.indexOf(focused)),
    ).filter((node) => kept.has(node)).length;
    let seen = 0,
      next = null;
    for (const node of elements(nodes))
      if (!old.has(node)) {
        if (seen === before) {
          next = node;
          break;
        }
      } else if (seen++ === before) break;
    if (added(focused)) {
      // After the nearest kept block before it (one replaced in between
      // would move it, and a moved element loses the focus).
      const list = [...nodes],
        prior = previous
          .slice(0, previous.indexOf(focused))
          .findLast((node) => kept.has(node));
      list.splice(prior ? list.indexOf(prior) + 1 : 0, 0, focused);
      return list;
    }
    if (!next || next.tagName !== focused.tagName) return nodes;
    const value = describe(next);
    morph(focused, next);
    signatures.set(focused, value);
    return nodes.map((node) => (node === next ? focused : node));
  }
  function reconcile(parent, nodes) {
    const keep = new Set(nodes);
    for (const node of [...parent.childNodes])
      if (!keep.has(node)) node.remove();
    let cursor = parent.firstChild;
    for (const node of nodes) {
      if (cursor === node) cursor = cursor.nextSibling;
      else parent.insertBefore(node, cursor);
    }
  }

  return {
    update(
      container,
      key,
      html,
      fragment = null,
      { hydrate, bytes: cost } = {},
    ) {
      if (active?.key === key && active.html === html) return false;
      active?.hydrate?.deactivate?.();
      let entry = entries.get(key);
      if (!entry || entry.html !== html) {
        if (!fragment) {
          const template = container.ownerDocument.createElement("template");
          template.innerHTML = html;
          fragment = template.content;
        }
        const previous =
          active?.key === key ? active.nodes : entry?.nodes || [];
        const nodes = children([...fragment.childNodes], previous, hydrate);
        entry = { key, html, nodes, hydrate, bytes: cost ?? html.length * 2 };
      }
      if (active?.key === key) reconcile(container, entry.nodes);
      else container.replaceChildren(...entry.nodes);
      remove(key);
      entries.set(key, entry);
      bytes += entry.bytes;
      active = entry;
      entry.hydrate?.activate?.(container);
      // Keep the visible note, even when it exceeds the retention budget.
      while (
        entries.size > 1 &&
        (entries.size > maxDocuments || bytes > maxHtmlBytes)
      )
        remove(entries.keys().next().value);
      return true;
    },
    // Typing in the page (direct editing) changed this node: read its text
    // again at the next render, and render the next text even if it equals
    // the cached one.
    taint(container, node) {
      for (let el = node; el && el !== container; el = el.parentNode)
        if (el.parentNode === container || shell(el.parentNode)) {
          typed.add(el);
          break;
        }
      if (active) active.html = null;
    },
    // Direct editing rendered some blocks of the visible note on their own:
    // they take the place of `olds` (siblings in one parent). They are
    // described before their formulas expand, as a full render's are, so the
    // next full render keeps them when it renders the same.
    // Returns the nodes now in their place: the block holding the focus
    // stays, taking the new content in its place (see keepFocused).
    place(container, olds, nodes, hydrate) {
      for (const node of nodes) describe(node);
      for (const node of nodes) hydrate?.(node);
      const focus = container.ownerDocument.activeElement,
        elements = (list) => list.filter((node) => node.nodeType === 1);
      const focused = elements(olds).find((node) => node.contains(focus));
      const next = focused && elements(nodes)[elements(olds).indexOf(focused)];
      if (next && next.tagName === focused.tagName) {
        const value = describe(next);
        morph(focused, next);
        signatures.set(focused, value);
        nodes = nodes.map((node) => (node === next ? focused : node));
      }
      const first = olds[0],
        kept = nodes.indexOf(focused);
      // Never moved: a focused element taken out of the page loses the focus.
      if (kept >= 0) {
        focused.before(...nodes.slice(0, kept));
        focused.after(...nodes.slice(kept + 1));
      } else first.before(...nodes);
      for (const old of olds) if (old !== focused || kept < 0) old.remove();
      if (!active) return nodes;
      // Blocks before the first heading are the entry's own nodes.
      const at = active.nodes.indexOf(first);
      if (at >= 0) {
        const rest = active.nodes.filter((node) => !olds.includes(node));
        rest.splice(at, 0, ...nodes);
        active.nodes = rest;
      }
      active.html = null;
      return nodes;
    },
    release(key) {
      remove(key);
      if (active?.key === key) active = null;
    },
    clear() {
      for (const key of entries.keys()) remove(key);
      active = null;
      bytes = 0;
    },
  };
}
