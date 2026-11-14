// A note shown in Read mode (or beside its source) and edited in place, a
// word formatted or a character typed: only the top-level blocks the edit
// touched are parsed, rendered and put in the page again. The other blocks
// stay as they are, their formulas drawn; only their source positions move
// by the length the edit added or removed.
//
// The note's last full render (markdown.js, `blocks`) gives its top-level
// blocks, each with its place in the source and its nodes on the page. An
// edit is parsed again from the block before it (further back where a
// block could have run on into it: no blank line between them, a list, a
// quote or indented code), block by block until a block starts again where
// one started before, past the edit: from there on the note parses as it
// did. The blocks between are rendered on their own and put in place of the
// old ones.
//
// Anything else is rendered whole, as before (render-cache.js): a note with
// link reference definitions, footnotes or HTML that leaves an element open
// (markdown.js does not split it); an edit that touches a heading (sections,
// the outline, heading ids), front matter or a <details> (the page keeps
// which are open by their order); a block with the focus in it; settings
// that render differently since; too much to parse again.
import {
  frontMatterLength,
  renderBlocks,
  renderSettings,
  sectionSummary,
} from "./markdown.js";
import { tableChanged } from "./table-layout.js";

const elements = (nodes) => nodes.filter((node) => node.nodeType === 1);
const start = (element) => Number(element.dataset.from);
// `live` given the attributes `next` was rendered with; the page's own
// classes and inline style (skipped from drawing, table widths) kept.
function sameAttributes(live, next) {
  for (const { name } of [...live.attributes])
    if (!next.hasAttribute(name) && name !== "class" && name !== "style")
      live.removeAttribute(name);
  for (const { name, value } of next.attributes)
    if (name !== "class" && live.getAttribute(name) !== value)
      live.setAttribute(name, value);
  const classes = [
    ...next.classList,
    ...[...live.classList].filter(
      (name) => pageClasses.includes(name) && !next.classList.contains(name),
    ),
  ].join(" ");
  if ((live.getAttribute("class") ?? "") !== classes)
    if (classes) live.setAttribute("class", classes);
    else live.removeAttribute("class");
}
// `parent`'s children made `nodes`, the ones it keeps not moved.
function reconcile(parent, nodes) {
  const keep = new Set(nodes);
  for (const node of [...parent.childNodes]) if (!keep.has(node)) node.remove();
  let cursor = parent.firstChild;
  for (const node of nodes)
    if (cursor === node) cursor = cursor.nextSibling;
    else parent.insertBefore(node, cursor);
}

// Where `after` differs from `before`, and where parsing it again starts:
// from block `first`, until a block starts at an old block's start moved
// by `delta`, at or after the end of the change.
export function planEdit(blocks, before, after, { limit = 0.6 } = {}) {
  if (before === after || !blocks.length) return null;
  const shortest = Math.min(before.length, after.length);
  let prefix = 0;
  while (
    prefix < shortest &&
    before.charCodeAt(prefix) === after.charCodeAt(prefix)
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    before.charCodeAt(before.length - 1 - suffix) ===
      after.charCodeAt(after.length - 1 - suffix)
  )
    suffix++;
  // Front matter changed, or taken further or less far.
  const front = frontMatterLength(before);
  if (front !== frontMatterLength(after) || prefix < front) return null;
  const delta = after.length - before.length,
    newEnd = after.length - suffix;
  // The last block starting at or before the change.
  let low = 0,
    high = blocks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (blocks[mid].from <= prefix) low = mid + 1;
    else high = mid;
  }
  let first = Math.max(0, low - 1);
  while (
    first > 0 &&
    (blocks[first - 1].endLine >= blocks[first].line ||
      blocks[first - 1].continues)
  )
    first--;
  const line = low ? blocks[first].line : 0,
    from = low ? blocks[first].from : 0;
  const starts = new Map(blocks.map((block, i) => [block.from, i]));
  const most = Math.max(20000, after.length * limit);
  return {
    first,
    line,
    delta,
    lines:
      countLines(after, prefix, newEnd) -
      countLines(before, prefix, before.length - suffix),
    // At the start of a block in the new text, past the change: the old
    // block that started there, if one did.
    stop: (offset) =>
      offset - from > most
        ? "abort"
        : offset >= newEnd && blocks[starts.get(offset - delta)],
    // The first old block kept after the change (the parse ended at `end`).
    last: (end) =>
      end >= after.length ? blocks.length : starts.get(end - delta),
  };
}
function countLines(text, from, to) {
  let count = 0;
  for (
    let at = text.indexOf("\n", from);
    at >= 0 && at < to;
    at = text.indexOf("\n", at + 1)
  )
    count++;
  return count;
}

