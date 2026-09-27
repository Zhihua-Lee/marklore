// Keep recent previews alive, reconciling source skeletons rather than expanded
// KaTeX/diagram DOM. Matching siblings by content also survives insertions/deletions.
export function createPreviewCache({
  maxDocuments = 4,
  maxHtmlBytes = 4 * 1024 * 1024,
} = {}) {
  const entries = new Map(),
    signatures = new WeakMap();
  let active = null,
    bytes = 0;
  const keys = ["from", "to", "textFrom", "textTo", "editFrom", "editTo"];
  const mappedSelector =
    "[data-from],[data-to],[data-text-from],[data-text-to],[data-edit-from],[data-edit-to]";
  const mapped = (node) =>
    node.nodeType === 1 ? [node, ...node.querySelectorAll(mappedSelector)] : [];
  const shell = (node) =>
    node.nodeType === 1 &&
    (node.classList.contains("note-section") ||
      node.classList.contains("section-body"));
  const shellKey = (node) =>
    JSON.stringify([
      node.className.replace(/\s*collapsed\b/, ""),
      node.dataset.foldKey,
      node.dataset.level,
    ]);

  function describe(node) {
    let value = signatures.get(node);
    if (!value) {
      const raw = node.nodeType === 1 ? node.outerHTML : node.textContent;
      value = {
        raw,
        signature:
          node.nodeType === 1
            ? raw.replace(/ data-(?:text-|edit-)?(?:from|to)="\d+"/g, "")
            : raw,
        ranges: mapped(node).map((element) =>
          keys.map((key) => element.dataset[key]),
        ),
      };
      signatures.set(node, value);
    }
    return value;
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
      if (old && shell(old) && shellKey(node) === shellKey(old)) {
        if (
          node.dataset.blockCount !== undefined &&
          node.dataset.blockCount !== old.dataset.blockCount
        )
          old.dataset.blockCount = node.dataset.blockCount;
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
    return candidates.map((node) => {
      const bucket = buckets.get(identity(node));
      const old = bucket?.nodes[bucket.cursor++];
      return reuse(node, old, hydrate);
    });
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
