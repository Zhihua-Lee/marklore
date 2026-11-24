// Windows Explorer ends itself once it holds about 9 000 GDI objects
// (taskbar, tray and menus go blank until it is restarted), and some test
// browsers cost it a few GDI objects per window that it never gives back:
// headless Edge takes about 6 for every page a UI test opens. Test runs read
// the taskbar Explorer's GDI count first and stop while it is high, so a run
// cannot be the one that brings Explorer down.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const explorerGdiLimit = Number(
  process.env.FOLIO_EXPLORER_GDI_LIMIT || 6000,
);

const probe = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class ExplorerGdi {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr h, uint flags);
}
'@
$id = 0
[void][ExplorerGdi]::GetWindowThreadProcessId([ExplorerGdi]::FindWindow('Shell_TrayWnd', $null), [ref]$id)
if ($id) { [ExplorerGdi]::GetGuiResources((Get-Process -Id $id).Handle, 0) }
`;

// The count with, when it cannot be read, why: { count, reason }.
export function readExplorerGdi() {
  if (process.platform !== "win32")
    return { count: null, reason: "not Windows" };
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", probe],
    { encoding: "utf8", timeout: 20000, windowsHide: true },
  );
  const count = Number.parseInt(result.stdout, 10);
  if (Number.isFinite(count)) return { count, reason: null };
  const error = (result.error?.message || result.stderr || "").trim();
  return {
    count: null,
    reason: error
      ? `PowerShell failed: ${error.split(/\r?\n/)[0]}`
      : "no taskbar Explorer in this session (a service or remote session has none)",
  };
}

// The taskbar Explorer's GDI object count, or null where it cannot be read
// (not Windows, no taskbar, PowerShell unavailable).
export function explorerGdi() {
  return readExplorerGdi().count;
}

// Throws when Explorer is above the limit; returns the count otherwise.
export function checkExplorerGdi(what = "the tests") {
  const count = explorerGdi();
  if (count !== null && count > explorerGdiLimit)
    throw new Error(
      `Explorer holds ${count} GDI objects (limit ${explorerGdiLimit}); not starting ${what}. ` +
        "Explorer ends itself near 9 000 and does not give these back: restart " +
        '"Windows Explorer" in Task Manager, then run again ' +
        "(FOLIO_EXPLORER_GDI_LIMIT changes the limit).",
    );
  return count;
}

// Playwright globalSetup: the UI tests do not start above the limit.
export default function globalSetup() {
  checkExplorerGdi("the UI tests");
}

// Run directly (`electron-as-node tools/explorer-gdi.mjs`): one line with the
// count and the limit. Exit 0 when tests may start (also when the count
// cannot be read: the guard lets them start then), 1 above the limit.
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const { count, reason } = readExplorerGdi();
  if (count === null)
    console.log(
      `Explorer GDI: unknown (${reason}); limit ${explorerGdiLimit}; tests may start`,
    );
  else
    console.log(
      `Explorer GDI: ${count}; limit ${explorerGdiLimit}; ${count > explorerGdiLimit ? "above the limit: tests will not start" : "tests may start"}`,
    );
  process.exitCode = count !== null && count > explorerGdiLimit ? 1 : 0;
}
