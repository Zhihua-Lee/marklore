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
