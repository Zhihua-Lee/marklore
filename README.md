# Folio Notes

English · [简体中文](README.zh-CN.md)

**An offline Markdown notebook for Windows: comfortable to read, quick to write, and your notes stay plain files.**

[![CI](https://github.com/Zhihua-Lee/folio-notes/actions/workflows/ci.yml/badge.svg)](https://github.com/Zhihua-Lee/folio-notes/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Zhihua-Lee/folio-notes?label=release)](https://github.com/Zhihua-Lee/folio-notes/releases/latest)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-285e50)

[Install](#install) · [Features](#features) · [Getting started](#getting-started) · [User guide (Chinese)](docs/user-guide.md) · [Development](docs/development.md) · [Verification](VERIFICATION.md)

![Folio Notes reading view: the library on the left, rendered formulas and tables in the middle, the outline on the right](docs/images/en/overview.png)

Read, edit and organize local notes in one workspace. Tabs and colored groups keep material together. The outline, link previews and back/forward history take you through long documents. KaTeX formulas, syntax-highlighted code and Mermaid diagrams cover technical writing. Notes are `.md` files on your disk: there is no database to import into and nothing is uploaded.

The interface is available in English and Chinese. It follows the system language, and you can switch it in `Settings → Theme & language → Language`.

## Install

Folio Notes is portable and needs no administrator rights.

1. Download `Folio-Notes-vX.Y.Z-win-x64.zip` from the [latest release](https://github.com/Zhihua-Lee/folio-notes/releases/latest).
2. (Optional) Verify the download against the matching line in `SHA256SUMS-vX.Y.Z.txt` on the same page:
   ```powershell
   Get-FileHash .\Folio-Notes-vX.Y.Z-win-x64.zip -Algorithm SHA256
   ```
3. **Extract the whole archive** to any folder, for example `D:\Apps\Folio Notes`. Keep the DLLs, `resources` and `locales` next to the EXE; do not copy the EXE alone.
4. Run `Folio Notes.exe`. The build is not code-signed, so on first launch Windows SmartScreen may warn about an unknown publisher: choose **More info → Run anyway**.

**Portable mode:** turn on `Settings → Background & system → Portable mode` to keep your tabs, drafts, recent files and settings in a `data` folder next to the program. The whole folder, for example on a USB stick, then carries its state with it.

**Update:** extract the new version to a new folder and start it from there. Settings, recovery drafts and recent files live in your user profile (or in `data` in portable mode), not in the program folder. Delete the old folder once the new one works. If you enabled start at login or Markdown file registration, register again from the new version in `Settings → Background & system`.

**Uninstall:** delete the program folder. To also remove settings and recovery data, delete `%APPDATA%\folio-notes`. It contains drafts in plain text, so do not share it.

Want to try it first? The [sample notebook](docs/sample-notebook-en) has formulas, tables, code, a diagram and linked notes: choose it with **Open folder**.

## Features

### Long documents: outline jumps glide

Click an outline entry and the note scrolls smoothly to the heading. Formulas and tables along the way are laid out in advance, so nothing jumps while the page moves. Mouse side buttons or `Alt+←` / `Alt+→` go back and forth through the jump history, to the exact place you left.

![Clicking the outline: the note glides to each section](docs/images/en/outline.gif)

### Link previews: read without leaving your place

Hover a link to a local note to read the target in a popup: scroll, select and copy there. Click to open it, and `Alt+←` brings you back.

![Hovering a link shows the linked note in a preview; clicking opens it; Alt+← returns](docs/images/en/preview.gif)

### Find in the rendered note

`Ctrl+F` highlights every match in the rendered text and `Enter` steps through them. For regular expressions or replace, the find bar hands the term to the source editor's search panel.

![Ctrl+F finds "convolution" and steps through the matches](docs/images/en/find.gif)

### Split editing: source on the left, live preview on the right

Formulas, tables and code render as you type in Edit mode. You can also edit a single paragraph right in the preview, and double-clicking text in the reading view jumps to its source.

![Typing a sentence with a formula in Edit mode; the preview renders it live](docs/images/en/edit.gif)

### More

| Capability                  | Details                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy as Markdown            | Copying from the reading view gives the matching Markdown: formulas as `$…$`, links with their targets. `Ctrl+Shift+C` copies the rendered result.              |
| Math and technical writing  | KaTeX formulas, Mermaid diagrams, syntax highlighting, sortable tables, clickable task lists and footnotes.                                                     |
| Multi-document workspace    | Draggable tabs, colored groups, a folder library with a file-name filter that includes subfolders; recent files on the start page and in the taskbar jump list. |
| Reading appearance          | Light and dark themes, bundled fonts, text size and weight, adjustable sidebars and table styles; a toolbar that is also the title bar, and full screen.        |
| Smooth scrolling (optional) | `Settings → Navigation & scrolling → Smooth scrolling` moves the page once per display frame, so touchpad, wheel and scrollbar scrolling keep an even pace.     |
| Local saving and export     | Explicit saves, disk version checks, backups and draft recovery; export to PDF or a standalone offline HTML file.                                               |

![Edit mode in the dark theme: Markdown source on the left, rendered preview on the right](docs/images/en/edit-dark.png)

## Getting started

Use **Open file** to open Markdown files, or **Open folder** to add a folder to the library; you can also drag Markdown files into the window. `Ctrl+N` creates a note and `Ctrl+S` saves.

| Mode   | Use                                                                                               | Shortcut |
| ------ | ------------------------------------------------------------------------------------------------- | -------- |
| Read   | The rendered note, outline, folding and link previews.                                            | `Ctrl+1` |
| Edit   | Markdown on the left, live preview on the right; you can also edit a single block in the preview. | `Ctrl+2` |
| Source | The full Markdown editor for content and structure.                                               | `Ctrl+3` |

| Action                      | Shortcut                                      |
| --------------------------- | --------------------------------------------- |
| Find / next match           | `Ctrl+F` / `Enter` or `F3`                    |
| Back / forward              | `Alt+←` / `Alt+→` (or the mouse side buttons) |
| Copy as Markdown / rendered | `Ctrl+C` / `Ctrl+Shift+C`                     |
| Text size                   | `Ctrl+wheel` / `Ctrl++` / `Ctrl+-`            |
| Full screen                 | `F11`                                         |

All three modes share one draft, and switching modes or tabs keeps your reading position. The Settings button (the sliders icon) in the toolbar opens fonts, theme, language, sidebars, tables and background settings, in sections. The full [user guide](docs/user-guide.md) is in Chinese for now.

## Data and privacy

**Only an explicit save writes back to your Markdown file.** Recovery drafts and workspace state are stored on this computer. Before saving, Folio checks the file on disk and offers to resolve a conflict if another program changed it. Image attachments go into an `assets` folder next to the note; keep it with the note when you move it.

There is no cloud sync, no telemetry and no automatic upload, and remote images are not downloaded. Local recovery data contains drafts and file paths in plain text, and backups do not expire automatically.

## Compatibility

Folio Notes is a **Windows desktop preview** (Windows 10 / 11, x64). Formulas render within KaTeX's supported syntax. The first open of a very long note or one with many formulas or diagrams can still take noticeable time. The current version is in [package.json](package.json); the tests run for each version and their scope are in [VERIFICATION.md](VERIFICATION.md).

## Run from source

The development baseline is **Windows, Node.js 24 and pnpm 11**. Installing dependencies needs the internet once; the built app then works offline. The steps below are for the repository owner and authorized users.

```powershell
git clone https://github.com/Zhihua-Lee/folio-notes.git
cd folio-notes
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`pnpm start` launches the Electron desktop app; `pnpm dev` starts only a browser UI demo without native file access. Build, test and packaging details are in the [development guide](docs/development.md). The screenshots and animations in this README are regenerated from the sample notebooks by `node tools/readme-media.mjs`.

## Documentation

| Document                                           | Contents                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [User guide](docs/user-guide.md) (Chinese)         | Editing, find, copy, tabs and groups, links, images, export, shortcuts and troubleshooting.              |
| [Development guide](docs/development.md) (Chinese) | Setup, workflow, tests, Windows packaging and source layout.                                             |
| [Verification](VERIFICATION.md)                    | Regression checks, results and their limits for each version.                                            |
| [Sample notebook](docs/sample-notebook-en)         | Notes for trying the features, also used to generate the README media ([Chinese](docs/sample-notebook)). |
| [Third-party notices](THIRD-PARTY-NOTICES.txt)     | Licenses of dependencies and fonts.                                                                      |

## License

The project's own code and documentation are **All Rights Reserved**; this is **not an open-source license**. Using, modifying or distributing it requires separate written permission from the copyright holder, and access to this repository does not grant those rights. See [LICENSE](LICENSE).

Third-party components, fonts and the Electron / Chromium runtime remain under their own licenses. See the [development guide](docs/development.md) for pre-distribution checks.
