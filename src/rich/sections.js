// Mirrors the reading view's .note-section nesting, non-collapsed heading body
// spacing, and section-body edge cleanup in Edit mode without wrapping blocks
// outside ProseMirror's flat top-level block model or emitting per-block
// ProseMirror decorations (which make ProseMirror scan O(N^2) on every edit).
import { Plugin, PluginKey } from "prosemirror-state";
import { schema } from "./markdown.js";

const S = schema.nodes;
const key = new PluginKey("richSections");

function blockSig(node) {
  if (node.type === S.heading) return node.attrs.level;
  if (node.type === S.raw_block && node.attrs.kind === "frontmatter")
    return "fm";
  return "b";
}

function titleBlockIndex(doc) {
  let firstNonFront = -1;
  let h1Count = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type === S.heading && child.attrs.level === 1) h1Count++;
    if (firstNonFront < 0 && blockSig(child) !== "fm") firstNonFront = i;
  }
  if (firstNonFront < 0 || h1Count !== 1) return -1;
  return blockSig(doc.child(firstNonFront)) === 1 ? firstNonFront : -1;
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

  for (let i = 0; i < doc.childCount; i++) {
    if (i === titleIdx) continue;
    const entry = entries[i];
    const sig = entry.sig;
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
      if (parent && parent.childrenCount === 0) {
        entry.mtKind = "nested-first";
        entry.headLevel = parent.level;
      } else if (closedEmptyLevel) {
        entry.mtKind = "after-empty";
        entry.headLevel = closedEmptyLevel;
      } else if (i === 0 || (i === 1 && entries[0].sig === "fm")) {
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
    } else if (stack.length) {
      const top = stack.at(-1);
      entry.depth = stack.length - 1;
      if (top.childrenCount === 0) {
        entry.secFirst = true;
        entry.headLevel = top.level;
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

  for (const e of entries)
    e.key = `${e.depth}|${e.headLevel}|${e.mtKind}|${e.secFirst ? 1 : 0}|${e.secLast ? 1 : 0}`;
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

function syncElement(el, entry, observerControl) {
  const prev = applied.get(el);
  if (prev?.key === entry.key) return false;
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
  syncFlag(el, "data-rich-sec-first", entry.secFirst, Boolean(prev?.secFirst));
  syncFlag(el, "data-rich-sec-last", entry.secLast, Boolean(prev?.secLast));
  applied.set(el, entry);
  return true;
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
    for (
      let el = view.dom.firstElementChild;
      el && idx < entries.length;
      el = el.nextElementSibling
    ) {
      if (!el.pmViewDesc?.node) continue;
      syncElement(el, entries[idx++], control);
    }
  } finally {
    if (stopped) view.domObserver?.start();
  }
}

function syncSingle(view, entry, pos) {
  const el = view.nodeDOM(pos);
  if (!el || applied.get(el)?.key === entry.key) return;
  let stopped = false;
  const control = {
    stop() {
      if (stopped) return;
      view.domObserver?.stop();
      stopped = true;
    },
  };
  try {
    syncElement(el, entry, control);
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
          syncSingle(view, next.entries[next.touched.idx], next.touched.pos);
        }
      },
    };
  },
});
