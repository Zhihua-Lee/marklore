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

  return {
    update(container, key, html) {
      if (active?.key === key && active.html === html) return false;
      let entry = entries.get(key);
      if (!entry || entry.html !== html) {
        const template = container.ownerDocument.createElement("template");
        template.innerHTML = html;
        const previous = active?.key === key ? active.nodes : [];
        const nodes = [...template.content.childNodes].map((node, index) => {
          const signature =
              node.nodeType === 1 ? node.outerHTML : node.textContent,
            old = previous[index];
          if (old && signatures.get(old) === signature) return old;
          signatures.set(node, signature);
          return node;
        });
        entry = { key, html, nodes, bytes: html.length * 2 };
      }

      if (active?.key === key) {
        const keep = new Set(entry.nodes);
        for (const node of [...container.childNodes])
          if (!keep.has(node)) node.remove();
        entry.nodes.forEach((node, index) => {
          const current = container.childNodes[index];
          if (current !== node) container.insertBefore(node, current || null);
        });
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
