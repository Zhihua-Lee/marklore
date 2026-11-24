// Heading anchors, shared by the renderer (ids on rendered headings) and the
// main process (the link index checks anchors without rendering). Lower case,
// letters (any script), digits, spaces, "_" and "-" kept, spaces to "-";
// repeats get "-1", "-2"... in document order, skipping any already taken
// (headings "A", "A-1", "A" give a, a-1, a-2).
export function headingSlug(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section"
  );
}

export function createSlugger() {
  const seen = new Map();
  // Each slug given out, with the last number tried after it.
  return (text) => {
    const base = headingSlug(text);
    let slug = base;
    if (seen.has(slug)) {
      let n = seen.get(base);
      do slug = `${base}-${++n}`;
      while (seen.has(slug));
      seen.set(base, n);
    }
    seen.set(slug, 0);
    return slug;
  };
}
