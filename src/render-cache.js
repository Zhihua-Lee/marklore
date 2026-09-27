// Keep a few recent previews alive so tab/mode changes do not parse HTML again,
// restart image decoding, or throw away already-rendered formula/diagram DOM.
export function createPreviewCache({
  maxDocuments = 4,
  maxHtmlBytes = 4 * 1024 * 1024,
} = {}) {
  const entries = new Map(),
    signatures = new WeakMap();
  let active = null,
    bytes = 0;

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(key);
  }

  const shell = (node) =>
    node.nodeType === 1 &&
    (node.classList.contains("note-section") ||
      node.classList.contains("section-body"));
  function reuse(node, old) {
    if (shell(node)) {
      const match =
        old &&
        shell(old) &&
        node.className === old.className.replace(/\s*collapsed\b/, "") &&
        node.dataset.foldKey === old.dataset.foldKey &&
        node.dataset.level === old.dataset.level;
      if (match) {
        if (
          node.dataset.blockCount !== old.dataset.blockCount &&
          node.dataset.blockCount !== undefined
        )
          old.dataset.blockCount = node.dataset.blockCount;
        reconcile(old, [...node.childNodes], [...old.childNodes]);
        return old;
      }
      // Seed leaf signatures before user state (folds, table widths, diagrams)
      // changes the DOM. Unchanged descendants must never be serialized again.
      for (const child of [...node.childNodes]) reuse(child, null);
      return node;
    }
    const signature = node.nodeType === 1 ? node.outerHTML : node.textContent;
    if (old && signatures.get(old) === signature) return old;
    signatures.set(node, signature);
    return node;
  }
  function reconcile(parent, candidates, previous) {
    const nodes = candidates.map((node, i) => reuse(node, previous[i]));
    const keep = new Set(nodes);
    for (const node of [...parent.childNodes])
      if (!keep.has(node)) node.remove();
    let cursor = parent.firstChild;
    for (const node of nodes) {
      if (cursor === node) cursor = cursor.nextSibling;
      else parent.insertBefore(node, cursor);
    }
    return nodes;
  }

  return {
    update(container, key, html, fragment = null) {
      if (active?.key === key && active.html === html) return false;
      let entry = entries.get(key);
      if (!entry || entry.html !== html) {
        if (!fragment) {
          const template = container.ownerDocument.createElement("template");
          template.innerHTML = html;
          fragment = template.content;
        }
        const previous = active?.key === key ? active.nodes : [];
        const nodes = [...fragment.childNodes].map((node, index) =>
          reuse(node, previous[index]),
        );
        entry = { key, html, nodes, bytes: html.length * 2 };
      }

      if (active?.key === key) {
        const keep = new Set(entry.nodes);
        for (const node of [...container.childNodes])
          if (!keep.has(node)) node.remove();
        let current = container.firstChild;
        for (const node of entry.nodes) {
          if (current === node) current = current.nextSibling;
          else container.insertBefore(node, current);
        }
      } else container.replaceChildren(...entry.nodes);

      remove(key);
      entries.set(key, entry);
      bytes += entry.bytes;
      active = entry;
      // The visible preview must remain alive; the limits bound only the extra
      // retained documents, even when a single visible note exceeds the budget.
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
      entries.clear();
      active = null;
      bytes = 0;
    },
  };
}
