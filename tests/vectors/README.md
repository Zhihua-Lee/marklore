# Test vectors

Marklore's rules for names, links, folder indexes, AI proposals, marks and
settings, stated as plain data: an input and the output it must give. They
are meant to be checked by any implementation of these rules, in any
language. `tests/vectors.test.mjs` checks them against the JavaScript one
(`pnpm test` runs it).

## Files

Each JSON file holds one rule. Its path below this folder, without `.json`,
names the rule (`note-names/safe-base`, `folder-index/operations`); the data
never names a function, a class, a parser's tokens or an editor's positions.

```json
{
  "about": "What the rule does, what input holds and what expected is.",
  "platform": "win32",
  "cases": [
    {
      "name": "reserved name",
      "why": "Optional: why the case is there or what it pins.",
      "input": { "name": "CON" },
      "expected": "CON_"
    }
  ]
}
```

- `about` describes the rule, the fields of `input` and the form of
  `expected`. Read it first: it is the specification; the cases are its
  examples and edge cases.
- `name` is unique in its file. `why` is optional.
- `platform` (on a file or a case) limits it to one platform, as Node.js
  names them (`win32`, `darwin`, `linux`); a runner on another platform
  skips it. It is used where the rule depends on how the platform resolves
  paths.
- `expected` is compared as JSON values: object keys in any order, arrays
  in order, numbers by value. `null` means "nothing": no heading, no change,
  not found.
- Every string is well-formed Unicode (no lone surrogate), so the files can
  be read by any JSON parser into native strings.

| Folder            | Rules                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `note-names`      | A note's name from its leading heading, plain text of a heading, safe Windows file names (full-width forms, reserved names, trailing dots, length), numbering, front-matter titles, renaming, "unify names". |
| `slug`            | Heading anchors, repeats.                                                                                                                                                                                    |
| `folder-index`    | Index files (`_目录.md`, `SUMMARY.md`): parsing entries and nesting, the order they give, every edit operation, new indexes.                                                                                 |
| `link-rewrite`    | Rewriting links and anchors after notes, folders or headings are renamed or moved; which destinations count; paths.                                                                                          |
| `proposal-edits`  | Placing an AI proposal's edits, changed ranges, word splitting (CJK), word-level revisions, line diffs.                                                                                                      |
| `comment-anchors` | A mark's quote with its context, and finding it again after the note changed.                                                                                                                                |
| `ai-store`        | JSON Schemas (`schemas/`) of the files in the data folder's `ai` folder, with valid and invalid examples; when a proposal lapses; marks file names; a proposal's note after a move.                          |
| `settings`        | Reading stored user settings back (defaults, coercion, migrations) and the desktop preferences.                                                                                                              |

## Positions

Where a rule gives or takes a place in a text, it is `{ "line", "column" }`:

- both count from 1;
- lines end at `"\n"`; a `"\r"` before it is the last column of its line;
- columns count Unicode code points (an emoji is one column, as is a CJK
  character), not UTF-16 code units or bytes.

A range is given by its start and its text (`at` and `added`, `oldAt` and
`removed`), or by `from` and `to` (end exclusive). Array indexes (an edit's
number in `proposal-edits/locate`, an entry's `parent` in
`folder-index/parse`) count from 0. Index entries named by line
(`{ "line": 3 }` in `folder-index/operations`) use the same line numbers.

A few rules count in UTF-16 code units because Windows or the stored format
does; their `about` says so: the length cap of file names
(`note-names/safe-base`), the 32 units of context around a mark
(`comment-anchors`), the character-level comparison of
`proposal-edits/changed-ranges`, and offsets stored in `context.json`.

## Texts

Texts are given exactly, line endings and a byte order mark (`\uFEFF`)
included. Rules that read notes as the app does (`proposal-edits`,
`note-names/unify-plan`) take `"\n"` line endings and no byte order mark,
because the app normalises a note when it reads it; their `about` says so.
Rules that edit a file in place (`note-names/set-name`,
`folder-index/operations`) keep its line endings and byte order mark.

## Paths

Paths in inputs are absolute and use any of `C:/…`, `C:\…`, `/…` (POSIX)
or `//server/share/…`; the link rules compare them without regard to
letter case or separator. Outputs use `/` unless the rule says it keeps the
separators it was given.

## Writing a runner

For each file: read `about`, map the rule's path to your implementation,
and for each case (skipping other platforms) turn `input` into a call,
convert positions as above, and compare the result with `expected`. Keep
the conversion in the runner; do not change the data to suit an
implementation. `note-names/unify-plan` lists a folder: build it in a
temporary folder from `input.files` (`"name/"` is an empty folder), keeping
its path short (the file-name cap depends on the folder's path length, see
`about`). `ai-store/marks-file` needs the platform's path resolution.

`ai-store/schemas/*.schema.json` are JSON Schema draft 2020-12 and use only
`$ref` (to `#/$defs/…`), `type`, `enum`, `const`, `properties`,
`required`, `additionalProperties`, `items`, `minItems`, `maxItems`,
`uniqueItems`, `minLength`, `maxLength` (in code points), `pattern`,
`minimum`, `maximum`, `oneOf` and `anyOf`; `format` is an annotation only.
They describe what the current version writes (closed: no other keys); a
reader should still accept keys it does not know, from other versions.
The JavaScript runner also checks that files written by the app and the MCP
server satisfy them.

## Adding cases

Add the case without `expected` and run the JavaScript runner with
`VECTORS_FILL=1`: it writes the current result into cases that have none
and leaves the rest alone. Read what it wrote before keeping it, then run
Prettier on the file. A case that pins behaviour nobody relies on, or that
looks wrong, says so in `why`.
