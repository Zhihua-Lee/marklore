// Byte- and entry-bounded LRU for derived strings; never retain an oversized item.
export function createBoundedCache({ maxEntries = 128, maxBytes = 4 * 1024 * 1024 } = {}) {
  const entries = new Map();
  let bytes = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(key);
  }
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      remove(key);
      const cost = (key.length + value.length) * 2;
      if (cost > maxBytes || maxEntries < 1) return;
      entries.set(key, { value, bytes: cost });
      bytes += cost;
      while (entries.size > maxEntries || bytes > maxBytes)
        remove(entries.keys().next().value);
    },
  };
}
