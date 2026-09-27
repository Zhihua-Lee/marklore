# Reading performance and interactions

This change extends the existing preview, not a second renderer or UI. No dependencies or lockfile versions are changed.

## Rendering

`renderMarkdown(..., { deferMath: true })` now stores TeX and authenticated placeholders without eagerly running KaTeX. For notes over 80,000 characters or 200 formulas, `createFormulaHydrator` expands formulas within 600px of the vertical viewport, yielding after an 8ms soft budget or 32 formulas. A single formula cannot be preempted. Small notes retain synchronous hydration after reconciliation. Missing IntersectionObserver falls back to complete hydration.

The preview cache owns hydration activation/deactivation; old jobs are stopped when switching, releasing or evicting tabs. Restoring a cached preview resumes unresolved markers. `beforeprint` flushes all remaining formulas. Standalone HTML/PDF export uses the existing eager renderer and does not depend on scrolling through the document. Existing KaTeX limits, sanitization, trust=false and MathML output are retained.

Sibling matching uses stable source-skeleton identities and FIFO duplicate matching, so insertion/deletion no longer invalidates every following paragraph. Source range snapshots, rather than the current visual row order, update reused DOM after edits. Extra retained previews remain byte/document bounded; deferred formulas are conservatively charged for future expansion.

Long-note blocks are not virtualized: v0.1.25 removed the earlier screen-only `content-visibility` rule, because its estimated off-screen heights made outline and link jumps land short and it measured no clear gain on 250k-character notes (see `src/preview-performance.css`). The whole DOM stays laid out for source mapping and browser search. While an outline or link jump is scrolling (`navigateToAnchor` / `navigationMoving` in `src/positions.js`), lazy formula expansion and table width work pause so the path keeps its measured height; the navigation then verifies and corrects its landing, and keeps its target through late layout until another scroll or user input takes over. Inline source-location searches are bounded to their enclosing block. Table width probes skip unresolved math and distant tables, and resume after scrolling/hydration. Markdown parsing itself remains synchronous; this is not a claim that arbitrary-sized files have constant-time opening.

## Tabs and code

Ungrouped tabs use a neutral surface derived from the theme's own ink (`--ink` mixed 5% into `--panel`) with no border, a stronger 9% mix on hover or focus, and when active a 14% accent tint with an accent bottom border, in both themes (see the end of `src/tab-bar.css`). Existing group colors remain separate.

The existing highlight.js common bundle is extended with CMake, Dart, Dockerfile, Groovy, Haskell, Julia, LaTeX, MATLAB, PowerShell, R and Scala. Aliases include JSX/TSX, C++/C#, sh/zsh, ps1 and tex. Code fences need a language tag; unlabelled/unknown languages stay safely escaped plain text rather than using expensive automatic detection. Derived highlight strings have a 128-entry/4MiB LRU. Blocks over 100,000 characters use escaped plain text to bound synchronous highlighting work.

Code wraps by default, with a per-block toggle. Blocks over 30 lines or 4,000 characters initially collapse, with explicit expand/collapse controls. Copy always uses the entire code node's text. Source navigation with expansion reveals folded code. Mermaid keeps its existing diagram controls and is not folded/wrapped as ordinary code. Print/export do not clip folded code.

## Tables

Regular tables with a single header row get a focusable native ↕ sort button in each header cell; only that button sorts (`wireSortableTables` in `src/table-sort.js`). Header text stays selectable, and double-clicking it enters editing at its source like other text. Repeated activation cycles ascending, descending and original order. Numeric columns support signs, scientific notation, grouped thousands, currency and percentages; other columns use natural text comparison. Empty cells stay last and ties retain original order. Bodies sort independently; footer and column-width nodes remain intact.

Sorting only moves live row nodes in the preview: it never rewrites Markdown. Source offsets stay attached to their rows, including after text is inserted above the table. Single-cell selection editing stays precise. Cross-cell selections touching a sorted table do not expose a potentially non-contiguous source edit range. Nested/merged-cell or irregular-header tables are deliberately excluded.

## Verification

Executed in the implementation environment:

- `node --test tests/reading-data.test.mjs`: 5/5 passed (numeric/text ordering and bounded caches).
- All 8 cases exported by `tests/ui/reading-enhancements-cases.js`: passed in isolated headless Chromium using the actual component modules and CSS, with local module URLs rewritten to data URLs because browser loopback navigation was unavailable.
- `node --check` for the added/modified JavaScript and test files: passed.

The Chromium cases cover insertion/deletion and duplicate reuse, LRU release, sorting/source offsets, full code copy and fold/wrap/navigation, viewport hydration, tab cancellation/restoration, bounded batching, print flushing, fallback hydration and tab colors. A 1,200-block prepend retained all original nodes with one child mutation (about 20ms in this harness). A 1,000-placeholder scheduling fixture initially expanded 16 nearby markers; batches did not exceed 32. The formula callback in these isolated scheduling tests is a lightweight DOM substitute, **not KaTeX**, so these numbers are not an end-to-end formula benchmark.

Not executed here: the pinned dependency build, the full existing Playwright suite, the two new real-parser/grammar integration cases, and native Windows/Electron checks. Dependency download/network access was unavailable. Run after installing the repository's pinned dependencies:

```sh
pnpm test
pnpm test:ui tests/ui/reading-enhancements.spec.js tests/ui/performance.spec.js tests/ui/math-compat.spec.js tests/ui/table-layout.spec.js tests/ui/block-editing.spec.js
pnpm build
```

Before release, also check a real large formula-heavy note for heading jumps/scroll anchoring, a sorted table followed by an edit above it, both tab themes, and HTML/PDF export without first visiting the document's end.

Later, v0.1.25 ran the full suites: all 48 unit tests and 131 browser cases (Edge), and all nine native suites on the packaged app, including smooth-scroll jump regressions on lazy long notes and table header interaction. See [docs/verification/v0.1.25.md](verification/v0.1.25.md) for scope and limits.
