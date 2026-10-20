# Marklore

## Purpose

Marklore is a desktop Markdown knowledge base built on Electron, for reading, editing and linking local notes. It runs on Windows; macOS support is in progress.

## Layout

- `src/`: renderer (Vite), with the tab bar, Markdown rendering, block editing and export.
- `desktop/`: Electron main process, preload, file access, OS integration and locales (`desktop/locales/en-*.mjs`).
- `tests/`: unit tests (`*.test.mjs`), native suites (`native-*.mjs`) and Playwright UI specs (`tests/ui`).
- `tools/`: icons, licenses, i18n check, native-suite runner, installer check.
- `build/`: installer script and icons.
- `docs/`: user guide, development guide, design principles, verification records.

## Conventions

- Interface text is wrapped as `t("中文原文")`, with its English in `desktop/locales/en-*.mjs`. `tools/i18n-check.mjs` fails on anything missed.
- UI changes follow `docs/design-principles.md`.
- Format with Prettier (`pnpm format`).
- Commits use the GitHub noreply address.
- Release notes are bilingual: English first, then 简体中文.

## Commands

- Build: `pnpm build`, then `pnpm start`.
- Unit tests: `pnpm test`.
- UI tests: `pnpm dev` (127.0.0.1:5179), then `pnpm test:ui` with `FOLIO_BASE_URL` set.
- Native suites: `pnpm test:native:all` (`FOLIO_TEST_EXE` points them at a packaged build).

## Sensitive data

- Never run tests against the real user profile (`%APPDATA%\Marklore`). Use `FOLIO_DATA_DIR` or the test fixtures.
- Media and logs must not show personal paths.

## Project context

Working notes for agents (`HANDOFF.md`: current state and next steps; `decisions.md`: dated decisions) are kept outside this repository by the owner's tooling.

- Before starting, read the handoff (a session-start hook loads it). If it disagrees with the files, trust the files and correct the handoff.
- Before ending substantial work, rewrite the handoff (under about 60 lines) and append lasting decisions, dated, to `decisions.md` next to it. Then tell the user the full path of each file written.
- Never write secrets or personal data about other people into these notes; point to where such data lives.
