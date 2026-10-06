// What a library walk reads, shared by the link index (search, backlinks)
// and the file-name search of folders outside the library: Markdown notes,
// but not hidden folders, Python or conda environments, packages and caches.

// Notes that are read (plain .txt files are left out: in a home folder they
// are mostly licenses and logs).
export const NOTE = /\.(md|markdown|mdown|mkd)$/i;
// Folders that hold software, not notes.
const SKIP = new Set(["node_modules", "__pycache__", "site-packages"]);
// A folder holding one of these is a Python or conda environment.
const ENVIRONMENT = new Set(["conda-meta", "pyvenv.cfg"]);

// Never entered: hidden folders and software folders, by name.
export const skippedName = (name) => name.startsWith(".") || SKIP.has(name);
// A folder whose entries mark it as an environment (not at a walk's root).
export const isEnvironment = (names) =>
  names.some((name) => ENVIRONMENT.has(name));
