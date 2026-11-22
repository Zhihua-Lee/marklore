// Windows Explorer ends itself once it holds about 9 000 GDI objects
// (taskbar, tray and menus go blank until it is restarted), and some test
// browsers cost it a few GDI objects per window that it never gives back:
// headless Edge takes about 6 for every page a UI test opens. Test runs read
// the taskbar Explorer's GDI count first and stop while it is high, so a run
// cannot be the one that brings Explorer down.
import { spawnSync } from "node:child_process";

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

// The taskbar Explorer's GDI object count, or null where it cannot be read
// (not Windows, no taskbar, PowerShell unavailable).
export function explorerGdi() {
  if (process.platform !== "win32") return null;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", probe],
    { encoding: "utf8", timeout: 20000, windowsHide: true },
  );
  const count = Number.parseInt(result.stdout, 10);
  return Number.isFinite(count) ? count : null;
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
