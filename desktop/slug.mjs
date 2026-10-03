// Heading anchors, shared by the renderer (ids on rendered headings) and the
// main process (the link index checks anchors without rendering). Lower case,
// letters (any script), digits, spaces, "_" and "-" kept, spaces to "-";
// repeats get "-1", "-2"... in document order.
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
  return (text) => {
    let slug = headingSlug(text);
    const count = seen.get(slug) || 0;
    seen.set(slug, count + 1);
    if (count) slug += "-" + count;
    return slug;
  };
}
