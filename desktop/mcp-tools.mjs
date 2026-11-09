// The tools of Marklore's MCP server (desktop/mcp.mjs). An AI reads notes in
// the libraries the owner opened to it (Settings → AI assistant) and proposes
// changes; nothing is written to a note until the owner accepts the proposal
// in Marklore. Texts here are for the AI, so they stay in English.
import fs from "node:fs/promises";
import path from "node:path";
import { realPath, within, decode, hash } from "./files.mjs";
import { NOTE, skippedName, isEnvironment } from "./scan-rules.mjs";
import { excludedBy } from "./excluded.mjs";
import { searchNotes } from "./note-search.mjs";
import { isLapsed } from "./ai-store.mjs";
import { locateAnchor, lineAt } from "./comment-anchors.mjs";
import { locateEdits, MAX_EDITS } from "./proposal-edits.mjs";

const MAX_READ = 4 * 1024 * 1024,
  MAX_WRITE = 1024 * 1024,
  MAX_WALK = 5000,
  MAX_SEARCH = 3000;

export const INSTRUCTIONS = `Marklore is the owner's Markdown notebook. You can read the notes in the libraries (folders) the owner opened to AI in Marklore, and propose changes: edits to a note (propose_edit) or a new note (propose_note). Nothing changes until the owner previews the proposal in Marklore and accepts it, so do not claim a change is made until get_proposal says it was accepted. Name a note as "<library>/<path inside it>", as list_notes and search_notes return it. Edits replace exact text: read_note first and copy old_text from it exactly, with enough around it to occur once. Put related edits to one note in one proposal; list_proposals shows what is still waiting (look before proposing again), and withdraw_proposal takes back one of yours. When the owner rejects an edit, get_proposal may give their reason. The owner also marks passages in Marklore with what they want about each. When they mention their marks, call get_marks; when they say "this", "here" or "the selected text", or refer to the note they are reading, call get_context (the note open in Marklore, the text selected there, and its marks). Make the changes a mark asks for with propose_edit, one proposal per note, passing the ids of the marks it answers; a mark you do not act on, or a question about it, gets a short reply_mark.`;

const fail = (message) => {
  throw Error(message);
};
const slash = (p) => p.split(path.sep).join("/");

// blank: spaces and line breaks count as text (an edit may remove blank lines).
function text(
  value,
  name,
  { max = 1000, required = true, blank = false } = {},
) {
  if (value === undefined && !required) return undefined;
  if (
    typeof value !== "string" ||
    (required && !(blank ? value : value.trim()))
  )
    fail(`${name} must be a non-empty string.`);
  if (value.length > max) fail(`${name} is longer than ${max} characters.`);
  return value;
}

// The libraries opened to AI, by the names the AI uses: a folder's name, made
// unique with a number when two have the same one.
async function libraries(store) {
  const access = await store.access(),
    out = [],
    used = new Set();
  for (const entry of access.libraries) {
    if (typeof entry?.path !== "string") continue;
    let real;
    try {
      real = await realPath(entry.path);
    } catch {
      continue; // Removed or offline.
    }
    const base = path.basename(real) || real;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    out.push({ name, path: real });
  }
  // Compared with real paths, as the libraries are (a short 8.3 name or a
  // link in a stored path would miss them otherwise).
  const excluded = await Promise.all(
    access.excluded
      .filter((p) => typeof p === "string")
      .map((p) => realPath(p).catch(() => p)),
  );
  return { list: out, excluded: excludedBy(excluded) };
}

function noOpenLibrary() {
  fail(
    "The owner has not opened any library to AI. In Marklore: Settings → AI assistant, tick the libraries an AI may read.",
  );
}

// Inside a library, by the library's own rules: no hidden or software
// folders, not in a folder left out of search, a Markdown note.
function allowed(library, file, excluded) {
  if (!within(library.path, file) || excluded(file)) return false;
  const parts = path.relative(library.path, file).split(path.sep);
  return !parts.some(skippedName) && NOTE.test(file);
}

