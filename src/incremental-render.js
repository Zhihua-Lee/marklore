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
  parseBlocks,
  renderBlocks,
  renderMarkdown,
  renderParts,
  renderSettings,
  sectionSummary,
} from "./markdown.js";
import { tableChanged } from "./table-layout.js";

const elements = (nodes) => nodes.filter((node) => node.nodeType === 1);
// Elements with what links lead to or show (backlinks.js).
const linkedSelector = "[id], a[href], .backlink-badge, .has-backlinks";
const linked = (list) =>
  list.some(
    (el) => el.matches(linkedSelector) || el.querySelector(linkedSelector),
  );
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
    // The change: from `prefix` to `oldEnd` before, to `newEnd` after.
    prefix,
    oldEnd: before.length - suffix,
    newEnd,
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

// Which items of list (or table) block `old`, its items over `ranges` of
// `before` (a table's head over `head`), an edit renders again, now that
// `after` parsed (parseBlocks) from where `plan` (planEdit) starts:
// { first, after }, the items before and after those kept; or why the
// whole block is rendered again. The list parses again as it did but in
// those items: its other items over the same source (moved by the edit
// after it), as tight or loose as before (a paragraph in a tight list shows
// as text, in a loose one as a paragraph); a table's head the same. The
// items rendered again have no heading or <details>, and HTML in them closes
// all it opens, before the edit as after; fenced code opened in them closes
// there too (a pipe in a formula is read as the fences around it decide,
// markdown.js).
// The blocks parsed again before it (from `plan.first`, when a block before
// could have run on into it) must be the old ones, over the same source.
export function planParts(
  blocks,
  index,
  ranges,
  head,
  parsed,
  plan,
  before,
  after,
) {
  const old = blocks[index],
    at = index - plan.first,
    found = parsed.blocks[at];
  if (
    at < 0 ||
    parsed.blocks.length !== at + 1 ||
    plan.last(parsed.end) !== index + 1 ||
    parsed.blocks
      .slice(0, at)
      .some(
        (block, k) =>
          block.type !== blocks[plan.first + k].type ||
          block.from !== blocks[plan.first + k].from ||
          block.to !== blocks[plan.first + k].to,
      ) ||
    found.type !== old.type ||
    found.from !== old.from ||
    !found.parts ||
    plan.prefix < old.from ||
    plan.oldEnd > old.to
  )
    return "blocks";
  // A line break that would keep the note whole (splitBlocks).
  if (/[\r\0]/.test(after.slice(plan.prefix, plan.newEnd))) return "text";
  if (
    head &&
    (found.body === undefined ||
      before.slice(head[0], head[1]) !== after.slice(found.from, found.body))
  )
    return "head";
  if (ranges.length !== old.parts.length) return "page";
  const fresh = found.parts;
  let first = 0;
  while (
    first < ranges.length &&
    first < fresh.length &&
    ranges[first][1] <= plan.prefix &&
    ranges[first][0] === fresh[first].from &&
    ranges[first][1] === fresh[first].to
  )
    first++;
  let kept = 0;
  while (kept < ranges.length - first && kept < fresh.length - first) {
    const [from, to] = ranges[ranges.length - 1 - kept],
      part = fresh[fresh.length - 1 - kept];
    if (
      from < plan.oldEnd ||
      part.from !== from + plan.delta ||
      part.to !== to + plan.delta
    )
      break;
    kept++;
  }
  if (first === ranges.length - kept && first === fresh.length - kept)
    return "none";
  if (old.parts.slice(first, ranges.length - kept).some((part) => !part.alone))
    return "html";
  if (
    old.tight !== undefined &&
    old.tight !== null &&
    found.tight !== null &&
    old.tight !== found.tight
  )
    return "tight";
  const lineEnd = (source, at) => {
    const end = source.indexOf("\n", at);
    return end < 0 ? source.length : end;
  };
  if (
    parsed.fenceAfter(before, plan.prefix, lineEnd(before, plan.oldEnd)) !==
    parsed.fenceAfter(after, plan.prefix, lineEnd(after, plan.newEnd))
  )
    return "fence";
  return { first, after: kept, at };
}
// The block an edit is in (from `plan.first` on), or -1.
export function partsTarget(blocks, plan) {
  let index = -1;
  for (let k = plan.first; k < blocks.length; k++)
    if (blocks[k].from <= plan.prefix) index = k;
    else break;
  return index >= 0 && plan.oldEnd <= blocks[index].to ? index : -1;
}
export function createIncrementalRender({ cache }) {
  const debug = () => globalThis.__folioIncremental;
  let serial = 0;
  // After a whole render put in `container` (render-cache.js update): its
  // blocks, as the page holds them, kept with the cache entry (and dropped
  // with it). `changed` false: the page was left as it was (the same HTML),
  // not with the render's nodes; its blocks are those kept already, if they
  // were of this text (else none).
  function remember(doc, text, result, container, changed = true) {
    if (!changed) {
      if (cache.data(doc.id)?.text !== text)
        cache.patch(container, doc.id, {
          html: doc.html,
          bytes: doc.renderBytes,
          data: undefined,
        });
      return;
    }
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
  // `before(element)`: called before the page changes, with the first
  // element that may change place or size (none: unknown).
  function update(
    doc,
    text,
    container,
    { interactiveTasks = false, before = null } = {},
  ) {
    const model = cache.data(doc.id);
    if (!model || model.text === text) return note({ result: "none" });
    if (
      model.settings !== renderSettings(model.text) ||
      model.fileId !== doc.fileId
    )
      return note({ result: "full", reason: "settings" });
    const plan = planEdit(model.blocks, model.text, text);
    if (!plan) return note({ result: "full", reason: "plan" });
    const parsed = parseBlocks(text, {
      line: plan.line,
      stop: plan.stop,
      deferMath: true,
    });
    if (!parsed) return note({ result: "full", reason: "blocks" });
    // Some items of one list or rows of one table, if only they changed.
    const parts = changeParts(doc, text, container, model, plan, parsed, {
      interactiveTasks,
      before,
    });
    if (typeof parts !== "string") return parts;
    const rendered = renderBlocks(text, doc.fileId, {
      parsed,
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
    // Whether the note has a title (its first block a level-one heading,
    // markdown.js markTitle) may change: blocks put before its heading, or
    // those before a heading taken away.
    const firstBody = blocks.findIndex((block) => !block.frontMatter);
    if (
      firstBody >= 0 &&
      plan.first <= firstBody &&
      (blocks[firstBody].heading || (!added.length && blocks[last]?.heading))
    )
      return note({ result: "full", reason: "title" });
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

    const quiet = !linked(elements(old));
    // The first element that may change place or size (changeParts).
    before?.(
      elements(old)[0] ??
        (next?.nodeType === 1 ? next : next?.nextElementSibling),
    );
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
    return finish(doc, text, container, model, plan, {
      last,
      removed,
      added,
      fresh: elements(nodes),
      outcome: { level: "blocks", parts },
      quiet: quiet && !linked(elements(nodes)),
    });
  }
  // The note's render after blocks `plan.first` to `last` were put anew as
  // `added` (`fresh`: the elements whose formulas are to be drawn): the
  // blocks after moved, and what the note now is.
  function finish(
    doc,
    text,
    container,
    model,
    plan,
    { last, removed, added, fresh, outcome, quiet },
  ) {
    const blocks = model.blocks;
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
    doc.hydrate?.add?.(fresh);
    note({
      result: "incremental",
      ...outcome,
      removed: removed.length,
      added: added.length,
      shifted: kept.length,
    });
    return {
      html,
      bytes,
      // No anchor, link or backlink count among what changed: links into
      // and out of the note stay as they are (backlinks.js).
      quiet,
      formulaCount: (doc.formulaCount ?? 0) + formulas,
      headings: (doc.headings || []).map((heading) =>
        heading.from >= end
          ? { ...heading, from: heading.from + plan.delta }
          : heading,
      ),
    };
  }
  // An edit inside one list or table: only the items (rows) it touched are
  // rendered again and put in place of the old ones (planParts), the list
  // (table) and its other items staying on the page, those after it moved.
  // Besides: the list's kind, start and task boxes the same; a table not
  // sorted on the page, no merged cells; the focus not in the items.
  // Returns what the note's render now is, or why not (a string; then the
  // block it is in is rendered again).
  function changeParts(doc, text, container, model, plan, parsed, options) {
    const index = partsTarget(model.blocks, plan),
      old = model.blocks[index];
    if (!old?.parts) return "kind";
    const list = old.type !== "table_open";
    const [element, ...others] = elements(old.nodes);
    if (!element || others.length) return "page";
    let table = null,
      host = element;
    if (!list) {
      table = element.matches(".table-scroll")
        ? element.querySelector(":scope > table")
        : null;
      // A sorted table keeps its rows in its own order (table-sort.js).
      if (
        !table?.tHead ||
        table.hasAttribute("data-view-sorted") ||
        table.tBodies.length !== 1
      )
        return "table";
      host = table.tBodies[0];
    }
    const items = [...host.children].filter(
      (item) => item.tagName === (list ? "LI" : "TR"),
    );
    const ranges = items.map((item) => [start(item), Number(item.dataset.to)]);
    const choice = planParts(
      model.blocks,
      index,
      ranges,
      list ? null : [start(table), start(host)],
      parsed,
      plan,
      model.text,
      text,
    );
    if (typeof choice === "string") return choice;
    const { first: i, after: j, at } = choice,
      found = parsed.blocks[at];
    if (list && element.tagName !== found.tag.toUpperCase()) return "page";
    const gone = items.slice(i, items.length - j);
    // Rows that keep a table from being sorted (table-sort.js).
    const unsortable = "table, [colspan], [rowspan]";
    if (!list && gone.some((row) => row.querySelector(unsortable)))
      return "table";
    const focus = container.ownerDocument.activeElement;
    if (
      focus &&
      focus !== container &&
      gone.some((item) => item.contains(focus))
    )
      return "focus";
    const fresh = found.parts;
    const rendered = renderParts(
      text,
      parsed,
      at,
      i,
      fresh.length - j,
      doc.fileId,
      options,
    );
    if (!rendered) return "render";
    const nodes = rendered.nodes,
      after = items.slice(items.length - j);
    // The list's or table's own attributes: the same ones, their values
    // (its end, a list's start) taken from the new render.
    const names = (el) =>
      [...el.attributes]
        .map((attribute) => attribute.name)
        .filter((name) => name !== "class" && name !== "style")
        .join(" ");
    const pairs = list
      ? [[element, rendered.container]]
      : [
          [table, rendered.container],
          [host, rendered.body],
        ];
    if (pairs.some(([live, next]) => names(live) !== names(next)))
      return "attributes";
    const task = (item) => item.classList.contains("task-list-item");
    if (
      list &&
      element.classList.contains("contains-task-list") !==
        [...items.slice(0, i), ...nodes, ...after].some(task)
    )
      return "tasks";
    if (!list && nodes.some((row) => row.querySelector(unsortable)))
      return "table";

    // The first element that may change place or size: the reading
    // position is measured if it is above the reading line (app.js). A
    // table's widths are chosen again, for all its rows.
    options.before?.(table ?? gone[0] ?? after[0]);
    const quiet = !linked(gone) && !linked(nodes);
    for (const [key, formula] of rendered.formulas)
      model.formulas.set(key, formula);
    const hydrate = doc.hydrate;
    if (hydrate) for (const node of nodes) hydrate(node);
    // Each item with the line break after it, as the whole list has them.
    const withBreak = (item) =>
      item.nextSibling?.nodeType === 3 ? [item, item.nextSibling] : [item];
    const incoming = nodes.flatMap(withBreak),
      outgoing = gone.flatMap(withBreak);
    const fragment = container.ownerDocument.createDocumentFragment();
    fragment.append(...incoming);
    host.insertBefore(fragment, gone[0] ?? after[0] ?? null);
    for (const node of outgoing) node.remove();
    for (const [live, next] of pairs)
      for (const { name, value } of next.attributes)
        if (
          name !== "class" &&
          name !== "style" &&
          live.getAttribute(name) !== value
        )
          live.setAttribute(name, value);
    if (plan.delta) for (const item of after) cache.shift(item, plan.delta);
    // The widths chosen again (table-layout.js).
    if (table) tableChanged(table);
    // Known to the cache as the block its source now renders, if it is
    // asked for (a whole render of the note while the block is shown).
    const source = text.slice(old.from, old.to + plan.delta),
      settings = renderSettings(source),
      { fileId } = doc;
    cache.stale(element, () => {
      if (old.fence || renderSettings(source) !== settings) return null;
      const [whole, ...rest] = elements([
        ...renderMarkdown(source, fileId, {
          deferMath: true,
          interactiveTasks: options.interactiveTasks,
        }).fragment.childNodes,
      ]);
      return whole && !rest.length ? whole.outerHTML : null;
    });

    const length = ([from, to]) => to - from;
    const replaced = ranges
      .slice(i, items.length - j)
      .reduce((n, range) => n + length(range), 0);
    const block = {
      ...old,
      to: old.to + plan.delta,
      endLine: old.endLine + plan.lines,
      parts: [
        ...old.parts.slice(0, i),
        ...rendered.parts,
        ...old.parts.slice(items.length - j),
      ],
      tight: list ? found.tight : old.tight,
      continues: old.continues || rendered.opens,
      formulas:
        old.formulas +
        rendered.parts.reduce((n, part) => n + part.formulas, 0) -
        old.parts
          .slice(i, items.length - j)
          .reduce((n, part) => n + part.formulas, 0),
      // Estimated: the share of the items' source in the block's.
      size: Math.max(
        0,
        old.size +
          rendered.size -
          Math.round(
            (old.size * replaced) / Math.max(1, length([old.from, old.to])),
          ),
      ),
    };
    return finish(
      doc,
      text,
      container,
      model,
      { ...plan, first: index },
      {
        last: index + 1,
        removed: [old],
        added: [block],
        fresh: nodes,
        quiet,
        outcome: {
          level: list ? "items" : "rows",
          replaced: gone.length,
          put: nodes.length,
        },
      },
    );
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
    ) {
      const at = leaves.findIndex((node, i) => node !== nodes[i]);
      const name = (node) =>
        node && [
          node.nodeName,
          node.isConnected,
          node.textContent.slice(0, 30),
        ];
      problems.push({
        blocks: "the kept blocks are not the page's",
        at,
        page: name(leaves[at]),
        kept: name(nodes[at]),
        counts: [leaves.length, nodes.length],
      });
    }
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
// The attributes the page sets on rendered elements. A mark the page puts
// on a selected formula belongs here (or in pageClasses, if a class).
const pageAttributes = [
  "data-broken",
  "data-diagram-theme",
  "data-view-sorted",
  "aria-sort",
  "aria-expanded",
  "open",
  // A formula the selection covers (formula-selection.js).
  "data-selected-whole",
  // An image's recorded density, set once known (image-density.js).
  "srcset",
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
    for (const name of pageAttributes) el.removeAttribute(name);
    if (
      el.matches("table, col, th, td, .table-scroll, .section-body") ||
      /contain-intrinsic/.test(el.getAttribute("style") || "")
    )
      el.removeAttribute("style");
  }
  return box.innerHTML;
}
