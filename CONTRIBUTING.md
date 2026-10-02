# Contributing

English · [简体中文](#参与贡献)

Thanks for your interest. Marklore is maintained by one person in spare time, so replies may take a while.

## What the project is

A Markdown knowledge base for Windows in which reading, editing and linking notes happen in one place. Notes stay plain `.md` files on your disk, so people, scripts and AI tools can all create and maintain them directly.

Not planned:

- a database, a proprietary format or any import step for notes;
- accounts, cloud sync or telemetry run by the app (external sync tools such as OneDrive keep working on the files);
- macOS or Linux builds, for now.

## Issues

Bug reports, questions and suggestions are welcome. For a bug, please include:

- the Marklore version (the release you downloaded, e.g. `v0.1.42`) and your Windows version;
- steps to reproduce it, what you expected and what happened;
- a small Markdown sample if the problem is about rendering. Please remove anything private first.

## Pull requests

- **Open an issue first** for anything larger than a small fix, so we can agree on whether and how to do it before you spend time on code.
- Changes that conflict with the scope above, or would be hard to maintain, may be declined even when they work. You are always free to keep them in your own fork.
- Keep each pull request to one topic, and match the style of the surrounding code.

Before opening a pull request, run:

```bash
pnpm install
pnpm format:check
pnpm test
pnpm build
pnpm test:ui
```

CI runs the same checks. The native Electron suites (`pnpm test:native:all`) are slower and optional. Setup, architecture and the release flow are described in the [development guide](docs/development.md) (in Chinese).

**Interface text:** wrap each new string as `t("中文原文")` from `desktop/i18n.mjs`, and add its English to `desktop/locales/en-*.mjs`. `pnpm test` fails on untranslated text.

By submitting a contribution you agree that it is licensed under the project's [MIT License](LICENSE).

---

## 参与贡献

感谢关注。Marklore 由一个人利用业余时间维护，回复可能比较慢。

**项目定位**：一个 Windows 上的 Markdown 知识库，阅读、编辑和笔记互链都在同一个软件里完成。笔记始终是磁盘上的普通 `.md` 文件，人、脚本和 AI 工具都能直接创建和维护。

**暂不考虑**：

- 数据库、私有格式或需要导入的笔记存储；
- 由软件提供的账号、云同步或遥测（OneDrive 等外部同步工具照常可用）；
- 目前不做 macOS 或 Linux 版本。

**Issue**：欢迎报告问题、提问和提建议。报告问题时请写明：版本号（下载的发行版，如 `v0.1.42`）和 Windows 版本；复现步骤、预期结果和实际结果；与渲染有关的问题请附一小段 Markdown 示例，并先去掉隐私内容。

**Pull Request**：

- 除小修复外，**请先开 Issue 讨论**，确认要不要做、怎么做，再动手写代码。
- 与上面的定位冲突、或难以长期维护的改动，即使能正常运行也可能不被合并；你可以在自己的 fork 中保留它们。
- 每个 PR 只做一件事，代码风格与周围保持一致。
- 提交前请运行上面列出的检查命令；CI 会执行同样的检查。
- 界面文字请用 `t("中文原文")` 包裹，并在 `desktop/locales/en-*.mjs` 中补上英文。

提交贡献即表示你同意按本项目的 [MIT 许可证](LICENSE) 授权你的贡献。
