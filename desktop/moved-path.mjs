// Where a path is after entries were renamed or moved: [[old, new]] of
// notes or folders, compared without regard to letter case (Windows,
// macOS). Shared by the main process and the MCP server (Node only).
import path from "node:path";

const key = (p) => path.resolve(p).toLowerCase();
// Whether p is folder or inside it.
export function within(p, folder) {
  const a = key(p),
    b = key(folder);
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}
// The path after the moves, or null when none applies.
export function movedTo(p, moves) {
  const sorted = [...moves].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of sorted)
    if (within(p, from)) {
      const rest = path.relative(path.resolve(from), path.resolve(p));
      return rest ? path.join(to, rest) : to;
    }
  return null;
}
// The path after the moves, or the same path.
export const movedPath = (p, moves) => movedTo(p, moves) ?? p;
