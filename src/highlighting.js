import hljs from "highlight.js/lib/common";
import cmake from "highlight.js/lib/languages/cmake";
import dart from "highlight.js/lib/languages/dart";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import julia from "highlight.js/lib/languages/julia";
import latex from "highlight.js/lib/languages/latex";
import matlab from "highlight.js/lib/languages/matlab";
import powershell from "highlight.js/lib/languages/powershell";
import scala from "highlight.js/lib/languages/scala";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import r from "highlight.js/lib/languages/r";
import { createBoundedCache } from "./bounded-cache.js";

// Keep the curated common bundle, adding scientific/desktop languages rather
// than shipping every grammar or running expensive auto-detection on each block.
for (const [name, grammar] of Object.entries({
  cmake, dart, dockerfile, julia, latex, matlab, powershell, scala, groovy, haskell, r,
})) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, grammar);
}
const aliases = new Map([
  ["c++", "cpp"], ["c#", "csharp"], ["jsx", "javascript"], ["tsx", "typescript"],
  ["zsh", "bash"], ["sh", "bash"], ["ps1", "powershell"], ["tex", "latex"],
  ["docker", "dockerfile"], ["jl", "julia"],
]);
const cache = createBoundedCache();
export const MAX_HIGHLIGHT_CHARS = 100000;
export function highlightCode(code, language = "") {
  const requested = language.trim().toLowerCase();
  const name = aliases.get(requested) || requested;
  // markdown-it escapes the original text when the callback returns an empty string.
  if (!name || !hljs.getLanguage(name) || code.length > MAX_HIGHLIGHT_CHARS) return "";
  const key = name + "\0" + code;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const value = hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
    cache.set(key, value);
    return value;
  } catch {
    return "";
  }
}