export function createIncrementalRender({ cache }) {
  const debug = () => globalThis.__folioIncremental;
  let serial = 0;
  // After a whole render put in `container` (render-cache.js update): its
  // blocks, as the page holds them, kept with the cache entry (and dropped
  // with it).
  function remember(doc, text, result, container) {
    cache.patch(container, doc.id, {
      html: doc.html,
      bytes: doc.renderBytes,
      data: result.blocks && {
        text,
        blocks: result.blocks.map((block) => ({
          ...block,
          nodes: block.nodes.map(cache.live),
        })),
        formulas: result.formulas,
        settings: renderSettings(text),
        fileId: doc.fileId,
      },
    });
  }
  // A list or table changed in some items (a word formatted in one): the
  // old one stays on the page and only those items are put in anew; the
  // others keep their drawn formulas and their layout (moving them into the
  // new list would lay all of them out again), their positions moved. An
  // item renders the same from the same source in a list of the same kind
  // (tight or loose), a row in a table with the same head (its columns and
  // their alignment). True if `old` now renders as `block`.
  function changeInPlace(old, block, before, after) {
    const [a, b] = [old, block].map((x) => elements(x.nodes));
    if (
      a.length !== 1 ||
      b.length !== 1 ||
      old.nodes.length !== block.nodes.length ||
      old.type !== block.type ||
      old.fence !== block.fence
    )
      return false;
    const [live, next] = [a[0], b[0]];
    let table = null;
    if (/^[OU]L$/.test(live.tagName) && live.tagName === next.tagName) {
      const loose = (list) => Boolean(list.querySelector(":scope > li > p"));
      if (loose(live) !== loose(next)) return false;
    } else if (live.matches(".table-scroll") && next.matches(".table-scroll")) {
      const [s, t] = [live, next].map((el) =>
        el.querySelector(":scope > table"),
      );
      // A sorted table keeps its rows in its own order (table-sort.js).
      if (
        !s?.tHead ||
        !t?.tHead ||
        s.hasAttribute("data-view-sorted") ||
        s.tBodies.length !== 1 ||
        t.tBodies.length !== 1 ||
        before.slice(start(s), start(s.tBodies[0])) !==
          after.slice(start(t), start(t.tBodies[0]))
      )
        return false;
      table = [s, t];
    } else return false;
    // Known to the cache as the new one rendered (before its items move).
    cache.adoptAs(live, next);
    let parts = [[live, next]];
    if (table) {
      const [s, t] = table;
      // The head, as it was, moved; the widths chosen again.
      cache.shift(s.tHead, start(t.tHead) - start(s.tHead));
      tableChanged(s);
      sameAttributes(live, next);
      sameAttributes(s, t);
      parts = [[s.tBodies[0], t.tBodies[0]]];
    }
    const source = (text, item) =>
      item.nodeType === 1 && item.dataset.from && item.dataset.to
        ? text.slice(start(item), Number(item.dataset.to))
        : null;
    for (const [parent, model] of parts) {
      const pool = new Map(),
        texts = new Map();
      const keep = (map, key, node) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(node);
      };
      for (const node of parent.childNodes)
        if (node.nodeType !== 1) keep(texts, node.data, node);
        else if (source(before, node) !== null)
          keep(pool, source(before, node), node);
      const list = [...model.childNodes].map((node) => {
        if (node.nodeType !== 1) return texts.get(node.data)?.shift() ?? node;
        const key = source(after, node),
          kept = key === null ? null : pool.get(key)?.shift();
        if (!kept) return node;
        const delta = start(node) - start(kept);
        if (delta) cache.shift(kept, delta);
        return kept;
      });
      sameAttributes(parent, model);
      reconcile(parent, list);
    }
    return true;
  }
  function note(outcome) {
    const stats = debug();
    if (stats) (stats.log ??= []).push(outcome);
    return null;
  }
  // Puts `text` in place of the note shown in `container`, where only some
  // blocks changed. Returns what the note's render now is, or null (then
  // render it whole).
  function update(doc, text, container, { interactiveTasks = false } = {}) {
    const model = cache.data(doc.id);
    if (!model || model.text === text) return note({ result: "none" });
    if (
      model.settings !== renderSettings(model.text) ||
      model.fileId !== doc.fileId
    )
      return note({ result: "full", reason: "settings" });
    const plan = planEdit(model.blocks, model.text, text);
    if (!plan) return note({ result: "full", reason: "plan" });
    const rendered = renderBlocks(text, doc.fileId, {
      line: plan.line,
      stop: plan.stop,
      deferMath: true,
      interactiveTasks,
    });
    if (!rendered) return note({ result: "full", reason: "blocks" });
    const blocks = model.blocks,
      last = plan.last(rendered.end);
    if (last === undefined || last < plan.first)
      return note({ result: "full", reason: "align" });
    const removed = blocks.slice(plan.first, last),
      added = rendered.blocks;
    if (
      [...removed, ...added].some(
        (block) => block.heading || block.frontMatter || block.details,
      )
    )
      return note({ result: "full", reason: "structure" });
    const old = removed.flatMap((block) => block.nodes);
    // Where the new blocks go: in place of the old, or after the block
    // before them (its section's body), or first in the note.
    let parent, next;
    if (old.length) {
      parent = old[0].parentNode;
      next = old.at(-1).nextSibling;
    } else {
      const before = blocks
        .slice(0, plan.first)
        .findLast((block) => block.nodes.length)
        ?.nodes.at(-1);
      parent = before ? before.parentNode : container;
      next = before ? before.nextSibling : container.firstChild;
    }
    const focus = container.ownerDocument.activeElement;
    if (
      !parent ||
      !container.contains(parent) ||
      old.some((node) => node.parentNode !== parent) ||
      (focus && focus !== container && old.some((node) => node.contains(focus)))
    )
      return note({ result: "full", reason: "page" });

    const hydrate = doc.hydrate;
    for (const [key, formula] of rendered.formulas)
      model.formulas.set(key, formula);
    let nodes;
    if (
      removed.length === 1 &&
      added.length === 1 &&
      changeInPlace(removed[0], added[0], model.text, text)
    ) {
      added[0].nodes = nodes = old;
      if (hydrate) for (const node of elements(nodes)) hydrate(node);
    } else {
      nodes = added.flatMap((block) => block.nodes);
      cache.adopt(nodes);
      if (hydrate) for (const node of elements(nodes)) hydrate(node);
      for (const node of old) node.remove();
      const fragment = container.ownerDocument.createDocumentFragment();
      fragment.append(...nodes);
      parent.insertBefore(fragment, next?.parentNode === parent ? next : null);
    }

    // The blocks after: their positions in the source.
    const end = last < blocks.length ? blocks[last].from : model.text.length;
    const kept = blocks.slice(last).map((block) => {
      if (plan.delta)
        for (const node of block.nodes) cache.shift(node, plan.delta);
      return {
        ...block,
        from: block.from + plan.delta,
        to: block.to + plan.delta,
        line: block.line + plan.lines,
        endLine: block.endLine + plan.lines,
      };
    });
    // The sections around: how many blocks each holds.
    const more = elements(nodes).length - elements(old).length;
    if (more)
      for (
        let section = parent.closest?.(".note-section");
        section;
        section = section.parentElement?.closest(".note-section")
      ) {
        const count = Number(section.dataset.blockCount) + more;
        section.dataset.blockCount = String(count);
        const summary = section.firstElementChild?.querySelector(
          ":scope > .section-summary",
        );
        if (summary) summary.textContent = sectionSummary(count);
      }
    const sum = (list, key) => list.reduce((n, block) => n + block[key], 0);
    const formulas = sum(added, "formulas") - sum(removed, "formulas");
    const bytes =
      (doc.renderBytes ?? 0) +
      (sum(added, "size") - sum(removed, "size")) * 12 +
      formulas * 96 * 1024;
    const html = `<!-- incremental ${++serial} -->`;
    cache.patch(container, doc.id, {
      html,
      bytes,
      data: {
        ...model,
        text,
        blocks: [...blocks.slice(0, plan.first), ...added, ...kept],
      },
    });
    hydrate?.add?.(elements(nodes));
    note({
      result: "incremental",
      removed: removed.length,
      added: added.length,
      shifted: kept.length,
    });
    return {
      html,
      bytes,
      formulaCount: (doc.formulaCount ?? 0) + formulas,
      headings: (doc.headings || []).map((heading) =>
        heading.from >= end
          ? { ...heading, from: heading.from + plan.delta }
          : heading,
      ),
    };
  }
  // For tests (globalThis.__folioIncremental.verify): the page after a
  // render (`kind`: incremental, or full, which may keep nodes changed in
  // place before) against `fresh`, the same text rendered whole, and the
  // blocks kept against the page's.
  function verify(doc, container, fresh, kind) {
    const stats = debug();
    const page = comparable([...container.childNodes]),
      whole = comparable([...fresh.fragment.childNodes]);
    const leaves = [];
    (function walk(parent) {
      for (const node of parent.childNodes)
        if (node.nodeType === 1 && node.matches(".note-section, .section-body"))
          walk(node);
        else if (!(node.nodeType === 1 && node.matches(".section-rail")))
          leaves.push(node);
    })(container);
    const model = cache.data(doc.id),
      nodes = model ? model.blocks.flatMap((block) => block.nodes) : leaves;
    const problems = [];
    if (page !== whole) {
      let at = 0;
      while (page[at] === whole[at]) at++;
      problems.push({
        page: page.slice(Math.max(0, at - 200), at + 200),
        whole: whole.slice(Math.max(0, at - 200), at + 200),
      });
    }
    if (
      leaves.length !== nodes.length ||
      leaves.some((node, i) => node !== nodes[i])
    )
      problems.push({ blocks: "the kept blocks are not the page's" });
    if (
      JSON.stringify(doc.headings) !== JSON.stringify(fresh.headings) ||
      doc.formulaCount !== fresh.formulaCount
    )
      problems.push({ headings: doc.headings, formulas: doc.formulaCount });
    if (problems.length) (stats.mismatches ??= []).push({ kind, problems });
    stats.verified ??= {};
    stats.verified[kind] = (stats.verified[kind] ?? 0) + 1;
  }
  return { remember, update, verify };
}

