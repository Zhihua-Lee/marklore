// Mirrors the reading view's .note-section nesting, non-collapsed heading body
// spacing, and section-body edge cleanup in Edit mode without wrapping blocks
// outside ProseMirror's flat top-level block model or emitting per-block
// ProseMirror decorations (which make ProseMirror scan O(N^2) on every edit).
import { Plugin, PluginKey } from "prosemirror-state";
import { schema } from "./markdown.js";

const S = schema.nodes;
const key = new PluginKey("richSections");

export function isAnchorOnlyNode(node) {
  if (node?.type !== S.paragraph || !node.childCount) return false;
  let anchors = 0;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === S.raw_inline && child.attrs.kind === "anchor") {
      anchors++;
    } else if (!child.isText || child.text.trim()) {
      return false;
    }
  }
  return anchors > 0;
}

function blockSig(node) {
  if (node.type === S.heading) return node.attrs.level;
  if (node.type === S.raw_block && node.attrs.kind === "frontmatter")
    return "fm";
  if (isAnchorOnlyNode(node)) return "anchor";
  return "b";
}

function titleBlockIndex(doc) {
  let firstReal = -1;
  let h1Count = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const sig = blockSig(child);
    if (sig === 1) h1Count++;
    if (firstReal < 0 && sig !== "fm" && sig !== "anchor") firstReal = i;
  }
  if (firstReal < 0 || h1Count !== 1) return -1;
  return blockSig(doc.child(firstReal)) === 1 ? firstReal : -1;
}

function computeEntries(doc) {
  const titleIdx = titleBlockIndex(doc);
  const stack = [];
  const entries = new Array(doc.childCount);
  for (let i = 0; i < doc.childCount; i++) {
    const sig = blockSig(doc.child(i));
    entries[i] = {
      sig,
      depth: 0,
      headLevel: 0,
      mtKind: "",
      secFirst: false,
      secLast: false,
      key: "",
    };
  }

  let seenReal = false;
  const pendingAnchors = [];
  const flushAnchors = (depth) => {
    for (const idx of pendingAnchors) entries[idx].depth = depth;
    pendingAnchors.length = 0;
  };

  for (let i = 0; i < doc.childCount; i++) {
    const entry = entries[i];
    const sig = entry.sig;
    if (sig === "anchor") {
      pendingAnchors.push(i);
      continue;
    }
    if (i === titleIdx) {
      flushAnchors(0);
      seenReal = true;
      continue;
    }
    if (typeof sig === "number") {
      const level = sig;
      let closedEmptyLevel = 0;
      while (stack.length && stack.at(-1).level >= level) {
        const popped = stack.pop();
        if (!popped.lastChildWasSection && popped.lastBodyIdx != null)
          entries[popped.lastBodyIdx].secLast = true;
        if (popped.childrenCount === 0) closedEmptyLevel = popped.level;
      }
      const parent = stack.at(-1) || null;
      entry.depth = stack.length;
      flushAnchors(parent ? stack.length - 1 : 0);
      if (parent && parent.childrenCount === 0) {
        entry.mtKind = "nested-first";
        entry.headLevel = parent.level;
      } else if (closedEmptyLevel) {
        entry.mtKind = "after-empty";
        entry.headLevel = closedEmptyLevel;
      } else if (!seenReal) {
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
        childrenCount: 0,
        lastBodyIdx: null,
        lastChildWasSection: false,
      });
      seenReal = true;
    } else if (sig === "fm") {
      flushAnchors(0);
    } else if (stack.length) {
      const depth = stack.length - 1;
      flushAnchors(depth);
      const top = stack.at(-1);
      entry.depth = depth;
      if (top.childrenCount === 0) {
        entry.secFirst = true;
        entry.headLevel = top.level;
      }
      top.childrenCount++;
      top.lastChildWasSection = false;
      top.lastBodyIdx = i;
      seenReal = true;
    } else {
      flushAnchors(0);
      seenReal = true;
    }
  }
  flushAnchors(stack.length ? stack.length - 1 : 0);
  while (stack.length) {
    const popped = stack.pop();
    if (!popped.lastChildWasSection && popped.lastBodyIdx != null)
      entries[popped.lastBodyIdx].secLast = true;
  }

  for (const e of entries)
    e.key = `${e.sig === "anchor" ? 1 : 0}|${e.depth}|${e.headLevel}|${e.mtKind}|${e.secFirst ? 1 : 0}|${e.secLast ? 1 : 0}`;
  return entries;
}

// Fast check: when an edit stays strictly inside a single top-level block
// without adding/removing top-level blocks or changing its heading/frontmatter
// role, the section tree is guaranteed unchanged.
function singleTouchedBlock(tr, prevEntries) {
  if (tr.doc.childCount !== prevEntries.length) return null;
  let minPos = Infinity;
  let maxPos = -Infinity;
  const maps = tr.mapping.maps;
  for (let m = 0; m < maps.length; m++) {
    const rest = tr.mapping.slice(m + 1);
    maps[m].forEach((_os, _oe, ns, ne) => {
      const a = rest.map(ns, -1);
      const b = rest.map(ne, 1);
      if (a < minPos) minPos = a;
      if (b > maxPos) maxPos = b;
    });
  }
  if (!Number.isFinite(minPos)) return null;
  const maxDoc = tr.doc.content.size;
  const $a = tr.doc.resolve(Math.max(0, Math.min(maxDoc, minPos)));
  const $b = tr.doc.resolve(Math.max(0, Math.min(maxDoc, maxPos)));
  if ($a.depth < 1 || $b.depth < 1 || $a.index(0) !== $b.index(0)) return null;
  const idx = $a.index(0);
  if (blockSig(tr.doc.child(idx)) !== prevEntries[idx].sig) return null;
  return { idx, pos: $a.before(1) };
}

