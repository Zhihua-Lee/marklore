import { test, expect } from "@playwright/test";
import { cases } from "./reading-enhancements-cases.js";

for (const name of Object.keys(cases)) {
  test(name, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (name) => {
      const { cases } = await import("/tests/ui/reading-enhancements-cases.js");
      return cases[name]();
    }, name);
    if (result)
      test.info().annotations.push({
        type: "measurement",
        description: JSON.stringify(result),
      });
  });
}

test("renderer authenticates lazy math and preserves complete eager export", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { renderMarkdown } = await import("/src/markdown.js").then(
      async (m) => (await m.loadMath(), m),
    );
    const { createPreviewCache } = await import("/src/render-cache.js");
    const source = Array.from({ length: 220 }, (_, i) => `$$x_{${i}}^2$$`).join(
      "\n\n",
    );
    const lazy = renderMarkdown(
      source + '\n\n<span data-folio-math="falseinjected">raw</span>',
      null,
      { deferMath: true },
    );
    const eager = renderMarkdown(source);
    const forged = lazy.fragment.querySelectorAll(
      '[data-folio-math="falseinjected"]',
    ).length;
    const pending = lazy.fragment.querySelectorAll("[data-folio-math]").length;
    const cache = createPreviewCache(),
      host = document.createElement("article");
    document.body.append(host);
    cache.update(host, "note", lazy.html, lazy.fragment, {
      hydrate: lazy.hydrate,
      bytes: lazy.bytes,
    });
    lazy.hydrate.flush();
    const hydrated = host.querySelectorAll(".katex").length;
    const result = {
      pending,
      forged,
      hydrated,
      eager: eager.fragment.querySelectorAll(".katex").length,
    };
    cache.clear();
    host.remove();
    return result;
  });
  expect(result).toEqual({
    pending: 220,
    forged: 0,
    hydrated: 220,
    eager: 220,
  });
});

test("mainstream and scientific grammars, aliases and safe long-code fallback", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { highlightCode, MAX_HIGHLIGHT_CHARS } =
      await import("/src/highlighting.js").then(
        async (m) => (await m.loadHighlighter(), m),
      );
    const samples = {
      javascript: "const value = 42;",
      typescript: "const value: number = 42;",
      python: "def f(x): return 42",
      java: "public class Test {}",
      cpp: "int main() { return 0; }",
      "c#": "public class Test {}",
      go: 'package main\nfunc main() { println("ok") }',
      rust: "fn main() { let x = 1; }",
      sql: "SELECT * FROM users WHERE id = 1;",
      bash: 'echo "$HOME"',
      json: '{"value": 42}',
      css: "body { color: red; }",
      html: "<p>hello</p>",
      yaml: "value: true",
      kotlin: "fun main() { val x = 1 }",
      swift: "let x = 42",
      ruby: "def hello; puts 'hi'; end",
      php: '<?php echo "hi";',
      matlab: "function y = square(x)\ny = x.^2;\nend",
      julia: "function square(x)\nreturn x^2\nend",
      r: "function(x) { return(42) }",
      latex: "\\frac{a}{b}",
      powershell: 'Write-Host "$env:PATH"',
      dockerfile: "FROM node:22\nRUN echo hello",
      cmake: "cmake_minimum_required(VERSION 3.20)",
      dart: "void main() { print('hello'); }",
      scala: "object Main { val x = 1 }",
      haskell: "module Main where\nx = 42",
      groovy: "def value = 42",
      JSX: "const value = <div>hi</div>;",
      ps1: 'Write-Host "ok"',
      tex: "\\alpha",
    };
    return {
      missing: Object.entries(samples)
        .filter(([lang, code]) => !highlightCode(code, lang).includes("hljs-"))
        .map(([lang]) => lang),
      long: highlightCode("x".repeat(MAX_HIGHLIGHT_CHARS + 1), "python"),
      unknown: highlightCode("<script>alert(1)</script>", "unknown-language"),
    };
  });
  expect(results).toEqual({ missing: [], long: "", unknown: "" });
});