// The page's own state, set after a note is rendered (drawn formulas and
// diagrams, folds, skipped blocks, table widths and sorting, backlink
// counts): left out when a page is compared with a fresh render.
const pageClasses = [
  "collapsed",
  "code-collapsed",
  "code-wrap",
  "has-backlinks",
  "link-broken",
  "section-hover",
  "section-focus",
  "reading-skip",
  "reading-columns",
  "diagram-host",
];
export function comparable(nodes, doc = document) {
  const box = doc.createElement("div");
  for (const node of nodes) box.append(node.cloneNode(true));
  for (const el of box.querySelectorAll(
    ".formula, .math-block, .backlink-badge, colgroup[data-reading-widths]",
  ))
    if (el.matches(".formula, .math-block")) el.replaceChildren();
    else el.remove();
  for (const el of box.querySelectorAll("pre[data-diagram-theme]"))
    el.replaceChildren();
  for (const el of box.querySelectorAll("*")) {
    for (const name of pageClasses) el.classList.remove(name);
    if (el.getAttribute("class") === "") el.removeAttribute("class");
    for (const name of [
      "data-broken",
      "data-selected-whole",
      "data-diagram-theme",
      "data-view-sorted",
      "aria-sort",
      "aria-expanded",
      "open",
    ])
      el.removeAttribute(name);
    if (
      el.matches("table, col, th, td, .table-scroll, .section-body") ||
      /contain-intrinsic/.test(el.getAttribute("style") || "")
    )
      el.removeAttribute("style");
  }
  return box.innerHTML;
}
