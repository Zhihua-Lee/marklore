import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFile, spawn as spawnProcess } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { t } from "./i18n.mjs";

// Updates from Marklore's GitHub releases. An installed copy runs the new
// setup over itself; a zip copy (also a portable one) has its folder
// overwritten once it has quit. Either way the program stays at the same
// path, so the file association and the startup entry keep working. Each
// download is checked against the release's SHA256SUMS file first.
export const feedUrl =
  "https://api.github.com/repos/Zhihua-Lee/marklore/releases/latest";
const execute = promisify(execFile);

const parts = (version) =>
  String(version)
    .replace(/^v/, "")
    .split(/[.+-]/)
    .slice(0, 3)
    .map((n) => Number(n) || 0);
// Whether release version a is later than b ("v0.3.0" > "0.2.9").
export function newer(a, b) {
  const x = parts(a),
    y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// The asset names each release carries (see docs/development.md).
export const assetNames = (version) => ({
  setup: `Marklore-Setup-v${version}-x64.exe`,
  zip: `Marklore-v${version}-win-x64.zip`,
  folder: `Marklore-v${version}-win-x64`,
  sums: `SHA256SUMS-v${version}.txt`,
});

// "<sha256>  <name>" lines, as sha256sum writes them.
export function parseSums(text) {
  const sums = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/i);
    if (match) sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

// Run by Windows PowerShell after Marklore quits: it waits for the old
// copy's processes to end, puts the new files in place and starts the
// program again. Folder copies are overwritten without deleting anything, so
// a portable "data" folder beside the program stays as it is.
// Marklore starts it and waits: it starts itself again as a process of its
// own and returns. (PowerShell started detached by Node does not run.)
export const helperScript = `param([int]$Parent, [string]$Kind, [string]$Source, [string]$Target, [string]$Log, [switch]$Own)
if (-not $Own) {
  $q = { param($v) '"' + $v + '"' }
  $list = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (& $q $PSCommandPath), '-Parent', $Parent, '-Kind', $Kind, '-Source', (& $q $Source), '-Target', (& $q $Target), '-Log', (& $q $Log), '-Own')
  Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $list -WindowStyle Hidden
  exit 0
}
function Note($text) { Add-Content -LiteralPath $Log -Value ("{0:s} {1}" -f (Get-Date), $text) -Encoding UTF8 }
$exe = Join-Path $Target 'Marklore.exe'
Note "waiting for $Parent"
try { Wait-Process -Id $Parent -Timeout 60 -ErrorAction Stop } catch {}
for ($i = 0; $i -lt 120; $i++) {
  $left = @(Get-CimInstance Win32_Process -Filter "Name='Marklore.exe'" | Where-Object { $_.ExecutablePath -eq $exe })
  if ($left.Count -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
if ($Kind -eq 'installer') {
  $p = Start-Process -FilePath $Source -ArgumentList @('/S', '/currentuser', '--updated', "/D=$Target") -Wait -PassThru
  Note "installer exit $($p.ExitCode)"
} else {
  & robocopy $Source $Target /E /R:10 /W:1 /NP /NFL /NDL /NJH /NJS | Out-Null
  Note "robocopy exit $LASTEXITCODE"
}
Start-Process -FilePath $exe
Note 'started'
`;

export function createUpdater({
  version,
  executable,
  installed,
  available,
  temp,
  fetch,
  feed = process.env.FOLIO_UPDATE_FEED || feedUrl,
  run = execute,
  spawn = spawnProcess,
  onChange = () => {},
}) {
  const folder = path.join(temp, "marklore-update"),
    pendingFile = path.join(folder, "pending.json"),
    log = path.join(folder, "update.log");
  const kind = !available ? "page" : installed ? "installer" : "folder";
  let state = { current: version, kind },
    release = null,
    ready = null;
  const set = (change) => {
    state = { ...state, ...change };
    onChange(state);
  };
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": `Marklore/${version}`,
  };
  async function get(url) {
    const response = await fetch(url, { headers });
    if (!response.ok)
      throw Error(t("更新服务器返回 {status}", { status: response.status }));
    return response;
  }
  // Streams one asset to disk, hashing it on the way.
  async function download(asset, file, share) {
    const response = await get(asset.browser_download_url);
    const total = Number(response.headers.get("content-length")) || asset.size,
      hash = createHash("sha256"),
      out = createWriteStream(file),
      reader = response.body.getReader();
    let received = 0,
      shown = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        if (!out.write(value))
          await new Promise((resolve) => out.once("drain", resolve));
        if (share && total && received - shown > total / 100) {
          shown = received;
          set({ progress: Math.min(99, Math.round((received / total) * 100)) });
        }
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    return hash.digest("hex");
  }
  // A folder copy overwrites itself: its folder must take new files.
  async function writable(dir) {
    const probe = path.join(dir, `.marklore-update-${process.pid}`);
    try {
      await fs.writeFile(probe, "");
      await fs.rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }
  return {
    status: () => state,
    // After a restart: whether the last update landed, then clear its files.
    async settle() {
      let pending;
      try {
        pending = JSON.parse(await fs.readFile(pendingFile, "utf8"));
      } catch {
        return null;
      }
      const updated = pending?.version === version;
      const detail = updated
        ? null
        : (await fs.readFile(log, "utf8").catch(() => "")).trim();
      // Reported once, even if a scanner still holds a file in the folder.
      await fs.rm(pendingFile, { force: true }).catch(() => {});
      await fs
        .rm(folder, {
          recursive: true,
          force: true,
          maxRetries: 10,
        })
        .catch(() => {});
      return {
        updated,
        version: pending?.version,
        from: pending?.from,
        detail,
      };
    },
    async check() {
      set({ checking: true, error: null });
      try {
        const latest = await (await get(feed)).json();
        const name = String(latest?.tag_name || "").replace(/^v/, "");
        if (!/^\d+\.\d+\.\d+$/.test(name)) throw Error(t("无效更新信息"));
        release = latest;
        ready = null;
        set({
          checking: false,
          checked: Date.now(),
          latest: name,
          available: newer(name, version),
          page: latest.html_url,
        });
      } catch (error) {
        set({ checking: false, error: error.message });
        throw error;
      }
      return state;
    },
    // Downloads and checks the new version; apply() then installs it.
    async prepare() {
      if (kind === "page") throw Error(t("此版本请从发布页下载"));
      if (!release || !state.available) throw Error(t("没有可用的更新"));
      const target = path.dirname(executable);
      if (kind === "folder" && !(await writable(target)))
        throw Error(t("程序所在文件夹不可写入，请从发布页下载"));
      const names = assetNames(state.latest),
        asset = (name) => {
          const found = release.assets?.find((item) => item.name === name);
          if (!found) throw Error(t("发布中缺少 {name}", { name }));
          return found;
        };
      const wanted = kind === "installer" ? names.setup : names.zip;
      set({ downloading: true, progress: 0, error: null });
      try {
        await fs.rm(folder, { recursive: true, force: true });
        await fs.mkdir(folder, { recursive: true });
        const sumsFile = path.join(folder, names.sums);
        await download(asset(names.sums), sumsFile, false);
        const expected = parseSums(await fs.readFile(sumsFile, "utf8")).get(
          wanted,
        );
        if (!expected)
          throw Error(t("校验文件中没有 {name}", { name: wanted }));
        const file = path.join(folder, wanted);
        if ((await download(asset(wanted), file, true)) !== expected)
          throw Error(t("下载的文件校验不符，已放弃更新"));
        let source = file;
        if (kind === "folder") {
          const staging = path.join(folder, "staging");
          await fs.mkdir(staging);
          await run(
            path.join(
              process.env.SystemRoot || "C:\\Windows",
              "System32",
              "tar.exe",
            ),
            ["-xf", file, "-C", staging],
            { windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 },
          );
          source = path.join(staging, names.folder);
          await fs.access(path.join(source, path.basename(executable)));
        }
        ready = { source, target, version: state.latest };
        set({ downloading: false, progress: 100, ready: state.latest });
      } catch (error) {
        set({ downloading: false, progress: null, error: error.message });
        throw error;
      }
      return state;
    },
    // Starts the helper; the caller quits Marklore right after.
    async apply() {
      if (!ready) throw Error(t("更新尚未下载"));
      const script = path.join(folder, "apply-update.ps1");
      // A BOM, so Windows PowerShell reads a non-ASCII path in it correctly.
      await fs.writeFile(script, "\ufeff" + helperScript, "utf8");
      await fs.writeFile(
        pendingFile,
        JSON.stringify({ version: ready.version, from: version, kind }),
      );
      const child = spawn(
        path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-Parent",
          String(process.pid),
          "-Kind",
          kind,
          "-Source",
          ready.source,
          "-Target",
          ready.target,
          "-Log",
          log,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(t("无法启动更新"))), 30000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      if (code !== 0) throw Error(t("无法启动更新"));
    },
  };
}
