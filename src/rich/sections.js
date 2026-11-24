// Mirrors the reading view's .note-section nesting, non-collapsed heading body
// spacing, and section-body edge cleanup in Edit mode without wrapping blocks
// outside ProseMirror's flat top-level block model.
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { schema } from "./markdown.js";

const S = schema.nodes;
const SCALE = { 1: 1.85, 2: 1.5, 3: 1.25, 4: 1.1, 5: 1, 6: 0.95 };

function titleBlockIndex(doc) {
  let firstNonFront = -1;
  let h1Count = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type === S.heading && child.attrs.level === 1) h1Count++;
    if (
      firstNonFront < 0 &&
      !(child.type === S.raw_block && child.attrs.kind === "frontmatter")
    )
      firstNonFront = i;
  }
  if (firstNonFront < 0 || h1Count !== 1) return -1;
  const first = doc.child(firstNonFront);
  return first.type === S.heading && first.attrs.level === 1
    ? firstNonFront
    : -1;
}

function buildDecorations(doc) {
  const titleIdx = titleBlockIndex(doc);
  const stack = [];
  const entries = [];
  const children = [];
  doc.forEach((node, pos, index) => {
    children.push({ node, pos, index });
    entries.push({
      pos,
      size: node.nodeSize,
      depth: 0,
      secHead: false,
      secFirst: false,
      secLast: false,
      mtKind: null,
      headMbScale: 0,
    });
  });

  for (let i = 0; i < children.length; i++) {
    const { node } = children[i];
    if (i === titleIdx) continue;
    if (node.type === S.heading) {
      const level = node.attrs.level;
      let closedEmptyScale = 0;
      while (stack.length && stack.at(-1).level >= level) {
        const popped = stack.pop();
        if (!popped.lastChildWasSection && popped.lastBodyIdx != null)
          entries[popped.lastBodyIdx].secLast = true;
        if (popped.childrenCount === 0) closedEmptyScale = popped.scale;
      }
      const parent = stack.at(-1) || null;
      const entry = entries[i];
      entry.depth = stack.length;
      entry.secHead = true;
      if (parent && parent.childrenCount === 0) {
        entry.mtKind = "nested-first";
        entry.headMbScale = parent.scale;
      } else if (closedEmptyScale) {
        entry.mtKind = "after-empty";
        entry.headMbScale = closedEmptyScale;
      } else if (
        i === 0 ||
        (i === 1 &&
          children[0].node.type === S.raw_block &&
          children[0].node.attrs.kind === "frontmatter")
      ) {
        entry.mtKind = "zero";
      } else {
        entry.mtKind = "normal";
      }
      if (parent) {
        parent.childrenCount++;
        parent.lastChildWasSection = true;
      }
      stack.push({
        level,
        scale: SCALE[level] ?? 1,
        childrenCount: 0,
        lastBodyIdx: null,
        lastChildWasSection: false,
      });
    } else if (stack.length) {
      const top = stack.at(-1);
      const entry = entries[i];
      entry.depth = stack.length - 1;
      if (top.childrenCount === 0) {
        entry.secFirst = true;
        entry.headMbScale = top.scale;
      }
      top.childrenCount++;
      top.lastChildWasSection = false;
      top.lastBodyIdx = i;
    }
  }
  while (stack.length) {
    const popped = stack.pop();
    if (!popped.lastChildWasSection && popped.lastBodyIdx != null)
      entries[popped.lastBodyIdx].secLast = true;
  }

  const decos = [];
  for (const e of entries) {
    const attrs = {};
    const styles = [];
    if (e.depth > 0) styles.push(`--rich-depth:${e.depth}`);
    if (e.headMbScale > 0)
      styles.push(
        `--rich-head-mb:calc(0.65 * ${e.headMbScale} * var(--note-size))`,
      );
    if (e.secHead) attrs["data-rich-sec-mt"] = e.mtKind;
    if (e.secFirst) attrs["data-rich-sec-first"] = "";
    if (e.secLast) attrs["data-rich-sec-last"] = "";
    if (styles.length) attrs.style = styles.join(";");
    if (Object.keys(attrs).length)
      decos.push(Decoration.node(e.pos, e.pos + e.size, attrs));
  }
  return DecorationSet.create(doc, decos);
}

export const richSections = new Plugin({
  state: {
    init: (_c, { doc }) => buildDecorations(doc),
    apply(tr, set) {
      return tr.docChanged ? buildDecorations(tr.doc) : set;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});
