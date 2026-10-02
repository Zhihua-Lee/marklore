# 开发指南

[返回 README](../README.md) · [使用指南](user-guide.md) · [验证记录](../VERIFICATION.md)

本指南面向参与开发的人。自有代码与文档采用 MIT 许可证，见 [LICENSE](../LICENSE)。

## 环境准备

| 工具       | 项目开发基线                                              |
| ---------- | --------------------------------------------------------- |
| 操作系统   | Windows；当前桌面打包目标为 Windows 目录包。              |
| Node.js    | 24                                                        |
| pnpm       | 11                                                        |
| 浏览器测试 | Microsoft Edge；Playwright 配置使用 `channel: "msedge"`。 |

依赖版本由 [package.json](../package.json) 与 [pnpm-lock.yaml](../pnpm-lock.yaml) 管理。首次安装和 Electron 下载需要联网；日常使用不依赖网络服务。

```powershell
git clone https://github.com/Zhihua-Lee/folio-notes.git
cd folio-notes
pnpm install --frozen-lockfile
```

依赖安装失败时先检查锁定版本与下载环境，不要为绕过安装错误随意改写锁文件。

## 开发流程

### 桌面应用

```powershell
pnpm build
pnpm start
```

前端构建输出到 `dist/`，Electron 从 `desktop/main.mjs` 启动。修改前端后重新构建并启动；修改主进程或 preload 后需要重启桌面应用。

需要隔离配置与草稿时，可在启动前指定数据目录，例如：

```powershell
$env:FOLIO_DATA_DIR = Join-Path $env:TEMP "folio-notes-dev"
pnpm start
Remove-Item Env:FOLIO_DATA_DIR
```

使用单独目录，不要与日常应用或其他运行实例共享。移除环境变量不会删除该目录中的数据。

### 浏览器 UI

```powershell
pnpm dev
```

该服务用于界面开发与浏览器测试，不提供原生文件访问或桌面导出。它不能代替 Electron 原生验证。

## 测试

在仓库根目录运行。修改涉及桌面渲染内容时，先执行 `pnpm build`，确保原生测试使用最新前端。

| 命令                            | 覆盖范围                    |
| ------------------------------- | --------------------------- |
| `pnpm test`                     | Node 单元测试。             |
| `pnpm test:ui`                  | Playwright 浏览器交互回归。 |
| `pnpm test:native`              | Electron 桌面基础流程。     |
| `pnpm test:native-safety`       | 原生文件操作安全。          |
| `pnpm test:native-menu`         | 原生菜单与相关入口。        |
| `pnpm test:native-export`       | 桌面 PDF／HTML 导出。       |
| `pnpm test:native-background`   | 托盘、后台与恢复行为。      |
| `pnpm test:native-drop-copy`    | 拖入文件与代码复制。        |
| `pnpm test:native-editing`      | 桌面编辑流程。              |
| `pnpm test:native-navigation`   | 系统前进／后退与阅读位置。  |
| `pnpm test:native-image-access` | 本地图片授权与错误说明。    |
| `pnpm test:native:all`          | 依次运行全部原生套件。      |
| `pnpm format:check`             | Prettier 格式检查。         |

浏览器测试通过 [playwright.config.mjs](../playwright.config.mjs) 启动 Vite，并使用本机 Microsoft Edge。原生测试使用合成笔记和隔离的临时目录，不应改用个人笔记进行自动化回归。

- 导航与滚动相关的用例会在 `default`（平滑滚动）和 `reduced-motion` 两个 Playwright 项目中各跑一次；新增此类用例时，把文件加入配置中的 `motionSpecs`。
- UI 用例通过 [tests/ui/fixtures.js](../tests/ui/fixtures.js) 模拟 `window.folio`：`installFolio(page)` 后用 `folioTest.mock({...})` 只写与本用例相关的方法。它与 `desktop/preload.cjs` 的接口列表保持一致（由单元测试校验），并按主进程的规则合并恢复草稿。
- 已有开发服务器时，设置 `FOLIO_BASE_URL`（如 `http://127.0.0.1:5173`）可跳过自动启动；`FOLIO_BROWSER_CHANNEL=""` 使用 Playwright 自带的 Chromium。

### 持续集成

[.github/workflows/ci.yml](../.github/workflows/ci.yml) 在 `windows-latest` 上对每次推送到 `main` 和每个 PR 运行格式检查、单元测试、第三方声明一致性检查、构建和浏览器测试。原生套件较慢，只在手动触发（`workflow_dispatch` 勾选 native）时运行。

具体版本执行了哪些测试，以 [VERIFICATION.md](../VERIFICATION.md) 为准。历史通过记录不代表后续提交已自动验证，也不代表所有个人笔记已通过人工验收。

## Windows 打包

```powershell
pnpm run notices
pnpm dist
```

`pnpm run notices` 生成第三方依赖声明；`pnpm dist` 构建前端并生成 Windows 目录包，输出为 `release/win-unpacked/`。当前构建不做代码签名，也不自动发布到 GitHub Releases。

