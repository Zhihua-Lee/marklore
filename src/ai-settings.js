import { t } from "../desktop/i18n.mjs";

// Settings → AI assistant: which library folders an AI may read through
// Marklore's MCP server, and the lines that add the server to an assistant.
// Desktop only (the browser preview has no server).
export const aiSettingsMarkup = `
<fieldset id="settings-ai" hidden><legend>${t("AI 助手")}</legend>
  <div class="setting setting-list"><span class="setting-text"><span id="ai-libraries-label">${t("AI 可以读取的笔记库")}</span><small>${t("AI 助手通过 MCP 读取勾选的笔记库并提出修改；修改要你在 Marklore 中预览并接受才会写入")}</small></span></div>
  <ul id="ai-libraries" class="ai-libraries" aria-labelledby="ai-libraries-label"></ul>
  <div class="setting"><span class="setting-text"><span>${t("连接 AI 助手")}</span><small>${t("把 Marklore 添加为 MCP 服务器；移动程序位置后需重新添加")}</small></span><span class="setting-actions"><button id="ai-copy-claude" type="button">Claude Code</button><button id="ai-copy-codex" type="button">Codex</button><button id="ai-copy-json" type="button">JSON</button></span></div>
  <p id="ai-setup" class="setting-footnote"></p>
</fieldset>`;

const quote = (s) => `"${s}"`;
// The three forms assistants take a stdio server in.
export function setupText(kind, { command, args, env }) {
  const envPairs = Object.entries(env);
  if (kind === "claude")
    return [
      // --env takes several KEY=value pairs: another option must follow it,
      // or the name is read as one more pair (Claude Code docs).
      "claude mcp add",
      ...envPairs.map(([k, v]) => `--env ${k}=${v}`),
      "--transport stdio --scope user marklore --",
      quote(command),
      ...args.map(quote),
    ].join(" ");
  if (kind === "codex")
    // TOML literal strings: backslashes in Windows paths stay as they are.
    return [
      "[mcp_servers.marklore]",
      `command = '${command}'`,
      `args = [${args.map((a) => `'${a}'`).join(", ")}]`,
      `env = { ${envPairs.map(([k, v]) => `${k} = "${v}"`).join(", ")} }`,
      "",
    ].join("\n");
  return JSON.stringify(
    { mcpServers: { marklore: { command, args, env } } },
    null,
    2,
  );
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
  }
  $("#ai-libraries").onchange = () =>
    change({
      aiLibraries: [...document.querySelectorAll("#ai-libraries input")]
        .filter((box) => box.checked)
        .map((box) => box.dataset.path),
    });
  async function copy(kind) {
    setup ??= await api.aiSetup();
    await api.copyText(setupText(kind, setup));
    report(
      {
        claude: t("已复制 Claude Code 命令，在终端中运行即可"),
        codex: t("已复制，粘贴到 Codex 的 config.toml"),
        json: t("已复制 MCP 配置（JSON）"),
      }[kind],
    );
  }
  // Library folders change while Settings is closed: list them on opening.
  new MutationObserver(() => $("#appearance").open && paint()).observe(
    $("#appearance"),
    { attributes: true, attributeFilter: ["open"] },
  );
  for (const kind of ["claude", "codex", "json"])
    $(`#ai-copy-${kind}`).onclick = () =>
      copy(kind).catch((error) => report(error.message));
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
