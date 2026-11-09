// The server's side of telling its assistant session what the owner did,
// without being asked: each running server is one session (sessions/ in the
// AI store), and when the owner finishes reviewing a proposal this session
// made, the server pushes a short event into the session. Claude Code takes such events from MCP servers it was started to
// listen to (its "channels", a research preview: started with
// `--dangerously-load-development-channels server:marklore`); other
// assistants never receive them and read the same state through the tools
// when asked. Events say what happened and where to read it, never a note's
// text.
import { watch, mkdirSync } from "node:fs";
import path from "node:path";
import { isLapsed, newId, SESSION_STALE } from "./ai-store.mjs";
export { SESSION_STALE };

// Assistants that take pushed events (Claude Code's channels).
export const pushes = (client) => /^claude-code\b/i.test(client);

// Told to Claude Code with the server's instructions.
export const CHANNEL_INSTRUCTIONS = `When Claude Code listens to this server, Marklore also tells you, as <channel source="marklore" event="proposal"> messages, when the owner finished reviewing one of your proposals: which edits were taken, and the owner's reasons. Act on them as on a message from the owner.`;

const HEARTBEAT = 60e3;
const same = (a, b) =>
  !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const quoted = (s, max = 300) =>
  JSON.stringify(s.length > max ? s.slice(0, max) + "…" : s);

// What a decided proposal tells the session that made it.
export function proposalEvent(p) {
  const head = `The owner finished reviewing your proposal ${p.id} on ${p.note} (${quoted(p.summary, 120)}):`;
  const lines = [];
  if (p.status === "failed")
    lines.push(
      `${head} it could not be applied${p.error ? ": " + p.error : "."}`,
    );
  else if (p.kind === "note")
    lines.push(
      `${head} the new note was ${p.status === "accepted" ? "created" : "rejected"}.`,
    );
  else {
    const results = p.results || p.edits.map(() => p.status);
    const which = (status) =>
      results.flatMap((r, i) => (r === status ? [i + 1] : []));
    const accepted = which("accepted"),
      rejected = which("rejected");
    lines.push(
      `${head} ${accepted.length ? `accepted edit ${accepted.join(", ")}` : "no edit accepted"}${rejected.length ? `; rejected edit ${rejected.join(", ")}` : ""}.`,
    );
    (p.reasons || []).forEach((reason, i) => {
      if (reason)
        lines.push(`Why edit ${i + 1} was rejected: ${quoted(reason)}`);
    });
    if (p.status === "accepted")
      lines.push(
        p.saved === false
          ? "The accepted edits are in the owner's unsaved draft, not on disk yet."
          : "The accepted edits are saved.",
      );
  }
  if (p.ownerNote) lines.push(`The owner's note: ${quoted(p.ownerNote)}`);
  return {
    content: lines.join("\n"),
    meta: { event: "proposal", proposal_id: p.id, status: p.status },
  };
}

export function createChannel({
  store,
  client,
  cwd = process.cwd(),
  pid = process.pid,
  notify,
  now = () => Date.now(),
  alive = () => true,
}) {
  const id = newId(),
    started = new Date(now()).toISOString(),
    canPush = pushes(client),
    told = new Set(),
    watchers = [];
  let timer = null,
    checking = null,
    again = false,
    active = started;

  const describe = () => ({
    id,
    client,
    cwd,
    folder: path.basename(cwd),
    pid,
    push: canPush,
    started,
    active,
  });
  const beat = () => store.writeSession(id, describe()).catch(() => {});

  // Looks for what to tell; one look at a time, again if asked meanwhile.
  async function check() {
    if (!canPush) return;
    if (checking) {
      again = true;
      return checking;
    }
    checking = (async () => {
      do {
        again = false;
        for (const p of await store.list())
          if (
            p.session === id &&
            !told.has(p.id) &&
            p.status !== "pending" &&
            p.status !== "withdrawn" &&
            !isLapsed(p)
          ) {
            told.add(p.id);
            notify(proposalEvent(p));
          }
      } while (again);
    })().finally(() => (checking = null));
    return checking;
  }

  return {
    id,
    canPush,
    // The session is known from the start; watching starts once the
    // assistant is ready for events.
    async start() {
      await beat();
      timer = setInterval(beat, HEARTBEAT);
      timer.unref?.();
      if (!canPush) return;
      let pending = null;
      for (const folder of [store.proposals])
        try {
          mkdirSync(folder, { recursive: true });
          const watcher = watch(folder, (_type, name) => {
            if (name && !/^[\w-]+\.json$/.test(String(name))) return;
            clearTimeout(pending);
            pending = setTimeout(() => check().catch(() => {}), 150);
          });
          watcher.on("error", () => watcher.close());
          // The server ends with its input, whatever it watches.
          watcher.unref?.();
          watchers.push(watcher);
        } catch {
          /* Events then wait for the next tool call. */
        }
      await check().catch(() => {});
    },
    // A tool call: the session is active, and a missed change is caught up.
    touch() {
      active = new Date(now()).toISOString();
      beat();
      check().catch(() => {});
    },
    check,
    async stop() {
      clearInterval(timer);
      watchers.forEach((w) => w.close());
      await store.removeSession(id).catch(() => {});
    },
  };
}
