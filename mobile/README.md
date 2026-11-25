# Marklore Reader (phone)

A read-only web app for reading a Marklore library on a phone. It is installed from Safari with "Add to Home Screen", reads one OneDrive folder through Microsoft Graph, keeps the notes and images on the phone, and works offline. Notes travel only between the phone and Microsoft; the page itself is static.

It reuses the desktop renderer (`src/markdown.js`): formulas, tables, code, links between notes and `_目录.md` index files read the same as on the desktop.

## Layout

- `index.html`, `main.js`: entry; picks the real or the mock back end (`?mock`).
- `ui/`: the reading interface. It talks only to `library` and `account` below.
- `library.js`: notes and images stored on the phone (IndexedDB), search, small persisted state.
- `account.js`, `auth.js`, `graph.js`, `sync.js`: Microsoft sign-in (authorization code with PKCE), folder listing and incremental sync (Graph delta).
- `mock.js`: an in-memory `library` and `account` with a sample notebook, for developing and testing the interface without an account.
- `sw.js`, `manifest.webmanifest`: offline shell and home-screen install.

Build: `vite build --config vite.mobile.config.mjs` (output `dist-mobile/`). Dev server: `vite --config vite.mobile.config.mjs` (port 5180). Tests: `playwright test --config playwright.mobile.config.mjs` (iPhone viewport in Chromium and WebKit; mock back end).

## Contract between the interface and the back end

Paths are relative to the chosen folder, with `/` separators, as stored in OneDrive (`Sub folder/Note.md`). All methods are async unless noted.

### `library`

- `info()` → `{ folderName, lastSync, notes, images, imagesOnPhone } | null`. `null` until a folder has been synced once. `images` counts the images listed in the folder, `imagesOnPhone` those downloaded.
- `list()` → `[{ path, title, modified, size }]`, Markdown notes only, sorted by path. `title` is the note's leading heading, else the file name without `.md`.
- `text(path)` → the note's Markdown, or `null`.
- `asset(path)` → an object URL for a stored image (path already resolved against the note's folder and decoded), or `null` when it is not on the phone. URLs stay valid until the next change event.
- `isRemoteImage(path)` → true when the image is in the folder but not on the phone yet. A sync downloads every note but, unless all images are kept offline (`account.setOfflineImages`), only lists images; a note shows them by calling `fetchAsset`.
- `fetchAsset(path)` → like `asset`, downloading the image first when needed; `null` when that is not possible now (offline, signed out).
- `search(query, { limit = 50 })` → `[{ path, title, snippet, line }]`; case-insensitive, all words must occur; `line` is the 0-based line of the first match.
- `state.get(key, fallback)`, `state.set(key, value)`: small JSON values kept on the phone. Keys used by the interface: `recent` (paths, newest first), `last` (`{ path, scroll }`), `settings` (`{ size, theme, typeface, keepAwake }`).
- `onChange(fn)` → unsubscribe. Called after a sync added, changed or removed notes.

### `account`

- `status()` (sync) → `{ configured, signedIn, user, folder, syncing, offlineImages }`. `configured` is false while no application (client) ID is set; `folder` is `{ id, name, path } | null`.
- `onStatus(fn)` → unsubscribe.
- `setClientId(id)`: stores the application ID registered by the owner.
- `signIn()`: leaves the page for Microsoft's sign-in and comes back; `signOut()`.
- `folders(parentId | null)` → `[{ id, name, path, childCount }]` (OneDrive root when `null`), for the folder picker.
- `chooseFolder(folder)`: remembers it and starts the first sync.
- `sync()` → `{ added, changed, removed }`.
- `setOfflineImages(on)`: keep every image on the phone (each sync downloads the missing and changed ones; turning it on starts a sync). Off by default: images come down when a note shows them, and those already on the phone stay and are updated.
- `onProgress(fn)` → unsubscribe; `fn({ phase, done, total, message })` with `phase` one of `listing`, `downloading`, `done`, `error`.