// "<library>/<path>" or an absolute path, to the note's library and file.
// exists: false is for a new note, whose folder must exist already.
export async function locate(store, input, { exists = true } = {}) {
  const { list, excluded } = await libraries(store);
  if (!list.length) noOpenLibrary();
  const value = text(input, "note", { max: 1024 }).trim();
  let library, file;
  if (path.isAbsolute(value)) {
    file = path.resolve(value);
    library = list.find((lib) => within(lib.path, file));
  } else {
    const parts = value.split(/[\\/]+/).filter(Boolean);
    library = list.find(
      (lib) => lib.name.toLowerCase() === parts[0]?.toLowerCase(),
    );
    if (library) {
      if (parts.slice(1).some((part) => part === "." || part === ".."))
        fail(`${value}: use a path without "." or "..".`);
      file = path.join(library.path, ...parts.slice(1));
    }
  }
  if (!library)
    fail(
      `${value} is not in a library opened to AI. Open libraries: ${list.map((lib) => lib.name).join(", ")}.`,
    );
  if (exists) {
    try {
      file = await realPath(file);
    } catch {
      fail(`There is no note ${value}.`);
    }
  } else {
    let folder;
    try {
      folder = await realPath(path.dirname(file));
    } catch {
      fail(
        `The folder of ${value} does not exist; propose the note in an existing folder.`,
      );
    }
    file = path.join(folder, path.basename(file));
    if (
      await fs.stat(file).then(
        () => true,
        () => false,
      )
    )
      fail(`${value} exists already; use propose_edit to change it.`);
  }
  if (!allowed(library, file, excluded))
    fail(
      NOTE.test(file)
        ? `${value} is in a folder that is not open to AI (hidden, or left out of search).`
        : `${value} is not a Markdown note (.md, .markdown).`,
    );
  return {
    library,
    file,
    note: slash(path.join(library.name, path.relative(library.path, file))),
  };
}

async function readNote(file) {
  const stat = await fs.stat(file);
  if (stat.size > MAX_READ)
    fail(`The note is larger than ${MAX_READ / 1024 / 1024} MB.`);
  const bytes = await fs.readFile(file);
  return {
    text: decode(bytes).text,
    version: hash(bytes).slice(0, 16),
    modified: stat.mtime.toISOString(),
  };
}

