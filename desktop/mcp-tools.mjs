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

export const INSTRUCTIONS = `Marklore is the owner's Markdown notebook. You can read the notes in the libraries (folders) the owner opened to AI in Marklore, and propose changes: edits to a note (propose_edit) or a new note (propose_note). Nothing changes until the owner previews the proposal in Marklore and accepts it, so do not claim a change is made until get_proposal says it was accepted. Name a note as "<library>/<path inside it>", as list_notes and search_notes return it. Edits replace exact text: read_note first and copy old_text from it exactly, with enough around it to occur once. Put related edits to one note in one proposal; list_proposals shows what is still waiting (look before proposing again), and withdraw_proposal takes back one of yours. When the owner rejects an edit, get_proposal may give their reason. The owner also marks passages in Marklore with what they want about each, and sends the marks to you in batches: get_marks reads them; make the changes asked for with propose_edit (one proposal per note), and answer the batch once with reply_marks (questions, or what you did and did not do).`;

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

const MAX_REPLY = 5000,
  MAX_REPLIES = 20;
// A batch of marks as the AI sees it: each mark placed in its note's current
// text; a note no longer open to AI shows only the owner's words.
async function batchShown(store, batch) {
  const texts = new Map();
  const marks = [];
  for (const [i, m] of batch.marks.entries()) {
    let found = null;
    try {
      found = await locate(store, m.file);
    } catch {
      /* Not open to AI any more, or gone. */
    }
    if (!found) {
      marks.push({
        n: i + 1,
        unavailable: "This note is not in a library open to AI.",
        text: m.text,
      });
      continue;
    }
    if (!texts.has(found.file))
      texts.set(
        found.file,
        await readNote(found.file).then(
          (c) => c.text,
          () => null,
        ),
      );
    const content = texts.get(found.file);
    const at = content == null ? null : locateAnchor(content, m);
    marks.push({
      n: i + 1,
      note: found.note,
      quote: m.quote.length > 500 ? m.quote.slice(0, 500) + "…" : m.quote,
      ...(at ? { line: lineAt(content, at.from) } : { anchor: "lost" }),
      text: m.text,
    });
  }
  return {
    batch_id: batch.id,
    sent_at: batch.created,
    status: batch.done ? "finished" : batch.status,
    marks,
    replies: batch.replies.map((r) => ({ from: r.by, text: r.text, at: r.at })),
  };
}

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

export function createTools({ store }) {
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
        },
        required: ["note", "summary", "edits"],
      },
      annotations: propose,
      async run({ note, summary, edits }, { client, session }) {
        text(summary, "summary", { max: 300 });
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
        const proposal = await store.create({
          kind: "edit",
          client,
          session,
          summary: summary.trim(),
          note: found.note,
          file: found.file,
          version: content.version,
          edits: edits.map((e) => ({
            old_text: e.old_text.replace(/\r\n?/g, "\n"),
            new_text: e.new_text.replace(/\r\n?/g, "\n"),
          })),
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
        "Marks the owner made on passages of notes in Marklore and sent to you, in batches: each mark is a passage (quote, with its line) and what the owner wants about it. With batch_id, that batch; without, every batch not finished yet, newest first. Make the changes asked for with propose_edit, one proposal per note; answer a batch once with reply_marks.",
      inputSchema: {
        type: "object",
        properties: { batch_id: { type: "string" } },
      },
      annotations: read,
      async run({ batch_id }, { client }) {
        let batches;
        if (batch_id !== undefined) {
          const one = await store
            .getBatch(text(batch_id, "batch_id", { max: 100 }))
            .catch(() => null);
          if (!one) fail(`There is no batch ${batch_id}.`);
          batches = [one];
        } else batches = (await store.listBatches()).filter((b) => !b.done);
        const out = [];
        for (const batch of batches) {
          // Read: the owner sees that the marks reached an assistant.
          if (batch.status === "sent" && !batch.done)
            await store
              .changeBatch(batch.id, (b) => {
                if (b.status !== "sent") return;
                b.status = "read";
                b.readBy = client;
                b.read = new Date().toISOString();
              })
              .catch(() => {});
          out.push(await batchShown(store, batch));
        }
        return out;
      },
    },
    {
      name: "reply_marks",
      title: "Answer a batch of marks",
      description:
        "Answer the owner's batch of marks (batch_id from get_marks) in one message: answers to their questions, and what you proposed or did not do, by mark number where it helps. The owner reads it in Marklore beside the batch. Changes themselves go in proposals (propose_edit).",
      inputSchema: {
        type: "object",
        properties: {
          batch_id: { type: "string" },
          text: { type: "string" },
        },
        required: ["batch_id", "text"],
      },
      annotations: propose,
      async run({ batch_id, text: body }, { client }) {
        text(batch_id, "batch_id", { max: 100 });
        text(body, "text", { max: MAX_REPLY });
        const next = await store
          .changeBatch(batch_id, (b) => {
            if (b.done) fail("The owner has finished this batch already.");
            if (b.replies.length >= MAX_REPLIES)
              fail(
                "This batch has enough replies; the owner can send more marks.",
              );
            b.replies.push({
              by: client,
              text: body.trim(),
              at: new Date().toISOString(),
            });
            b.status = "replied";
            return b;
          })
          .catch((error) => {
            if (/^There is no batch/.test(error.message))
              fail(`There is no batch ${batch_id}.`);
            throw error;
          });
        return batchShown(store, next);
      },
    },
  ];
}
