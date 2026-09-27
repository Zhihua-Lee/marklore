# Verification — 2026-09-26

## v0.1.19 tab groups, reading navigation and disclosure feedback

41 unit tests pass, including measured column allocation, bounded reading history, departure anchors, branch
replacement, current-note filtering, closed-tab removal, edit remapping and group
ordering. The attachment test was rerun after removing its confirmation and passes:
supported files open directly, executable/script shortcuts stay blocked, while web
links retain their existing confirmation.

Browser runs passed 12 existing tab/parser cases, 41 navigation/block-editor/hover/
compact-layout cases, and 32 final navigation/tab/workbench/performance/save-safety
cases. A further details-card case passes in both themes. Initial group dragging
inserted a header drop at the start; header drops now append, while member drops
choose an insertion position. The final runs cover that behavior and cancellation.

Checks include group creation, rename/color, membership, collapse and restored
drafts; tab/group dragging, keyboard reorder, 480px layout; hidden-by-default
history controls, persisted preferences, Alt navigation, mouse button events and
duplicate OS/mouse suppression. Source anchors restore departure positions without
closing/reopening notes. Hover-only previews and scrolling do not add history.
Reading history is in-memory (200 entries), separate from editor undo and stored
tab positions. Large external edits can only preserve approximate source positions.

Native v0.1.19 tests pass for navigation, editing/attachments, save safety and
standalone HTML/PDF export. The navigation test exercises BrowserWindow app-command
delivery through the real preload, modal protection, position restoration, actual
session-file group persistence and optional controls. It simulates the OS event;
the user's physical mouse/driver is not exercised. Attachment tests reject any
confirmation call and intercept OS opening so no external PDF application launches.
All fixtures use isolated profiles and temporary notes; real notes remain untouched.

Light/dark/narrow group layouts, collapsed heading feedback and details-card hover
screenshots were inspected. Card border, summary and marker respond without layout
shift or changes to author-specified red text; reduced-motion behavior is tested.
Formatting, diff checks, production build and packaging pass. Existing tab logic
was moved into a focused component rather than maintained as a second parallel
implementation; history stores positions only, not additional document copies.

Table-width follow-up: 14 editor/table browser cases, 21 table/hover/navigation/
performance cases and all 3 final table cases pass. The imbalanced 12-row fixture
at 680px changes from 3391px to 1548px tall at the same 16px type size; the repeated
explanation column grows from 122px to 305px. Measurement/selection took 16–21ms
for that fixture on this machine, not a universal performance bound. Live-reader
and hover-preview integration, cached repeat layouts, resize, CJK/math minimums,
overflow containment and native fallback for merged cells are checked. Layout uses
bounded samples/candidate widths, not an unbounded exact optimizer. Multiple tables
are processed in time-budgeted batches. Authored widths and complex image/nested
tables retain native layout; a taller candidate is rejected. Export keeps its
existing target-specific native column allocation, independently of reader sizing.

## v0.1.18 compact color controls, table styles and hover feedback

36 unit tests pass. Of 26 focused browser cases (editing, block editing and
blocks/tabs), 25 passed initially; the table check incorrectly required a literal
1 CSS-pixel border at a fractional reading zoom. After checking visible border
presence instead, all 12 editing cases passed. An additional table-only run passed
with light/dark hover screenshots. Formatting, diff checks and production build pass.

Checks cover direct inline-math/divider buttons, left-click remembered colors,
right-click anchored nonmodal palettes, keyboard opening/Escape, source/local
editing, clearing and undo, color indicators, reload persistence and mode-switch
dismissal. Tables offer soft/plain/grid styles and auto/full widths. Hover does
not change table/chart geometry or text transforms; reduced-motion transitions
are disabled. Narrow layouts remain contained. Palette, table and export screenshots
were inspected. Styles use the existing theme tokens and no raster scaling.

The packaged v0.1.18 EXE passes native editing, HTML/PDF export, image-access and
save-safety tests. Native checks include left/right color actions and undo, plus
actual standalone export cell borders, full width and selected grid style. Image
picker/paste/drop, authorized decoding, source preservation and recovery behavior
remain covered. All native fixtures use isolated profiles and temporary notes;
the user's running app and real notes were not modified.

## v0.1.17 text colors, grouped tools and local image diagnostics