// Every note of the libraries (or one), breadth first, as the library walks.
async function walk(list, excluded, limit) {
  const notes = [];
  for (const library of list) {
    const queue = [library.path];
    let folders = 0;
    while (queue.length && folders++ < MAX_WALK && notes.length < limit) {
      const folder = queue.shift();
      let entries;
      try {
        entries = await fs.readdir(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      if (folder !== library.path && isEnvironment(entries.map((e) => e.name)))
        continue;
      for (const entry of entries) {
        if (entry.isSymbolicLink() || skippedName(entry.name)) continue;
        const full = path.join(folder, entry.name);
        if (excluded(full)) continue;
        if (entry.isDirectory()) queue.push(full);
        else if (NOTE.test(entry.name) && notes.length < limit)
          notes.push({
            library,
            file: full,
            note: slash(
              path.join(library.name, path.relative(library.path, full)),
            ),
          });
      }
    }
  }
  return notes;
}

const MAX_REPLY = 2000,
  MAX_SELECTION = 4000;
const cap = (s, max) => (s.length > max ? s.slice(0, max) + "…" : s);
// A note's text by its real path, read once per call.
function noteTexts() {
  const texts = new Map();
  return async (file) => {
    if (!texts.has(file))
      texts.set(
        file,
        await readNote(file).then(
          (c) => c.text,
          () => null,
        ),
      );
    return texts.get(file);
  };
}
// Where a note named by the app is, if it is open to AI.
const found$ = (store, file) => locate(store, file).catch(() => null);
// A mark as the AI sees it: placed in its note's current text, with its
// state; on a note not open to AI, only the owner's words.
async function markShown(store, mark, found, textOf, pending) {
  const state =
    mark.proposal && pending.has(mark.proposal)
      ? "proposed"
      : mark.answer
        ? "replied"
        : "open";
  const extra = {
    // What was said about it before: the owner's words and your replies.
    ...(mark.earlier?.length
      ? {
          earlier: mark.earlier.map((e) => ({
            from: e.by === "owner" ? "owner" : "you",
            text: e.text,
          })),
        }
      : {}),
    status: state,
    ...(state === "proposed" ? { proposal_id: mark.proposal } : {}),
    ...(mark.answer ? { reply: mark.answer.text } : {}),
  };
  if (!found)
    return {
      mark_id: mark.id,
      unavailable: "This note is not in a library open to AI.",
      text: mark.text,
      ...extra,
    };
  const content = await textOf(found.file);
  const at = content == null ? null : locateAnchor(content, mark);
  return {
    mark_id: mark.id,
    note: found.note,
    quote: cap(mark.quote, 500),
    ...(at ? { line: lineAt(content, at.from) } : { anchor: "lost" }),
    text: mark.text,
    ...extra,
  };
}
// The marks the AI may work on: a background run (ai-runs.mjs) only its
// own; anyone else all but those a run still works on.
async function workable(store, run) {
  const runs = new Map((await store.listRuns()).map((r) => [r.id, r]));
  const out = [];
  for (const doc of await store.allMarks())
    for (const mark of doc.marks)
      if (
        run
          ? mark.run === run
          : !(mark.run && runs.get(mark.run)?.status === "running")
      )
        out.push({ file: doc.file, mark });
  return out;
}
const pendingIds = async (store) =>
  new Set(
    (await store.list())
      .filter((p) => p.status === "pending" && !isLapsed(p))
      .map((p) => p.id),
  );

const shown = (p, client) => ({
  proposal_id: p.id,
  kind: p.kind,
  note: p.note,
  summary: p.summary,
  client: p.client,
  created: p.created,
  status: isLapsed(p) ? "lapsed" : p.status,
  ...(p.decided ? { decided_at: p.decided } : {}),
  ...(p.status === "accepted" ? { saved: p.saved === true } : {}),
  ...(p.error ? { error: p.error } : {}),
  ...(p.kind === "edit" ? { edits: p.edits.length } : {}),
  ...(p.results ? { edit_results: p.results } : {}),
  ...(p.reasons?.some(Boolean) ? { edit_reasons: p.reasons } : {}),
  ...(p.ownerNote ? { owner_note: p.ownerNote } : {}),
  yours: p.client === client,
});

const reasons = {
  empty: () => "its old_text is empty",
  unchanged: () => "its new_text is the same as its old_text",
  missing: () =>
    "its old_text is not in the note (read_note gives the current text; copy it exactly)",
  ambiguous: (count) =>
    `its old_text occurs ${count} times; include more of the text around it so it occurs once`,
  overlap: () => "it overlaps another edit; join the two into one",
};

const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const propose = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export function createTools({ store, run = null }) {
  return [
    {
      name: "list_libraries",
      title: "List libraries",
      description:
        "The libraries (folders of notes) the owner opened to AI in Marklore. Only notes in these can be read or changed.",
      inputSchema: { type: "object", properties: {} },
      annotations: read,
      async run() {
        const { list } = await libraries(store);
        if (!list.length) noOpenLibrary();
        return list.map((lib) => ({ library: lib.name, folder: lib.path }));
      },
    },
    {
      name: "list_notes",
      title: "List notes",
      description:
        'The notes in the open libraries, or in one library or a folder of one ("<library>/<folder>"), by path. At most `limit` (default 200, up to 1000).',
      inputSchema: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: 'A library, or a folder in one: "<library>/<folder>".',
          },
          limit: { type: "integer", minimum: 1, maximum: 1000 },
        },
      },
      annotations: read,
      async run({ folder, limit = 200 }) {
        const { list, excluded } = await libraries(store);
        if (!list.length) noOpenLibrary();
        limit = Math.max(1, Math.min(1000, Number(limit) || 200));
        let roots = list,
          inside = null;
        if (folder !== undefined) {
          const parts = text(folder, "folder", { max: 1024 })
            .split(/[\\/]+/)
            .filter(Boolean);
          const library = list.find(
            (lib) => lib.name.toLowerCase() === parts[0]?.toLowerCase(),
          );
          if (!library)
            fail(
              `${folder} is not a library opened to AI. Open libraries: ${list.map((lib) => lib.name).join(", ")}.`,
            );
          if (parts.some((part) => part === "." || part === ".."))
            fail(`${folder}: use a path without "." or "..".`);
          roots = [library];
          inside = path.join(library.path, ...parts.slice(1));
        }
        const notes = (await walk(roots, excluded, MAX_WALK))
          .filter((n) => !inside || within(inside, n.file))
          .map((n) => n.note)
          .sort((a, b) => a.localeCompare(b));
        return {
          notes: notes.slice(0, limit),
          ...(notes.length > limit ? { more: notes.length - limit } : {}),
        };
      },
    },
    {
      name: "search_notes",
      title: "Search notes",
      description:
        'Notes in the open libraries whose name or text holds every word of the query ("quoted words" as one phrase; case is ignored), best first, with the lines found.',
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      annotations: read,
      async run({ query }) {
        text(query, "query", { max: 500 });
        const { list, excluded } = await libraries(store);
        if (!list.length) noOpenLibrary();
        const notes = [];
        for (const n of await walk(list, excluded, MAX_SEARCH))
          try {
            notes.push({
              name: path.basename(n.file),
              path: n.note,
              text: (await readNote(n.file)).text,
            });
          } catch {
            /* Too large, unreadable or not text. */
          }
        const found = searchNotes(notes, query, { maxNotes: 20, maxHits: 3 });
        return {
          total: found.total,
          results: found.results.map((r) => ({
            note: r.path,
            lines: r.hits.map((hit) => ({
              line: hit.line,
              text: hit.snippet.map(([part]) => part).join(""),
            })),
          })),
        };
      },
    },
    {
      name: "read_note",
      title: "Read a note",
      description:
        "A note's Markdown text as it is on disk, with its version. Copy old_text for propose_edit from this text.",
      inputSchema: {
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      },
      annotations: read,
      async run({ note }) {
        const found = await locate(store, note);
        const content = await readNote(found.file);
        return {
          note: found.note,
          version: content.version,
          modified: content.modified,
          text: content.text,
        };
      },
    },
    {
      name: "propose_edit",
      title: "Propose edits to a note",
      description: `Propose changes to one note: each edit replaces old_text (copied exactly from read_note, occurring once in the note) with new_text; an empty new_text deletes. Up to ${MAX_EDITS} edits. The whole list is checked now against the note on disk. Nothing changes until the owner accepts it in Marklore, where they preview the note with the changes marked.`,
      inputSchema: {
        type: "object",
        properties: {
          note: { type: "string" },
          summary: {
            type: "string",
            description: "One line for the owner: what and why.",
          },
          edits: {
            type: "array",
            minItems: 1,
            maxItems: MAX_EDITS,
            items: {
              type: "object",
              properties: {
                old_text: { type: "string" },
                new_text: { type: "string" },
              },
              required: ["old_text", "new_text"],
            },
          },
          marks: {
            type: "array",
            items: { type: "string" },
            description:
              "The ids of the owner's marks on this note that the proposal answers (get_marks); they show as answered in Marklore.",
          },
        },
        required: ["note", "summary", "edits"],
      },
      annotations: propose,
      async run({ note, summary, edits, marks }, { client, session }) {
        text(summary, "summary", { max: 300 });
        if (
          marks !== undefined &&
          (!Array.isArray(marks) ||
            marks.length > 100 ||
            marks.some((id) => typeof id !== "string" || id.length > 100))
        )
          fail("marks must be a list of mark ids from get_marks.");
        if (!Array.isArray(edits) || !edits.length || edits.length > MAX_EDITS)
          fail(`edits must hold 1 to ${MAX_EDITS} edits.`);
        edits = edits.map((edit, i) => ({
          old_text: text(edit?.old_text, `edits[${i}].old_text`, {
            max: MAX_WRITE,
            blank: true,
          }),
          new_text: text(edit?.new_text ?? "", `edits[${i}].new_text`, {
            max: MAX_WRITE,
            required: false,
          }),
        }));
        const found = await locate(store, note);
        const content = await readNote(found.file);
        const located = locateEdits(content.text, edits);
        if (located.error) {
          const { edit, reason, count } = located.error;
          fail(
            `Edit ${edit + 1}: ${reasons[reason](count)}. Nothing was proposed.`,
          );
        }
        // The marks answered must be on this note.
        if (marks?.length) {
          const here = (await store.marksOf(found.file)).marks.map((m) => m.id);
          const stray = marks.filter((id) => !here.includes(id));
          if (stray.length)
            fail(
              `${stray.join(", ")} ${stray.length === 1 ? "is not a mark" : "are not marks"} on ${found.note}. Nothing was proposed.`,
            );
        }
        const proposal = await store.create({
          kind: "edit",
          client,
          session,
          ...(run ? { run } : {}),
          ...(marks?.length ? { marks: [...new Set(marks)] } : {}),
          summary: summary.trim(),
          note: found.note,
          file: found.file,
          version: content.version,
          edits: edits.map((e) => ({
            old_text: e.old_text.replace(/\r\n?/g, "\n"),
            new_text: e.new_text.replace(/\r\n?/g, "\n"),
          })),
        });
        if (marks?.length)
          await store.changeMarks(found.file, (doc) => {
            for (const m of doc.marks)
              if (marks.includes(m.id)) m.proposal = proposal.id;
          });
        return {
          ...shown(proposal, client),
          next: "Nothing has changed yet. The owner previews and accepts or rejects it in Marklore; check with get_proposal.",
        };
      },
    },
    {
      name: "propose_note",
      title: "Propose a new note",
      description:
        'Propose a new note "<library>/<folder>/<name>.md" in an existing folder of an open library, with its Markdown text. Nothing is written until the owner accepts it in Marklore.',
      inputSchema: {
        type: "object",
        properties: {
          note: { type: "string" },
          summary: {
            type: "string",
            description: "One line for the owner: what and why.",
          },
          text: { type: "string" },
        },
        required: ["note", "summary", "text"],
      },
      annotations: propose,
      async run({ note, summary, text: content }, { client, session }) {
        text(summary, "summary", { max: 300 });
        text(content, "text", { max: MAX_WRITE });
        const found = await locate(store, note, { exists: false });
        const proposal = await store.create({
          kind: "note",
          client,
          session,
          summary: summary.trim(),
          note: found.note,
          file: found.file,
          text: content.replace(/\r\n?/g, "\n"),
        });
        return {
          ...shown(proposal, client),
          next: "Nothing is written yet. The owner previews and accepts or rejects it in Marklore; check with get_proposal.",
        };
      },
    },
    {
      name: "list_proposals",
      title: "List proposals",
      description:
        "Proposals still waiting for the owner, oldest first, from any AI, each with whether it is yours. Look here before proposing again, so the owner is not asked twice. With include_decided, those decided in the last month follow, newest first.",
      inputSchema: {
        type: "object",
        properties: { include_decided: { type: "boolean" } },
      },
      annotations: read,
      async run({ include_decided }, { client }) {
        const all = await store.list();
        const waiting = all.filter(
          (p) => p.status === "pending" && !isLapsed(p),
        );
        const decided = include_decided
          ? all
              .filter((p) => !waiting.includes(p))
              .sort((a, b) =>
                (b.decided || b.created).localeCompare(a.decided || a.created),
              )
          : [];
        return [...waiting, ...decided].map((p) => shown(p, client));
      },
    },
    {
      name: "get_proposal",
      title: "Check a proposal",
      description:
        'Whether a proposal is still waiting (pending), or was accepted, rejected, withdrawn, failed or lapsed (two weeks without a decision). "saved": false means the owner accepted it into a note with unsaved changes of their own, so it is not on disk until they save. The owner may decide an edit proposal edit by edit: "edit_results" then gives the decision on each edit (accepted, rejected or pending, in the order of your edits), and the proposal counts as accepted when any edit was. "edit_reasons" gives the reason the owner wrote for a rejected edit, if any, and "owner_note" their note on the whole proposal.',
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      annotations: read,
      async run({ id }, { client }) {
        const p = await store.get(text(id, "id", { max: 100 }));
        if (!p)
          fail(
            `There is no proposal ${id} (decided ones are kept for a month).`,
          );
        return shown(p, client);
      },
    },
    {
      name: "withdraw_proposal",
      title: "Withdraw a proposal",
      description:
        "Take back one of your own proposals that is still waiting, for example one made with a mistake: it leaves the owner's list. To replace one, withdraw it and propose again.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async run({ id }, { client }) {
        const p = await store.get(text(id, "id", { max: 100 }));
        if (!p) fail(`There is no proposal ${id}.`);
        if (p.client !== client)
          fail(
            `Proposal ${id} was made by ${p.client}; only it can withdraw it.`,
          );
        const next = await store.decide(id, () => ({ status: "withdrawn" }));
        return shown(next, client);
      },
    },
    {
      name: "get_marks",
      title: "Read the owner's marks",
      description:
        "The owner's marks in Marklore: each a passage of a note (quote, with its line) and what the owner wants about it, with its status (open; proposed: a proposal of yours answers it and waits for the owner; replied: you answered it). With note, only that note's. Make the changes asked for with propose_edit, one proposal per note, passing the mark ids; answer a mark you do not act on with reply_mark.",
      inputSchema: {
        type: "object",
        properties: { note: { type: "string" } },
      },
      annotations: read,
      async run({ note }) {
        const only = note === undefined ? null : await locate(store, note);
        const textOf = noteTexts(),
          pending = await pendingIds(store),
          marks = [];
        for (const { file, mark } of await workable(store, run)) {
          const found = await found$(store, file);
          if (only && found?.file !== only.file) continue;
          marks.push(await markShown(store, mark, found, textOf, pending));
        }
        return {
          marks,
          ...(marks.length
            ? {}
            : { note: "The owner has no marks for you now." }),
        };
      },
    },
    {
      name: "get_context",
      title: "What the owner is looking at",
      description:
        'The note open in Marklore now, the text the owner selected in it (if any), and the marks on that note. Call it when the owner says "this", "here", "the selected text", or refers to what they are reading.',
      inputSchema: { type: "object", properties: {} },
      annotations: read,
      async run() {
        const context = await store.readContext();
        if (!context?.file && !context?.closed)
          return { open_note: null, note: "No note is open in Marklore." };
        const found = context.file && (await found$(store, context.file));
        if (!found)
          return {
            open_note: null,
            note: "The note open in Marklore is not in a library open to AI.",
          };
        const textOf = noteTexts(),
          content = await textOf(found.file),
          pending = await pendingIds(store);
        let selection = null;
        const chosen = context.selection?.text;
        if (typeof chosen === "string" && chosen.trim() && content != null) {
          const from = Number.isInteger(context.selection.from)
            ? context.selection.from
            : -1;
          const at =
            content.slice(from, from + chosen.length) === chosen
              ? from
              : content.indexOf(chosen);
          selection = {
            text: cap(chosen, MAX_SELECTION),
            ...(at >= 0 ? { line: lineAt(content, at) } : {}),
          };
        }
        const marks = [];
        for (const { file, mark } of await workable(store, run)) {
          const there = await found$(store, file);
          if (there?.file === found.file)
            marks.push(await markShown(store, mark, there, textOf, pending));
        }
        return { open_note: found.note, selection, marks };
      },
    },
    {
      name: "reply_mark",
      title: "Answer a mark",
      description:
        "Answer one of the owner's marks (mark_id from get_marks) in a few sentences: a question back, or why you did not change anything. The owner reads it beside the mark in Marklore. Changes themselves go in proposals (propose_edit with the mark ids).",
      inputSchema: {
        type: "object",
        properties: {
          mark_id: { type: "string" },
          text: { type: "string" },
        },
        required: ["mark_id", "text"],
      },
      annotations: propose,
      async run({ mark_id, text: body }, { client }) {
        text(mark_id, "mark_id", { max: 100 });
        text(body, "text", { max: MAX_REPLY });
        const target = (await workable(store, run)).find(
          (x) => x.mark.id === mark_id,
        );
        if (!target) fail(`There is no mark ${mark_id} for you.`);
        const at = new Date().toISOString();
        const done = await store.changeMarks(target.file, (doc) => {
          const mark = doc.marks.find((m) => m.id === mark_id);
          if (!mark) return false;
          mark.answer = { by: client, text: body.trim(), at };
          return true;
        });
        if (!done) fail(`There is no mark ${mark_id} for you.`);
        return { mark_id, status: "replied" };
      },
    },
  ];
}
