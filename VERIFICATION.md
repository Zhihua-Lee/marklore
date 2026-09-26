# Verification — 2026-09-26

## v0.1.3 reading controls, fonts, copied math and export

59 browser regressions passed, including 6 copied-formula cases and 5 compact-layout
cases. The supplied overescaped Riesz expression produces the same KaTeX DOM as
standard TeX; code fences, source offsets, literal text underscores, matrix row
separators and unknown-command errors retain their behavior. Width changes preserve
the semantic reading anchor. Side-panel switches follow saved panel placement;
mode controls remain centered in the document area.

Actual Chromium glyph inspection confirms bundled Literata for Latin, Microsoft
YaHei UI for CJK and JetBrains Mono for code. The default paragraph is 16px/1.7,
strong text is weight 600 and inline KaTeX is 1em. Fonts come from OFL upstream
packages, not extracted viewer assets. Native packaged font/menu tests pass as well.
All 19 unit tests pass, including standalone resource embedding, export cancellation,
source protection and destination guards. Formatting checks pass.

Native source-build export tests verify current unsaved text, expanded headings and
details, embedded local SVG and fonts, Mermaid SVG, no Node access in standalone
HTML, PDF signature and unchanged source notes. Poppler verifies a tagged two-page
A4 PDF; both page renders were inspected for clipping, missing glyphs and content.
Exports do not promise complete TeX support or download remote images. HTML includes
resource-license notices and may preserve links from the source note.

The final v0.1.3 packaged EXE passes the same native export checks, including
protocol/request-handler cleanup on successful PDF generation and forced image
decode failure. A packaged-only notice lookup failure was corrected by resolving
the trusted license file beside the EXE. Hidden-window QA capture now uses an
offscreen test-only preview; this fixed a screenshot timeout without changing the
production window. Prior packaged files are retained separately.

The initial full-suite run caught a test drag beginning on a close button after the
layout changed; tests now derive the drag point from visible label geometry. A
concurrent build also exposed Vite watching locked release binaries; release and
test-output directories are now excluded from development watching. The full rerun
passes. These are test/development fixes, not hidden production errors.

## v0.1.2 typography, layout and interaction pass

48 browser tests and 18 file-service tests passed. New coverage includes real
Chromium font selection (CDP, not just declared CSS), KaTeX semantic bold/italic,
CJK math size matching prose, read/edit font-size parity, persistent independently
placed panels, overflowing/keyboard/drag tabs, stable tab DOM while typing, theme
and layout reading progress, and source-outline updates without hidden-preview DOM
redraw. Light/dark reading, compact menu and appearance dialog screenshots reviewed.

On this Windows machine the installed Noto Sans SC variable font covers both Latin
and Chinese. The balanced preset actually selects it for both; classic selects
Arial / Microsoft YaHei, book selects Cambria / SimSun. KaTeX custom fonts load in
the native application. No font files were copied from Windows into the package.

Measured structural work: unchanged preview update causes zero child-list mutations;
editing the last of 1,200 simple blocks causes two mutations while retaining the
first 1,199; a near-top fallback anchor measures one block instead of eagerly
measuring all 1,200. These are targeted work-count tests, not an end-to-end speedup
percentage or a comparison with MDLook. Cache budget is serialized-HTML accounting,
not a hard native-memory limit. First-open full parsing remains synchronous.

The narrow editor undo/tab-return regression still emits CodeMirror's “Measure loop
restarted more than 5 times” warning while passing its position/history assertions.
It reproduced twice in isolation; the cause is not proven. It is not suppressed,
and line wrapping is retained. Reduced-motion CSS disables the new brief UI-surface
transitions; article text has no animated scale or transform.

Native-menu tests passed on both the source build and the actual v0.1.2 packaged EXE.
They preserve the standard title bar and registered native accelerators
while keeping the menu strip hidden, including after Alt; Ctrl+N executes once.
This version is packaged separately under `release/v0.1.2/win-unpacked`, leaving
the prior release intact. An extraction-directory rename initially hit EPERM;
packaging succeeded using the same installed Electron 44.4.5 distribution through
electron-builder's supported `electronDist` option.

## v0.1.1 product interface pass

35 browser regression cases passed, including the new start page, last-tab close,
exact untouched welcome migration, preserved edited welcome, and narrow dark layout.
Native smoke passed again. Reading, start-page and dark narrow screenshots reviewed.
User-facing development explanations were removed; application controls now use a
consistent local SVG icon set. The legacy example exists only as a test fixture,
not in the application bundle. Existing user files were not modified.

The final v0.1.1 packaged mouse-hover rerun was interrupted by extra trusted pointer
events: the pointer moved from the link center (325,359) to (732,283) while the link
rectangle remained unchanged. The test timed out and is not reported as passed.
The earlier v0.1.1 native source-build run passed; packaged pointer verification should
be repeated when the desktop is not receiving other pointer input.

## v0.1.0 baseline

Environment: Windows 10 x64, Node.js 24.19.0, pnpm 11.19.0, Electron 44.4.5,
installed Microsoft Edge for headless browser tests. Exact dependencies are locked.

## Executed checks

- 18 file-service tests: encoding, atomic saves/backups, stale versions, path authorization,
  junction replacement, network-path rejection, lazy search and preview access.
- 32 browser cases in total: 31-case full suite passed, followed by the expanded 8-case
  hover suite (including the new detached-link regression). Covers rendering/security,
  math/diagrams, source mapping, read/edit/source position, tabs, asynchronous saving,
  conflicts, hover anchors, unsaved content, keyboard access and async response races.
- Native Electron smoke: sandbox boundary, KaTeX fonts actually loaded, local SVG,
  hover without opening a tab, internal navigation, watch refresh, version-checked save,
  unsaved draft restart recovery. Also passed against the packaged EXE.
- Native safety probe: Save As cannot overwrite a file open in another tab; oversized
  sessions do not replace recovery data; cancelling quit leaves file watching active.
- Read-only acceptance probes of two user-designated course notes: 66 and 155 formulas,
  no KaTeX errors or leaked internal markers. These private files are not shipped.
- Reading, editing and hover screenshots reviewed; formatter check passed.

An early native mouse-hover run timed out. Failure instrumentation later captured
successful target loading followed by the pointer leaving the link. The precise cause
of that pointer movement was not established. Window focus/layout settling was added
to the test (no synthetic hover); repeated native runs and the packaged run passed.
Failure-only screenshots and bounded pointer diagnostics remain available in the test.

The same native investigation caught blocked inlined KaTeX fonts. The build now emits
fonts as same-origin files and tests assert their load under the unchanged strict CSP.

## Deliberate limits

This is a usable preview, not a formal security audit or proof of full Markdown/TeX
compatibility. See README for large-document performance, block-level mapping fallbacks,
session size limits, unbounded backup retention, the final external-save race window,
unsupported network paths, unsigned distribution and missing system integration.

Baseline checks did not change the original viewer installation, file association,
user note content or old patch repository. Later versions are published separately
to the private Folio Notes repository.