分发时保留整个目录，以及 Electron／Chromium 随附的许可文件。不要只复制 `Folio Notes.exe`。

验证打包后的程序：

```powershell
$env:FOLIO_TEST_EXE = (Resolve-Path ".\release\win-unpacked\Folio Notes.exe").Path
pnpm test:native
Remove-Item Env:FOLIO_TEST_EXE
```

### 发布与清理本地产物

版本发布到 GitHub Releases（win-x64 zip、source zip、`SHA256SUMS-vX.Y.Z.txt`）后，本地只需保留最近几个版本：

```powershell
pnpm prune-releases            # 预览：列出将被清理的项目
pnpm prune-releases --apply    # 移到回收站
```

默认保留最近 3 个版本的 zip／校验文件（`--keep N`）和最近 1 个版本的解包目录（`--keep-dirs N`）。只处理带版本号的项目；`release/win-unpacked` 等无版本号的输出不会被改动。清空回收站后才释放磁盘空间。

`package.json` 当前只将 README、LICENSE 和第三方声明作为额外文件复制到发行目录，不包含本仓库的 `docs/`。发行包中的 README 保留了基本运行说明；完整指南需在仓库内阅读。

## 源码结构

| 路径                                                                                       | 职责                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [`desktop/main.mjs`](../desktop/main.mjs)、[`desktop/preload.cjs`](../desktop/preload.cjs) | 窗口、隔离接口、文件监听与会话恢复。                          |
| [`desktop/files.mjs`](../desktop/files.mjs)                                                | 文件授权、编码、版本校验、备份与目录操作。                    |
| [`desktop/integration.mjs`](../desktop/integration.mjs)                                    | Windows 系统集成。                                            |
| [`src/app.js`](../src/app.js)                                                              | 文档状态、编辑器和交互协调。                                  |
| [`src/markdown.js`](../src/markdown.js)、[`src/positions.js`](../src/positions.js)         | Markdown／公式解析、HTML 清理、源码映射与阅读锚点。           |
| [`src/render-cache.js`](../src/render-cache.js)                                            | 有界的近期预览 DOM 复用。                                     |
| [`src/tab-bar.js`](../src/tab-bar.js)、[`src/tab-groups.js`](../src/tab-groups.js)         | 标签交互、排序与分组。                                        |
| [`src/editing.js`](../src/editing.js)、[`src/block-editing.js`](../src/block-editing.js)   | 源码格式工具与块级就地编辑。                                  |
| [`src/copy-source.js`](../src/copy-source.js)                                              | 从阅读区复制对应的 Markdown 源码。                            |
| [`src/link-preview.js`](../src/link-preview.js)                                            | 链接悬浮预览与异步状态管理。                                  |
| [`src/export.js`](../src/export.js)、[`desktop/export.mjs`](../desktop/export.mjs)         | 内容快照、离线资源嵌入和 PDF／HTML 导出。                     |
| [`tools/readme-media.mjs`](../tools/readme-media.mjs)                                      | 用示例笔记库重新生成 README 截图与动图（需要构建与 ffmpeg）。 |
| [`tests/`](../tests/)                                                                      | 单元、浏览器与原生回归用例。                                  |

渲染进程没有直接的 Node／文件系统访问权限，本地文件操作经过主进程的授权接口。新增渲染能力应保持 HTML 清理、图表限制和本地资源授权边界，不通过放开远程加载来解决展示问题。

长文相关改动需同时检查首次打开、编辑、切换模式／标签和阅读位置恢复。滚动路径上不要加非被动的 `wheel` 监听，也不要在滚动时逐次测量阅读锚点：渲染后的公式会让每次命中测试花费约 10 ms，直接造成滚轮卡顿（参见 `src/app.js` 中的滚动遮罩与 `src/table-layout.js` 的延迟锚点）。现有缓存减少重复工作，但首次解析仍有成本，不能仅凭小样本声称任意长文流畅。

## 文档维护

README 保留项目定位、核心功能和快速开始；操作细节放入[使用指南](user-guide.md)，构建和测试流程放在本文，版本验证结果写入 [VERIFICATION.md](../VERIFICATION.md)。不要把每次界面微调和修复说明追加为 README 的功能清单。

文档只描述所在分支已具备的行为，不将未合并 PR 写成已发布功能；版本号和命令以 `package.json` 为准。更新后检查链接、标题锚点、命令和代码围栏，可使用：

```powershell
pnpm exec prettier --check README.md docs/user-guide.md docs/development.md
```

## 分发前检查

自有代码与文档采用 MIT 许可证，第三方组件仍受各自许可证约束。公开分发前需核对 [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)、依赖、字体以及 Electron／Chromium 随包许可，并完成已有项目说明中列出的 Mermaid／elkjs（EPL-2.0）源码提供与告知事项检查。

本项目独立实现，不包含 MDLook 的实现、资源或二进制。不得从其他查看器提取字体或资源纳入发行包。
