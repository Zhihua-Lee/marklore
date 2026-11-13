import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ":has()" on something that holds the note makes every node put into the
// note (a formula drawn, a review's mark, a keystroke) restyle all of it:
// on a long note that is a tenth of a second each time. Such states are
// kept as classes or attributes by the scripts instead.
const holders =
  /(?:^|[\s,>+~(])(?:html|body|:root|main|#app|#panes|#reader|#content|#rich|\.workspace|\.prose|\.ProseMirror|\.note-section|\.section-body)(?:[.#[:][^\s,>+~(]*)?:has\(/;

function sheets(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory()
      ? sheets(file)
      : entry.name.endsWith(".css")
        ? [file]
        : [];
  });
}

test("no style asks what the whole note holds", () => {
  const found = [];
  for (const file of sheets("src")) {
    // An exported page is not written to after it is drawn.
    if (path.basename(file) === "export.css") continue;
    const text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of text.matchAll(/([^{}]+)\{/g)) {
      const selector = rule[1].replace(/\s+/g, " ").trim();
      if (holders.test(selector))
        found.push(`${path.basename(file)}: ${selector}`);
    }
  }
  assert.deepEqual(found, []);
});
