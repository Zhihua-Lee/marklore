# Verification

Last updated 2026-09-29.

This index lists what was checked for each documented release; the full record of
each pass lives in [docs/verification/](docs/verification/). A recorded pass covers
only that release as described: it does not mean later commits were verified
automatically, nor that every personal note has been accepted by hand (see
[docs/development.md](docs/development.md#测试)).

## How to record a release

Add `docs/verification/vX.Y.Z.md` with the release title as its H1, then add a row
at the top of the table below. Keep each part short and state counts exactly.

```markdown
# vX.Y.Z short title

## Changes

What changed and what was reproduced or measured to confirm it.

## Automated checks

Unit and browser (Playwright/Edge) results, e.g. "All N unit tests and M browser
cases pass"; name failures, their cause and any rerun.

## Manual/native checks

Native suites run (source build or packaged EXE), screenshots inspected, fixtures
used (synthetic notes, isolated profiles).

## Limits

What was not exercised or is not claimed.
```

## Releases

Counts appear only where the release record states them; "—" means no explicit
count is given there (the checks may still be described in prose). Browser runs
that were partial or overlapping are shown as passed/total and are not summed.

| Version | Summary                                                              | Unit              | Browser (UI)                   | Native                                                          | Link                                    |
| ------- | -------------------------------------------------------------------- | ----------------- | ------------------------------ | --------------------------------------------------------------- | --------------------------------------- |
| v0.1.41 | English interface, portable mode, new Settings, clearer selected tab | 67                | 164 (default + reduced-motion) | 11 suites (packaged)                                            | [v0.1.41](docs/verification/v0.1.41.md) |
| v0.1.36 | Tabs clickable again; optional smooth scrolling                      | 60                | 157 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.36](docs/verification/v0.1.36.md) |
| v0.1.34 | Steadier link previews and formula backfill                          | 59                | 154 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.34](docs/verification/v0.1.34.md) |
| v0.1.33 | Window controls, copy as Markdown, smoother scrolling                | 59                | 153 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.33](docs/verification/v0.1.33.md) |
| v0.1.32 | New app mark: M book, D mug handle                                   | 59                | 148 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.32](docs/verification/v0.1.32.md) |
| v0.1.31 | Hover previews survive layout corrections                            | 59                | 148 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.31](docs/verification/v0.1.31.md) |
| v0.1.30 | Find hands off to the editor's search                                | 59                | 147 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.30](docs/verification/v0.1.30.md) |
| v0.1.29 | Find, clickable tasks, recent files                                  | 59                | 146 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.29](docs/verification/v0.1.29.md) |
| v0.1.28 | Continuous jump glide with idle backfill                             | 56                | 142 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.28](docs/verification/v0.1.28.md) |
| v0.1.27 | Jumps render their destination first                                 | 56                | 141 (default + reduced-motion) | 9 suites (packaged)                                             | [v0.1.27](docs/verification/v0.1.27.md) |
| v0.1.26 | Robustness, lazy math/code, CI                                       | 56                | 139 (131 + 8 reduced-motion)   | 9 suites (packaged)                                             | [v0.1.26](docs/verification/v0.1.26.md) |
| v0.1.25 | Reading regressions after #1                                         | 48                | 131                            | 9 suites (packaged)                                             | [v0.1.25](docs/verification/v0.1.25.md) |
| v0.1.24 | Derived-tab group closure, interruptible easing                      | 43                | 22                             | 1 suite: navigation (packaged)                                  | [v0.1.24](docs/verification/v0.1.24.md) |
| v0.1.23 | Continuous group contours, inline-math selection                     | 41 (+1 added)     | 47/48, then 17/17 rerun        | 3 suites: editing, navigation, export (packaged)                | [v0.1.23](docs/verification/v0.1.23.md) |
| v0.1.22 | Formula-heavy editing, coordinated tab surfaces                      | 41                | 117/119, then 28/28 rerun      | 3 suites: editing, export, navigation (packaged)                | [v0.1.22](docs/verification/v0.1.22.md) |
| v0.1.21 | Long-document performance, group indicators                          | 41                | 45/46, then 22/22 and 17/17    | 3 suites: export, navigation, editing (packaged)                | [v0.1.21](docs/verification/v0.1.21.md) |
| v0.1.20 | Preview selection tools, read-to-edit location                       | 41                | 37, then 18 (overlapping)      | 1 suite: editing (packaged)                                     | [v0.1.20](docs/verification/v0.1.20.md) |
| v0.1.19 | Tab groups, reading navigation, disclosure feedback                  | 41                | 12, 41, 32 (separate runs)     | 4 suites: navigation, editing/attachments, save safety, export  | [v0.1.19](docs/verification/v0.1.19.md) |
| v0.1.18 | Compact color controls, table styles, hover feedback                 | 36                | 25/26, then 12/12              | 4 suites: editing, export, image access, save safety (packaged) | [v0.1.18](docs/verification/v0.1.18.md) |
| v0.1.17 | Text colors, grouped tools, local image diagnostics                  | 36                | 33/34, then 9/9                | 4 suites: image access, editing, export, save safety (packaged) | [v0.1.17](docs/verification/v0.1.17.md) |
| v0.1.16 | Block editing, image insertion, attachment links                     | 34                | 97/99, then 18/18              | 3 suites: editing, save safety, export (packaged)               | [v0.1.16](docs/verification/v0.1.16.md) |
| v0.1.15 | Editing tools, classic code colors                                   | 33                | 90, then 30 and 6              | —                                                               | [v0.1.15](docs/verification/v0.1.15.md) |
| v0.1.3  | Reading controls, fonts, copied math, export                         | 19                | 59                             | —                                                               | [v0.1.3](docs/verification/v0.1.3.md)   |
| v0.1.2  | Typography, layout, interaction                                      | 18 (file-service) | 48                             | 1 suite: menu (source and packaged)                             | [v0.1.2](docs/verification/v0.1.2.md)   |
| v0.1.1  | Product interface                                                    | —                 | 35                             | smoke (source); packaged hover rerun not passed                 | [v0.1.1](docs/verification/v0.1.1.md)   |
| v0.1.0  | Baseline                                                             | 18 (file-service) | 32                             | smoke (source and packaged), safety probe                       | [v0.1.0](docs/verification/v0.1.0.md)   |

Versions v0.1.4–v0.1.14 have no verification record.
