# Folio Notes

[English](README.md) · 简体中文

**面向 Windows 的离线 Markdown 笔记应用：读得舒服，写得顺手，笔记始终是你自己的普通文件。**

[![CI](https://github.com/Zhihua-Lee/folio-notes/actions/workflows/ci.yml/badge.svg)](https://github.com/Zhihua-Lee/folio-notes/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Zhihua-Lee/folio-notes?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC)](https://github.com/Zhihua-Lee/folio-notes/releases/latest)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-285e50)

[安装](#安装) · [功能](#功能一览) · [快速上手](#快速上手) · [使用指南](docs/user-guide.md) · [开发指南](docs/development.md) · [验证记录](VERIFICATION.md)

![Folio Notes 阅读界面：左侧笔记库，中间渲染后的公式与表格，右侧本文目录](docs/images/overview.png)

在同一个工作区阅读、编辑和整理本地笔记：多标签与彩色分组组织材料，目录、链接预览和前进／后退历史穿梭长文，KaTeX 公式、代码高亮和 Mermaid 图表记录技术内容。笔记就是磁盘上的 `.md` 文件，不导入数据库、不上传云端。

界面支持中文与英文，默认跟随系统语言，可在 `Aa → 界面语言` 中切换。

## 安装

Folio Notes 是免安装的便携应用，无需管理员权限。

1. 打开 [Releases 最新版本](https://github.com/Zhihua-Lee/folio-notes/releases/latest)，下载 `Folio-Notes-vX.Y.Z-win-x64.zip`。
2. （可选）校验下载文件，将输出与同页 `SHA256SUMS-vX.Y.Z.txt` 中的对应行比对：
   ```powershell
   Get-FileHash .\Folio-Notes-vX.Y.Z-win-x64.zip -Algorithm SHA256
   ```
3. 将压缩包**完整解压**到任意目录，例如 `D:\Apps\Folio Notes`。保留同目录下的 DLL、`resources` 和 `locales`，不要只复制 EXE。
4. 运行 `Folio Notes.exe`。当前构建未代码签名，首次运行时 Windows SmartScreen 可能提示“未知发布者”，选择 **更多信息 → 仍要运行**。

**便携模式**：在 `Aa → 后台与系统 → 便携模式` 中开启后，标签、草稿、最近文件和设置保存在程序旁的 `data` 文件夹，整个文件夹（例如放在 U 盘中）可以带着状态随身使用。

**升级**：把新版本解压到新目录并从新目录启动即可，设置、恢复草稿和最近文件保存在用户数据目录中（便携模式下在 `data` 文件夹），不随程序目录走。确认新版本正常后删除旧目录；若启用过开机启动或 Markdown 关联，请在新版本的 `Aa → 后台与系统` 中重新注册。

**卸载**：删除程序目录；如需同时清除设置与恢复数据，再删除 `%APPDATA%\folio-notes`（其中包含明文草稿，请勿公开上传）。

想先看看效果？仓库中的[示例笔记库](docs/sample-notebook)包含公式、表格、代码、图表和互相链接的笔记，用 **打开文件夹** 选择它即可。

## 功能一览

### 长文导航：目录跳转一路平滑

点击目录，正文连续滚动到目标标题，沿途的公式与表格提前排好，不会一边翻一边跳。鼠标侧键或 `Alt+←`／`Alt+→` 在跳转历史中往返，回到离开时的准确位置。

![点击本文目录，正文平滑滚动到对应章节](docs/images/outline.gif)

### 链接悬浮预览：不离开当前位置

悬停本地 Markdown 链接即可在浮层中阅读目标段落，可滚动、选中和复制；需要时再点击打开，按 `Alt+←` 返回原处。

![悬停链接显示目标笔记的预览浮层，点击后打开，再用 Alt+← 返回](docs/images/preview.gif)

### 查找：在渲染正文中定位

`Ctrl+F` 在渲染后的正文中高亮所有匹配，`Enter` 逐个跳转；需要正则或替换时，一键交给源码编辑器的搜索面板。

![按 Ctrl+F 查找“卷积”，逐个跳到匹配处](docs/images/find.gif)

### 双栏编辑：左侧写源码，右侧实时预览

编辑模式下公式、表格和代码边写边渲染；也可以在预览里直接编辑单个段落。阅读区双击任意文字即可跳到对应源码。

![在编辑模式输入包含公式的句子，右侧预览实时渲染](docs/images/edit.gif)

### 更多

| 能力             | 说明                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| 复制为源码       | 从阅读区复制得到对应的 Markdown：公式是 `$…$`，链接带地址；`Ctrl+Shift+C` 复制渲染结果。       |
| 数学与技术写作   | KaTeX 公式、Mermaid 图表、代码语法高亮、可排序表格、可勾选任务列表和脚注。                     |
| 多文档工作区     | 可拖动标签、彩色分组、文件夹浏览和包含子目录的文件名筛选；起始页与任务栏跳转列表列出最近文件。 |
| 阅读外观         | 深浅主题、内置字体、字号与字重、可调侧栏和表格样式；标题栏与工具栏一体，支持全屏阅读。         |
| 平滑滚动（可选） | `Aa → 阅读导航 → 平滑滚动` 让触控板、滚轮和滚动条按屏幕刷新逐帧移动页面，速度更均匀。          |
| 本地保存与导出   | 显式保存、磁盘版本检查、备份与草稿恢复；导出 PDF 或离线单文件 HTML。                           |

![深色主题下的编辑模式：左侧 Markdown 源码，右侧渲染预览](docs/images/edit-dark.png)

## 快速上手

进入应用后，用 **打开文件** 选择 Markdown，或用 **打开文件夹** 添加笔记库；也可以直接把 Markdown 文件拖入窗口。`Ctrl+N` 新建笔记，`Ctrl+S` 保存。

| 模式 | 用途                                                          | 快捷键   |
| ---- | ------------------------------------------------------------- | -------- |
| 阅读 | 专注于渲染后的正文、目录、折叠和链接预览。                    | `Ctrl+1` |
| 编辑 | 左侧编辑 Markdown，右侧实时预览；也可在预览中编辑单个正文块。 | `Ctrl+2` |
| 源码 | 使用完整 Markdown 编辑器处理内容与结构。                      | `Ctrl+3` |

| 常用操作                  | 快捷键                          |
| ------------------------- | ------------------------------- |
| 查找／下一处              | `Ctrl+F`／`Enter` 或 `F3`       |
| 后退／前进                | `Alt+←`／`Alt+→`（或鼠标侧键）  |
| 复制为 Markdown／渲染结果 | `Ctrl+C`／`Ctrl+Shift+C`        |
| 调整字号                  | `Ctrl+滚轮`／`Ctrl++`／`Ctrl+-` |
| 全屏                      | `F11`                           |

三种模式共享同一份草稿，切换模式或标签保留阅读位置；`Aa` 集中管理字体、主题、侧栏、表格和后台设置。完整操作与快捷键见[使用指南](docs/user-guide.md)。

## 数据与隐私

**只有显式保存才写回 Markdown 原件。** 恢复草稿与工作区状态保存在本机；保存前检查磁盘版本，发现外部修改时提供冲突处理。图片附件放在笔记旁的 `assets` 目录，移动笔记时应一并保留。

应用不提供云同步、遥测或自动上传，远程图片不会自动下载。本机恢复数据包含明文草稿和文件路径，备份不自动过期；数据目录、容量限制及恢复方式见[保存与恢复](docs/user-guide.md#保存与恢复)。

## 兼容性

项目目前为 **Windows 桌面预览版**（Windows 10／11，x64）。复杂公式按 KaTeX 支持范围渲染；首次打开超长文档或大量公式／图表仍可能有明显开销。具体版本以 [package.json](package.json) 为准，已执行的测试及其范围见[验证记录](VERIFICATION.md)。

## 从源码运行

开发基线为 **Windows、Node.js 24、pnpm 11**。首次安装依赖需要联网，构建后的桌面应用可离线使用。以下操作面向仓库所有者及已获授权的使用者。

```powershell
git clone https://github.com/Zhihua-Lee/folio-notes.git
cd folio-notes
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`pnpm start` 启动 Electron 桌面应用；`pnpm dev` 仅启动浏览器 UI 演示，不提供原生文件访问。构建、测试与打包见[开发指南](docs/development.md)；README 中的截图和动图由 `node tools/readme-media.mjs` 从示例笔记库重新生成。

## 文档

| 文档                                  | 内容                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------- |
| [使用指南](docs/user-guide.md)        | 编辑、查找、复制、标签分组、链接、图片、导出、快捷键与故障排查。       |
| [开发指南](docs/development.md)       | 环境准备、开发流程、测试命令、Windows 打包与源码结构。                 |
| [验证记录](VERIFICATION.md)           | 按版本记录的回归检查、测试结果及验证边界。                             |
| [设计原则](docs/design-principles.md) | 独立实现、文档模型、定位、安全与阅读界面的设计原则及 v0.1.0 原始计划。 |
| [示例笔记库](docs/sample-notebook)    | 用于体验功能与生成 README 媒体的示例笔记。                             |
| [第三方声明](THIRD-PARTY-NOTICES.txt) | 依赖与字体的许可证文本。                                               |

发行目录未附完整指南时，请在[项目仓库](https://github.com/Zhihua-Lee/folio-notes)中阅读上述文档。

## 许可证

自有代码与文档采用 **All Rights Reserved** 声明，**不是开源许可**。第三方使用、修改或分发须取得权利人的单独书面许可；仓库访问权限本身不授予这些权限。完整条款见 [LICENSE](LICENSE)。

第三方组件、字体及 Electron／Chromium 运行时继续适用各自许可证。分发前的检查事项见[开发指南](docs/development.md#分发前检查)。
