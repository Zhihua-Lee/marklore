// Background runs: the owner hands their open marks to an AI that works on
// them while they do something else. The app starts Claude Code once, in
// print mode, with Marklore's MCP server as its only tools (reading notes,
// proposing changes, answering marks) and nothing else: no files, no
// commands, none of the owner's own settings or hooks, and every permission
// that would need asking denied. The run claims its marks (others see them
// as being worked on), its proposals come back to be reviewed like any, and
// it ends by itself; the owner can stop it. A run left running when
// Marklore closed is ended on the next start.
import { spawn as spawnChild } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { isLapsed } from "./ai-store.mjs";
import { locate } from "./mcp-tools.mjs";
import { t } from "./i18n.mjs";

export const RUN_TIMEOUT = 15 * 60e3;
const PROMPT = `The owner of a Marklore notebook handed you the marks they made on their notes, to work on while they are away; they cannot answer questions now. Call get_marks. For each note, read_note, then make the changes its marks ask for in one propose_edit, copying old_text exactly and passing the ids of the marks it answers. A mark you cannot or should not act on, or one that needs the owner's decision, gets a short reply_mark saying why or what you need. Change nothing a mark does not ask for. Write replies and summaries in the language the owner wrote the marks in. End with one or two sentences on what you proposed.`;

const ERROR_TAIL = 500;
const tail = (s) => s.trim().slice(-ERROR_TAIL);
// Claude Code not signed in, or its sign-in run out: what to do about it.
const plain = (error) =>
  /authenticat|log ?in|oauth|api key|credential/i.test(error)
    ? t(
        "Claude Code 没有登录或登录已过期：在终端里运行一次 claude 并登录，再试",
      )
    : error;

