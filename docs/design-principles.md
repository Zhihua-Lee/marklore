# Design principles

[README](../README.md) · [User guide](user-guide.md) · [Development](development.md) · [Verification](../VERIFICATION.md)

These principles started as the v0.1.0 acceptance plan (preserved in the
[appendix](#original-v010-plan)). Its targets are now implemented, and later
features such as tab groups, block editing, reading history and PDF/HTML export
were built on the same rules. New work should keep to them.

## Independent implementation

Folio Notes is an independent implementation. No MDLook code, templates, binaries,
fonts or other assets are inputs; requirements come from the user's workflow, not
from another viewer. Fonts and dependencies ship only from their upstream packages,
with license notices in the distribution.

## Files and documents

- Notes stay plain Markdown files. Only an explicit save writes the original;
  drafts and workspace state are recovery data, not saves.
- Each open file has one document model: its tabs, editor history, dirty baseline
  and reading position share it. Read, edit and source modes are views of the same
  draft.
- Saves are version-checked against the disk and replace the file atomically with a
  backup. External changes refresh saved documents and raise a conflict instead of
  overwriting unsaved edits. Size limits fail loudly rather than truncating drafts.
- Editing tools change Markdown source, never a separate rich-text model. Block and
  selection editing only touch a source range that maps exactly; anything else falls
  back to the source editor.

## Positions and navigation

- Switching modes, tabs or layout preserves a source-backed reading anchor, and
  late layout (images, formulas, tables) must not move it.
- Double-click locates between preview and source in both directions. Plain text
  aims for exact positions; formulas, diagrams and complex HTML locate by block.
  Formula glyph-level precision is never advertised.
- Hover previews, scrolling and other passive reading do not change the current
  tab, reading progress or navigation history.

## Security and local access

- The renderer has no Node or file-system access. Native operations go through
  authorized file handles in the main process.
- Author HTML is always sanitized; math runs without trust; remote resources are
  not fetched automatically. Hover previews and image access stay within the
  authorized scope, and widening it is an explicit user choice.
- Executables, scripts and shortcuts are never launched from notes.

## Reading surface

- A quiet, dense notebook desk: compact navigation and browser-like tabs, no brand
  billboard, a warm neutral reading surface with a restrained teal accent.
- Text stays sharp: size changes (50–200%) are native text-size changes, never CSS
  zoom or raster scaling, and article text has no animated scale or transform.
  Motion follows the system reduced-motion setting.
- Chinese text is a first-class case in fonts, weight and math sizing.

## Performance claims

Caching and deferred work may reduce repeated cost, but first parsing of a long
note still costs time. Performance statements name what was measured and where;
no claim of constant-time opening or of lag-free arbitrary-length documents.

## Testing

Regression tests use synthetic notes and isolated profiles, covering disk safety,
parser security, positions and UI. Personal notes are never used as fixtures or
modified by tests. Each release's actual checks and limits are recorded in
[VERIFICATION.md](../VERIFICATION.md).

## Runtime trade-off

Electron costs more bundle size and memory than WebView2; it is kept for a
reproducible, isolated desktop runtime. CodeMirror holds editor state,
markdown-it produces source-mapped blocks, and KaTeX renders math offline.

## Original v0.1.0 plan

The original `PLAN.md`, kept verbatim for history. Its "acceptance targets" were
the v0.1.0 goals; see the sections above for how they apply now.

```markdown
# Independent rewrite

No upstream MDLook implementation, templates, binaries or assets are inputs to this
project. Requirements derive from the user's workflow, not copied implementation.
The existing viewer and private patch archive remain untouched.

## Acceptance targets

1. Runnable source and offline Windows distribution with license notices.
2. One document model per file: tabs, editor history, dirty baseline and location.
3. Notebook tree, internal Markdown links and anchors, reveal in Explorer.
4. CommonMark/GFM-style notes, math, code, details, local images/GIF, selectable text.
5. Read/Edit/Source preserve a source-backed anchor, including delayed image layout.
6. Bidirectional double-click positioning; never advertise formula glyph precision.
7. Event-driven external refresh and version-checked saves, unsaved recovery.
8. Sharp native-size text, 50–200% scale, compact browser-like tabs, CJK readability.
9. Synthetic regression tests for disk safety, parser security, positions and UI.
10. Scoped local Markdown hover previews, precise heading/line anchors, unsaved-tab priority,
    no current-tab/progress mutations, keyboard operation and stale-response cancellation.

## Direction

A quiet, dense notebook desk: compact file navigation, no brand billboard; warm
neutral reading surface, restrained teal accent, strong Chinese text, no animated
text transforms. Native text-size changes rather than CSS zoom/scale.

Electron has a larger bundle/memory cost than WebView2, traded for a reproducible
isolated desktop runtime. CodeMirror holds editor state; markdown-it produces mapped
blocks; KaTeX is offline. Renderer has no filesystem/Node access. Native APIs use
opaque authorized file handles, sanitize content, and guard saves against disk changes.
```
