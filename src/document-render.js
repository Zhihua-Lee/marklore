import { renderMarkdown } from "./markdown.js";
import { diffDocument, isDiffDocument } from "./diff-view.js";

// A note renders as Markdown; a diff (an other format, turned on in Settings)
// as its files' sections, with positions in the diff's own text.
export function renderDocument(doc, options = {}) {
  if (!isDiffDocument(doc))
    return renderMarkdown(doc.text, doc.fileId, options);
  const diff = diffDocument(doc.text);
  return renderMarkdown(diff.markdown, doc.fileId, {
    ...options,
    mapPosition: diff.map,
    expandCode: true,
  });
}
