// Reading locations, never document copies or editor undo states.
export function createNavigationHistory(limit = 200) {
  let entries = [],
    cursor = -1;
  const copy = (entry) => ({ id: entry.id, anchor: { ...entry.anchor } });
  function update(entry) {
    if (entry && entries[cursor]?.id === entry.id)
      entries[cursor] = copy(entry);
  }
  function visit(entry, origin) {
    if (!entry) return;
    update(origin);
    const current = entries[cursor];
    if (
      current?.id === entry.id &&
      current.anchor.from === entry.anchor.from &&
      current.anchor.targetId === entry.anchor.targetId &&
      !!current.anchor.top === !!entry.anchor.top &&
      current.anchor.y === entry.anchor.y
    )
      return;
    entries.splice(cursor + 1);
    entries.push(copy(entry));
    if (entries.length > limit) entries.shift();
    cursor = entries.length - 1;
  }
  function target(direction, id, currentOnly) {
    for (
      let i = cursor + direction;
      i >= 0 && i < entries.length;
      i += direction
    )
      if (!currentOnly || entries[i].id === id) return i;
    return -1;
  }
  return {
    visit,
    update,
    can(direction, id, currentOnly = false) {
      return target(direction, id, currentOnly) >= 0;
    },
    go(direction, current, currentOnly = false) {
      const index = target(direction, current?.id, currentOnly);
      if (index < 0) return null;
      update(current);
      cursor = index;
      return copy(entries[cursor]);
    },
    remove(id) {
      const before = entries
        .slice(0, cursor + 1)
        .filter((e) => e.id !== id).length;
      entries = entries.filter((e) => e.id !== id);
      cursor = before - 1;
    },
    map(id, changes) {
      for (const entry of entries)
        if (entry.id === id)
          entry.anchor.from = changes.mapPos(
            Math.min(entry.anchor.from || 0, changes.length),
            1,
          );
    },
  };
}
