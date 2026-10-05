import test from "node:test";
import assert from "node:assert/strict";
import {
  MATH,
  protectedSpans,
  safeWindow,
  safeTruncate,
} from "../desktop/snippet.mjs";

const cut = (text, start, end, options) => {
  const [a, b] = safeWindow(text, start, end, options);
  return text.slice(a, b);
};

test("prices are not formulas; formulas are", () => {
  const found = (s) => [...s.matchAll(MATH)].map((m) => m[0]);
  assert.deepEqual(found("costs $5 and $10 today"), []);
  assert.deepEqual(found("energy $E=mc^2$ and $$\\int f$$"), [
    "$E=mc^2$",
    "$$\\int f$$",
  ]);
});

test("a window never cuts a formula, code, link, tag or emphasis", () => {
  const text =
    'before $\\hat f(\\omega)=\\int f(t)e^{-i\\omega t}dt$ middle `a_b` **bold words** [link text](a.md#x) <span style="color:red">red</span> after';
  for (let start = 0; start < text.length; start += 3)
    for (let end = start + 1; end <= text.length; end += 7) {
      const piece = cut(text, start, end);
      // Whatever survives is balanced.
      assert.equal((piece.match(/(?<!\\)\$/g) || []).length % 2, 0, piece);
      assert.equal((piece.match(/`/g) || []).length % 2, 0, piece);
      assert.equal((piece.match(/\*\*/g) || []).length % 2, 0, piece);
      assert.equal(
        (piece.match(/<span/g) || []).length,
        (piece.match(/<\/span>/g) || []).length,
        piece,
      );
      if (piece.includes("](")) assert.match(piece, /\[link text\]\(a\.md#x\)/);
    }
});

test("long spans at an edge are left out unless they hold the hit", () => {
  const long = "$" + "x+".repeat(200) + "x$";
  const text = "start " + long + " the hit here";
  const hit = text.indexOf("hit");
  // The window starts inside the long formula: it is left out.
  assert.equal(
    cut(text, hit - 20, hit + 10, { keep: [hit, hit + 3] }),
    " the hit here",
  );
  // A hit inside it keeps it whole.
  const inside = text.indexOf("x+x+") + 10;
  assert.equal(
    cut(text, inside - 5, inside + 5, { keep: [inside, inside + 1] }),
    long,
  );
});

test("display math and LaTeX environments across lines stay whole", () => {
  const text =
    "Text $$\na^2+b^2\n$$ and \\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned} end";
  const spans = protectedSpans(text).map(([a, b]) => text.slice(a, b));
  assert.ok(spans.includes("$$\na^2+b^2\n$$"));
  assert.ok(
    spans.includes("\\begin{aligned} x &= 1 \\\\ y &= 2 \\end{aligned}"),
  );
  assert.equal(cut(text, 8, 12), "$$\na^2+b^2\n$$");
});

test("labels are truncated outside formulas", () => {
  assert.equal(safeTruncate("short", 40), "short");
  assert.equal(
    safeTruncate(
      "定义（傅里叶变换 $\\hat f(\\omega)$）与它的逆变换，以及后续的很多说明文字",
      20,
    ),
    "定义（傅里叶变换 $\\hat f(\\omega)$…",
  );
  const label = "Theorem " + "$" + "a+".repeat(60) + "a$ holds";
  assert.equal(safeTruncate(label, 20), "Theorem…");
});