const applied = new WeakMap();

function syncAttr(el, name, want, prevHas, prevVal) {
  if (want) {
    if (!prevHas || prevVal !== want) el.setAttribute(name, want);
  } else if (prevHas) {
    el.removeAttribute(name);
  }
}

function syncFlag(el, name, want, prevHas) {
  if (want) {
    if (!prevHas) el.setAttribute(name, "");
  } else if (prevHas) {
    el.removeAttribute(name);
  }
}

function syncNestedAnchors(el, docNode, observerControl) {
  if (
    !docNode ||
    docNode.type === S.paragraph ||
    docNode.type === S.heading ||
    docNode.isLeaf
  )
    return;
  const flags = [];
  docNode.descendants((node) => {
    if (node.type === S.paragraph) {
      flags.push(isAnchorOnlyNode(node));
      return false;
    }
    return true;
  });
  const domParas = el.querySelectorAll("p");
  if (domParas.length !== flags.length) return;
  for (let i = 0; i < domParas.length; i++) {
    const has = domParas[i].classList.contains("anchor-only");
    if (has !== flags[i]) {
      observerControl.stop();
      domParas[i].classList.toggle("anchor-only", flags[i]);
    }
  }
}

function syncElement(el, entry, observerControl, docNode) {
  const prev = applied.get(el);
  if (prev?.key !== entry.key) {
    observerControl.stop();
    syncAttr(
      el,
      "data-rich-depth",
      entry.depth > 0 ? String(entry.depth) : "",
      Boolean(prev?.depth > 0),
      prev ? String(prev.depth) : "",
    );
    syncAttr(
      el,
      "data-rich-head",
      entry.headLevel > 0 ? String(entry.headLevel) : "",
      Boolean(prev?.headLevel > 0),
      prev ? String(prev.headLevel) : "",
    );
    syncAttr(
      el,
      "data-rich-sec-mt",
      entry.mtKind,
      Boolean(prev?.mtKind),
      prev?.mtKind || "",
    );
    syncFlag(
      el,
      "data-rich-sec-first",
      entry.secFirst,
      Boolean(prev?.secFirst),
    );
    syncFlag(el, "data-rich-sec-last", entry.secLast, Boolean(prev?.secLast));
    el.classList.toggle("anchor-only", entry.sig === "anchor");
    applied.set(el, entry);
  }
  syncNestedAnchors(el, docNode, observerControl);
}

function syncAll(view, entries) {
  let stopped = false;
  const control = {
    stop() {
      if (stopped) return;
      view.domObserver?.stop();
      stopped = true;
    },
  };
  try {
    let idx = 0;
    const doc = view.state.doc;
    for (
      let el = view.dom.firstElementChild;
      el && idx < entries.length;
      el = el.nextElementSibling
    ) {
      if (!el.pmViewDesc?.node) continue;
      syncElement(el, entries[idx], control, doc.child(idx));
      idx++;
    }
  } finally {
    if (stopped) view.domObserver?.start();
  }
}

function syncSingle(view, entry, pos, idx) {
  const el = view.nodeDOM(pos);
  if (!el) return;
  let stopped = false;
  const control = {
    stop() {
      if (stopped) return;
      view.domObserver?.stop();
      stopped = true;
    },
  };
  try {
    syncElement(el, entry, control, view.state.doc.child(idx));
  } finally {
    if (stopped) view.domObserver?.start();
  }
}

export function richSectionBuilds(state) {
  const direct = key.getState(state);
  if (direct) return direct.builds;
  for (const plugin of state.plugins || []) {
    if (plugin.key?.startsWith("richSections$"))
      return plugin.getState(state)?.builds ?? 0;
  }
  return 0;
}

export const richSections = new Plugin({
  key,
  state: {
    init: (_c, { doc }) => ({
      entries: computeEntries(doc),
      builds: 1,
      touched: null,
    }),
    apply(tr, prev) {
      if (!tr.docChanged) return prev;
      const touched = singleTouchedBlock(tr, prev.entries);
      if (touched)
        return { entries: prev.entries, builds: prev.builds, touched };
      return {
        entries: computeEntries(tr.doc),
        builds: prev.builds + 1,
        touched: null,
      };
    },
  },
  view(editorView) {
    let syncedEntries = null;
    const initial = key.getState(editorView.state);
    if (initial) {
      syncAll(editorView, initial.entries);
      syncedEntries = initial.entries;
    }
    return {
      update(view) {
        const next = key.getState(view.state);
        if (!next) return;
        if (next.entries !== syncedEntries) {
          syncAll(view, next.entries);
          syncedEntries = next.entries;
        } else if (next.touched) {
          syncSingle(
            view,
            next.entries[next.touched.idx],
            next.touched.pos,
            next.touched.idx,
          );
        }
      },
    };
  },
});