36 unit tests pass. A 34-case focused browser run covered editing, block editing,
outline/typography and parsing/security; 33 passed and the narrow toolbar exceeded
its height budget. After compacting group spacing without moving the fixed corner
controls, all 9 editing cases passed again. Earlier checks also caught corner-button
overlap; the editor retains its reserved left margin. Formatting and build pass.

Coverage includes six preset/custom color controls, clearing and undo, preserving
bold text and heading structure, multiline wrappers, rejecting injected CSS values,
theme-adaptive presets, clean outline labels and no pencil/Alt+Enter editing in
read mode. Color markup uses inline HTML and does not require an HTML-to-Markdown
conversion. The narrowed dark layout was visually inspected.

The reported image failure was reproduced against the actual note in a read-only,
isolated-profile run: its image exists but is in a sibling cache folder outside the
note directory. Consent enabled actual pixel decoding and survived a reload; the
note's bytes were checked unchanged. No personal note or image is included in the
test fixtures, source archive or repository. This test did not change the user's
normal application profile or grant it permissions silently.

The final packaged v0.1.17 EXE passes native image-access, editing, export and save
safety tests. Image-access tests check denial, cancellation, consent, remembered
image-only scope and absence of a read-mode pencil. Native export checks actual
standalone highlighted/background and text colors alongside PDF, fonts and images.
Existing picker, paste and drop insertion still decode successfully. Failed local
loads now explain missing files / authorization / decode failure instead of only
showing a broken-image icon. Remembered image access does not grant note access.

## v0.1.16 block editing, image insertion and attachment links

34 unit tests pass. Of the full 99 browser cases, 97 passed initially; a new
image mock used `href` instead of the native API's `url`, and a development hot
reload interrupted one quote-style check. After correcting the mock, all 18
block-editing and formula/quote cases passed again. Formatting and build pass.

Block-editing checks cover exact surrounding-source preservation, complete math /
code / list / table ranges, forged range rejection, local and shared undo, cancel,
mode/tab changes, session recovery, external-write conflict handling, keyboard
entry, narrow/dark layout, bulk image undo and a delayed import racing with typing.
The local editor changes only an authenticated Markdown source range. Raw HTML
blocks remain source-editor-only; this is not whole-document rich-text conversion.

The final packaged v0.1.16 EXE passes native editing, save-safety and export tests.
Image checks use the real picker/preload path, a synthetic clipboard File payload,
CDP file-backed drag/drop and decoded image dimensions. They do not touch the
user's clipboard or notes. Attachment checks use a Chinese/spaced PDF link and
intercept only the OS launch and confirmation, verifying routing without launching
a user's PDF reader. Unit checks cover cancellation, unsafe extensions, directories,
missing file associations and internal Markdown routing. Screenshots of the local
editor and native image workflow were inspected.

Images are copied beside a saved note, never moved; undo removes references but
retains copied files. Attachment launches require confirmation and use a bounded
type allowlist. Executables, scripts and shortcuts are not launched from notes.

## v0.1.15 editing tools and classic code colors

33 unit tests pass. The complete 90-test browser suite passed for the new toolbar;
after the relative-resource sanitizer correction, 30 focused parser/link/editor
tests passed, followed by all 6 editing tests with the final day/night editor
highlighting. The Vite dependency prebundler once exhausted memory during parallel
packaging; final editing checks ran separately with `RAYON_NUM_THREADS=2`.

Tests cover selected-text formatting, combined bold/italic, line/list conversions,
atomic undo/redo, cancelable link/code/table dialogs, bounded table sizes, cell
navigation, theme contrast, narrow toolbar layout and relative image destinations.
The image path test caught an existing unescaped hyphen in the URI allowlist that
discarded relative paths containing `/`; the standard escaped character class
preserves these paths without allowing executable URL schemes.

Native tests exercise the actual system-picker API (with a selected synthetic
PNG), exclusive attachment copying, actual image decoding, cancel, undo/redo,
save, standalone HTML/PDF export and save safety. Fixtures use isolated profiles
and temporary files, never user notes. Light/dark, narrow and native screenshots
were inspected. Image undo removes the Markdown reference, not its copied asset.
This is source/preview editing with formatting actions, not a rich-text editor.

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
