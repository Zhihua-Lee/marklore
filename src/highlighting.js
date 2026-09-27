import { createBoundedCache } from "./bounded-cache.js";

// highlight.js (~186 KB with the extra grammars) loads on first use. Until then
// code renders as plain escaped text; onHighlighterReady lets the preview
// re-render once so blocks pick up their colors.
let hljs = null,
  loading = null;
const waiting = new Set();
export function loadHighlighter() {
  return (loading ??= Promise.all([
    import("highlight.js/lib/common"),
    import("highlight.js/lib/languages/cmake"),
    import("highlight.js/lib/languages/dart"),
    import("highlight.js/lib/languages/dockerfile"),
    import("highlight.js/lib/languages/julia"),
    import("highlight.js/lib/languages/latex"),
    import("highlight.js/lib/languages/matlab"),
    import("highlight.js/lib/languages/powershell"),
    import("highlight.js/lib/languages/scala"),
    import("highlight.js/lib/languages/groovy"),
    import("highlight.js/lib/languages/haskell"),
    import("highlight.js/lib/languages/r"),
  ]).then(([common, ...grammars]) => {
    const library = common.default;
    // Keep the curated common bundle, adding scientific/desktop languages rather
    // than shipping every grammar or running expensive auto-detection on each block.
    const names = [
      "cmake",
      "dart",
      "dockerfile",
      "julia",
      "latex",
      "matlab",
      "powershell",
      "scala",
      "groovy",
      "haskell",
      "r",
    ];
    grammars.forEach((grammar, i) => {
      if (!library.getLanguage(names[i]))
        library.registerLanguage(names[i], grammar.default);
    });
    hljs = library;
    for (const callback of waiting) callback();
    waiting.clear();
  }));
}
export const highlighterReady = () => hljs !== null;
export function onHighlighterReady(callback) {
  if (hljs) callback();
  else waiting.add(callback);
}
// Cheap pre-check for callers that must render synchronously after loading.
export const mayContainCode = (text) => /^ {0,3}(```|~~~)/m.test(text);

const aliases = new Map([
  ["c++", "cpp"],
  ["c#", "csharp"],
  ["jsx", "javascript"],
  ["tsx", "typescript"],
  ["zsh", "bash"],
  ["sh", "bash"],
  ["ps1", "powershell"],
  ["tex", "latex"],
  ["docker", "dockerfile"],
  ["jl", "julia"],
]);
const cache = createBoundedCache();
export const MAX_HIGHLIGHT_CHARS = 100000;
export function highlightCode(code, language = "") {
  const requested = language.trim().toLowerCase();
  const name = aliases.get(requested) || requested;
  if (!name || code.length > MAX_HIGHLIGHT_CHARS) return "";
  if (!hljs) {
    loadHighlighter();
    return "";
  }
  // markdown-it escapes the original text when the callback returns an empty string.
  if (!hljs.getLanguage(name)) return "";
  const key = name + "\0" + code;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const value = hljs.highlight(code, {
      language: name,
      ignoreIllegals: true,
    }).value;
    cache.set(key, value);
    return value;
  } catch {
    return "";
  }
}
