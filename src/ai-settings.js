import { t } from "../desktop/i18n.mjs";

// Settings → AI assistant: which library folders an AI may read through
// Marklore's MCP server, and the assistants it is added to. Claude Code and
// Codex are connected with one button (the app writes their settings:
// desktop/ai-connect.mjs), and each says whether it is connected to this
// copy of Marklore and how many of its sessions use it now; any other
// assistant takes the server's setup as JSON. Desktop only (the browser
// preview has no server).
export const aiSettingsMarkup = `
<fieldset id="settings-ai" hidden><legend>${t("AI 助手")}</legend>
  <div class="setting setting-list"><span class="setting-text"><span id="ai-libraries-label">${t("AI 可以读取的笔记库")}</span><small>${t("AI 助手通过 MCP 读取勾选的笔记库并提出修改；修改要你在 Marklore 中预览并接受才会写入")}</small></span></div>
  <ul id="ai-libraries" class="ai-libraries" aria-labelledby="ai-libraries-label"></ul>
  <div class="setting setting-list"><span class="setting-text"><span id="ai-connect-label">${t("连接 AI 助手")}</span><small>${t("连接后，它新开的会话就能读取勾选的笔记库、提出修改、收到你的标记")}</small></span></div>
  <ul id="ai-connections" class="ai-libraries ai-connections" aria-labelledby="ai-connect-label"></ul>
  <div class="setting"><span class="setting-text"><span>${t("其他 AI 助手")}</span><small>${t("复制 MCP 服务器的配置（JSON），按那个 AI 助手的说明添加")}</small></span><span class="setting-actions"><button id="ai-copy-json" type="button">${t("复制配置")}</button></span></div>
  <p id="ai-setup" class="setting-footnote"></p>
</fieldset>`;

const NAMES = { claude: "Claude Code", codex: "Codex" };

// The server as an MCP client's JSON settings take it.
export const setupJson = ({ command, args, env }) =>
  JSON.stringify({ mcpServers: { marklore: { command, args, env } } }, null, 2);

// What a connection's row says.
function statusText(c) {
  switch (c.state) {
    case "ok":
      return c.sessions
        ? t("已连接 · {count} 个会话正在使用", { count: c.sessions })
        : t("已连接 · 新开的会话就能使用");
    case "other":
      return c.missing
        ? t("连接的 Marklore 已不在原处：{path}", { path: c.command })
        : t("连接的是另一个 Marklore：{path}", { path: c.command });
    case "unreadable":
      return t("读不了它的设置文件：{file}", { file: c.file });
    default:
      return c.installed ? t("未连接") : t("未连接 · 这台电脑上没有找到它");
  }
}

export function wireAiSettings({ api, getRoots, getSettings, change, report }) {
  if (!api?.aiSetup) return () => {};
  const $ = (s) => document.querySelector(s);
  $("#settings-ai").hidden = false;
  let setup = null;
  const key = (p) => p.replace(/[\\/]+$/, "").toLowerCase();
  function paint() {
    const roots = getRoots(),
      chosen = new Set((getSettings().aiLibraries || []).map(key));
    const list = $("#ai-libraries");
    list.replaceChildren(
      ...(roots.length
        ? roots.map((root, i) => {
            // A row like every setting: the folder's name and path, a switch.
            const item = document.createElement("li"),
              text = document.createElement("span"),
              label = document.createElement("label"),
              where = document.createElement("small"),
              box = document.createElement("input");
            item.className = "setting";
            text.className = "setting-text";
            box.type = "checkbox";
            box.className = "switch";
            box.id = "ai-library-" + i;
            box.checked = chosen.has(key(root.path));
            box.dataset.path = root.path;
            label.htmlFor = box.id;
            label.textContent = root.name;
            where.textContent = root.path;
            where.title = root.path;
            text.append(label, where);
            item.append(text, box);
            return item;
          })
        : [
            Object.assign(document.createElement("li"), {
              className: "empty",
              textContent: t("尚未添加笔记库"),
            }),
          ]),
    );
    paintConnections();
  }

  // One row per assistant: its name and state, and what can be done.
  function connectionRow(c) {
    const item = document.createElement("li"),
      text = document.createElement("span"),
      name = document.createElement("span"),
      state = document.createElement("small"),
      actions = document.createElement("span");
    item.className = "setting";
    item.dataset.kind = c.kind;
    item.dataset.state = c.state;
    text.className = "setting-text";
    actions.className = "setting-actions";
    name.textContent = NAMES[c.kind];
    state.textContent = statusText(c);
    state.title = c.state === "other" ? c.command : c.file;
    text.append(name, state);
    const button = (label, connect) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.onclick = () => change$(c.kind, connect);
      actions.append(b);
    };
    if (c.state === "none") button(t("连接"), true);
    if (c.state === "other") button(t("改为连接这个"), true);
    if (c.state === "ok" || c.state === "other") button(t("断开"), false);
    item.append(text, actions);
    return item;
  }
  let painting = 0;
  async function paintConnections() {
    const epoch = ++painting;
    const list = await api.aiConnections().catch(() => []);
    if (epoch !== painting) return;
    $("#ai-connections").replaceChildren(...list.map(connectionRow));
  }
  async function change$(kind, connect) {
    try {
      await (connect ? api.aiConnect(kind) : api.aiDisconnect(kind));
      report(
        connect
          ? t("已连接 {name}：在它新开的会话里就能使用 Marklore", {
              name: NAMES[kind],
            })
          : t("已断开 {name}", { name: NAMES[kind] }),
      );
    } catch (error) {
      report(error.message);
    }
    paintConnections();
  }

  $("#ai-libraries").onchange = () =>
    change({
      aiLibraries: [...document.querySelectorAll("#ai-libraries input")]
        .filter((box) => box.checked)
        .map((box) => box.dataset.path),
    });
  // Library folders and connections change while Settings is closed: look
  // again on opening.
  new MutationObserver(() => $("#appearance").open && paint()).observe(
    $("#appearance"),
    { attributes: true, attributeFilter: ["open"] },
  );
  $("#ai-copy-json").onclick = async () => {
    try {
      setup ??= await api.aiSetup();
      await api.copyText(setupJson(setup));
      report(t("已复制 MCP 配置（JSON）"));
    } catch (error) {
      report(error.message);
    }
  };
  api.aiSetup().then(
    (value) => {
      setup = value;
      $("#ai-setup").textContent = t("服务器：{command} {script}", {
        command: value.command,
        script: value.args.join(" "),
      });
    },
    () => {},
  );
  return paint;
}