export function createRuns({
  store,
  setup,
  dataFolder,
  findClaude,
  notify = () => {},
  spawn = spawnChild,
  timeout = RUN_TIMEOUT,
}) {
  // Run id -> the child working on it.
  const children = new Map();

  // The owner's marks a run can take: not answered, not waiting on a
  // proposal, not taken by another run, on a note open to AI.
  async function openMarks() {
    const pending = new Set(
      (await store.list())
        .filter((p) => p.status === "pending" && !isLapsed(p))
        .map((p) => p.id),
    );
    const running = new Set(
      (await store.listRuns())
        .filter((r) => r.status === "running")
        .map((r) => r.id),
    );
    const out = [],
      closed = [];
    for (const doc of await store.allMarks())
      for (const m of doc.marks) {
        if (m.answer || (m.proposal && pending.has(m.proposal))) continue;
        if (m.run && running.has(m.run)) continue;
        const open = await locate(store, doc.file).then(
          () => true,
          () => false,
        );
        (open ? out : closed).push({ id: m.id, file: doc.file });
      }
    return { marks: out, closed };
  }

  // The run's marks go back to the owner (what the AI noted on them stays).
  async function release(run) {
    for (const file of new Set(run.marks.map((m) => m.file)))
      await store
        .changeMarks(file, (doc) => {
          for (const m of doc.marks) if (m.run === run.id) delete m.run;
        })
        .catch(() => {});
  }
  async function end(id, fields) {
    // Only a run there is: the id names the folder that goes.
    if (!(await store.getRun(id).catch(() => null)))
      throw Error(`There is no run ${id}.`);
    // Its folder goes first: once the run reads as over, nothing is left.
    await fs
      .rm(path.join(store.runs, id), { recursive: true, force: true })
      .catch(() => {});
    const run = await store.changeRun(id, (r) => {
      if (r.status !== "running") return null;
      Object.assign(r, fields, { finished: new Date().toISOString() });
      return r;
    });
    if (run) await release(run);
    notify();
    return run;
  }

  async function start() {
    if ((await store.listRuns()).some((r) => r.status === "running"))
      throw Error(t("后台 AI 正在处理标记"));
    const claude = await findClaude();
    if (!claude) throw Error(t("没有找到 Claude Code：先安装它，并登录一次"));
    const { marks, closed } = await openMarks();
    if (!marks.length)
      throw Error(
        closed.length
          ? t("这些标记所在的笔记没有开放给 AI（设置 → AI 助手）")
          : t("没有要交给 AI 的标记"),
      );
    const run = await store.createRun({ client: "claude-code", marks });
    for (const file of new Set(marks.map((m) => m.file)))
      await store.changeMarks(file, (doc) => {
        const ids = new Set(marks.map((m) => m.id));
        for (const m of doc.marks) if (ids.has(m.id)) m.run = run.id;
      });
    // Its own folder to start in (nothing there for it to read), and the
    // server it may use: Marklore's, told which run it serves.
    const folder = path.join(store.runs, run.id);
    await fs.mkdir(folder, { recursive: true });
    const config = path.join(folder, "mcp.json");
    await fs.writeFile(
      config,
      JSON.stringify({
        mcpServers: {
          marklore: {
            type: "stdio",
            command: setup.command,
            args: setup.args,
            env: {
              ...setup.env,
              MARKLORE_RUN: run.id,
              FOLIO_DATA_DIR: dataFolder,
            },
          },
        },
      }),
    );
    const args = [
      ...claude.args,
      "-p",
      PROMPT,
      "--output-format",
      "json",
      "--no-session-persistence",
      // No built-in tools, no settings files (so none of the owner's hooks),
      // only Marklore's server, and nothing that would need asking.
      "--restricted",
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      config,
      "--allowedTools",
      "mcp__marklore",
      "--permission-mode",
      "dontAsk",
    ];
    let child;
    try {
      const env = { ...process.env, ...claude.env };
      if (!claude.env.ELECTRON_RUN_AS_NODE) delete env.ELECTRON_RUN_AS_NODE;
      child = spawn(claude.command, args, {
        cwd: folder,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      await end(run.id, { status: "failed", error: error.message });
      throw Error(t("后台 AI 没能启动：{reason}", { reason: error.message }));
    }
    children.set(run.id, child);
    // Listening from the start: a child that fails or ends at once is heard.
    let out = "",
      err = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => (out = (out + d).slice(-200000)));
    child.stderr?.on("data", (d) => (err = (err + d).slice(-20000)));
    const timer = setTimeout(() => {
      child.timedOut = true;
      child.kill();
    }, timeout);
    timer.unref?.();
    const finished = (code, failure) => {
      clearTimeout(timer);
      if (!children.has(run.id)) return;
      children.delete(run.id);
      let result = null;
      try {
        result = JSON.parse(out.trim().split("\n").at(-1));
      } catch {
        /* Not the JSON it prints: an error before it started. */
      }
      const ok = code === 0 && result && !result.is_error;
      end(
        run.id,
        child.stopped
          ? { status: "stopped" }
          : child.timedOut
            ? { status: "failed", error: t("超过 15 分钟，已停止") }
            : ok
              ? {
                  status: "done",
                  result:
                    typeof result.result === "string"
                      ? result.result.slice(0, 2000)
                      : "",
                }
              : {
                  status: "failed",
                  error: plain(
                    failure?.message ||
                      (typeof result?.result === "string" &&
                        tail(result.result)) ||
                      tail(err) ||
                      t("退出代码 {code}", { code }),
                  ),
                },
      ).catch(() => {});
    };
    child.on("error", (error) => finished(null, error));
    child.on("close", (code) => finished(code));
    await store
      .changeRun(run.id, (r) => {
        if (r.status !== "running") return null;
        r.pid = child.pid ?? null;
        return r;
      })
      .catch(() => {});
    notify();
    return run.id;
  }

  return {
    start,
    // The owner stops it: its marks are theirs again.
    async stop(id) {
      const child = children.get(id);
      if (child && child.exitCode === null && !child.killed) {
        child.stopped = true;
        child.kill();
      } else {
        children.delete(id);
        await end(id, { status: "stopped" });
      }
    },
    // A finished run's note is put away.
    async dismiss(id) {
      await store
        .changeRun(id, (r) => {
          if (r.status !== "running") r.dismissed = true;
        })
        .catch(() => {});
      notify();
    },
    // At start: runs left running when Marklore last closed are over.
    async recover() {
      for (const run of await store.listRuns())
        if (run.status === "running" && !children.has(run.id))
          await end(run.id, {
            status: "failed",
            error: t("Marklore 关闭时中断"),
          });
    },
    // Marklore closes: the children go with it.
    close() {
      for (const child of children.values()) {
        child.stopped = true;
        child.kill();
      }
    },
  };
}
