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
git clone https://github.com/Zhihua-Lee/marklore.git
cd marklore
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
$env:FOLIO_DATA_DIR = Join-Path $env:TEMP "marklore-dev"
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
| `pnpm test:native-gpu`          | 关闭 GPU 时照常显示。       |
| `pnpm test:native:all`          | 依次运行全部原生套件。      |
| `pnpm format:check`             | Prettier 格式检查。         |

浏览器测试通过 [playwright.config.mjs](../playwright.config.mjs) 启动 Vite，并使用本机 Microsoft Edge。原生测试使用合成笔记和隔离的临时目录，不应改用个人笔记进行自动化回归。

- 导航与滚动相关的用例会在 `default`（平滑滚动）和 `reduced-motion` 两个 Playwright 项目中各跑一次；新增此类用例时，把文件加入配置中的 `motionSpecs`。
- UI 用例通过 [tests/ui/fixtures.js](../tests/ui/fixtures.js) 模拟 `window.folio`：`installFolio(page)` 后用 `folioTest.mock({...})` 只写与本用例相关的方法。它与 `desktop/preload.cjs` 的接口列表保持一致（由单元测试校验），并按主进程的规则合并恢复草稿。
- 已有开发服务器时，设置 `FOLIO_BASE_URL`（如 `http://127.0.0.1:5173`）可跳过自动启动；`FOLIO_BROWSER_CHANNEL=""` 使用 Playwright 自带的 Chromium。

### 持续集成

[.github/workflows/ci.yml](../.github/workflows/ci.yml) 在 `windows-latest` 上对每次推送到 `main` 和每个 PR 运行格式检查、单元测试、第三方声明一致性检查、构建和浏览器测试。原生套件较慢，只在手动触发（`workflow_dispatch` 勾选 native）时运行。另有 `mac` 任务生成未签名的 macOS dmg，见下文“macOS 构建”。

具体版本执行了哪些测试，以 [VERIFICATION.md](../VERIFICATION.md) 为准。历史通过记录不代表后续提交已自动验证，也不代表所有个人笔记已通过人工验收。

## Windows 打包

```powershell
pnpm run notices
pnpm dist
```

`pnpm run notices` 生成第三方依赖声明；`pnpm dist` 构建前端并生成 Windows 目录包和安装包，分别输出为 `release/win-unpacked/` 和 `release/Marklore-Setup-vX.Y.Z-x64.exe`。安装包默认为当前用户安装（不需要管理员权限），可选安装目录；卸载时的注册清理见 `build/installer.nsh`。当前构建不做代码签名，也不自动发布到 GitHub Releases。

分发时保留整个目录，以及 Electron／Chromium 随附的许可文件。不要只复制 `Marklore.exe`。

打包时 [build/after-pack.cjs](../build/after-pack.cjs) 删去 Chromium 中 Marklore 用不到的部分：WebGPU 的着色器编译器（`dxcompiler.dll`、`dxil.dll`）和无 GPU 时的 Vulkan／软件 WebGL（`vk_swiftshader.dll`、`vk_swiftshader_icd.json`、`vulkan-1.dll`），共约 33 MB；同时删去开发时 Electron 写在 `node_modules/electron/dist` 里、会被复制进包的 `debug.log`（含本机路径）。页面有 GPU 时用 GPU 绘制，没有时用软件绘制，两者都不需要这些文件；图表用 canvas 2D。`tests/native-gpu.mjs` 以 `--disable-gpu` 启动打包后的程序，检查公式、表格和图表照常显示。安装包使用最高压缩（`compression: maximum`）。`Marklore.exe` 本身（约 235 MB）是 Chromium 与 Electron，无法再减。

验证打包后的程序：

```powershell
$env:FOLIO_TEST_EXE = (Resolve-Path ".\release\win-unpacked\Marklore.exe").Path
pnpm test:native
Remove-Item Env:FOLIO_TEST_EXE
```

## macOS 构建（试验）

CI 的 `mac` 任务在 `macos-latest` 上运行 `pnpm exec electron-builder --mac --publish never`，为 Apple 芯片（arm64）和 Intel（x64）各生成一个 dmg，作为工作流产物 `marklore-mac` 保留 14 天。在 Mac 上也可以本地运行同一命令。

- 只做临时签名（ad-hoc），未经 Apple 公证。第一次打开时 macOS 会拦截：先把 Marklore 拖进“应用程序”，再在“系统设置 → 隐私与安全性”中点“仍要打开”；也可以在终端运行 `xattr -dr com.apple.quarantine /Applications/Marklore.app`。
- 窗口保留系统的红绿灯按钮，嵌在工具栏左端；关闭窗口只是隐藏，程序留在程序坞里，用 ⌘Q 退出（未保存的笔记仍会先询问）。
- 文件关联来自 dmg 中的 Info.plist：`.md`/`.markdown` 由 Marklore 打开；`.diff`/`.patch` 只登记为备选，并且需要在设置里打开“其他格式”。
- Windows 专属的功能（托盘、开机启动、默认应用设置、便携模式）在 Mac 上不提供。原生测试套件目前只在 Windows 上运行。

### 应用内更新

`desktop/updater.mjs` 读取 `https://api.github.com/repos/Zhihua-Lee/marklore/releases/latest`，按固定的资产名下载：`Marklore-Setup-vX.Y.Z-x64.exe`（安装版）或 `Marklore-vX.Y.Z-win-x64.zip`（压缩包版，内含一个 `Marklore-vX.Y.Z-win-x64` 文件夹），并用 `SHA256SUMS-vX.Y.Z.txt` 校验。发布时这些名字不能变。

新版本与正在运行的程序使用同一个 Electron 时，两种版本都只下载应用文件 `Marklore-vX.Y.Z-app-electron-<Electron 版本>.zip`（约 3.5 MB，内含同名文件夹，只有 `resources/app.asar`、README、LICENSE 和第三方声明），而不是约 100 MB 的完整包。文件名里的 Electron 版本决定能否使用：版本不同、发布中没有这个文件或程序目录不可写时，照旧下载完整包。发布时用 `node tools/app-update.mjs <win-unpacked> <输出目录> [版本]` 生成，Electron 版本取自包内的 `version` 文件，并把它加入 `SHA256SUMS-vX.Y.Z.txt`。下载在单独的会话中进行，默认会话仍拦截所有网络请求。

校验通过后写入一个 PowerShell 辅助脚本并退出：脚本等旧进程结束，安装版运行 `Setup /S /currentuser --updated /D=<原目录>`，压缩包版用 `robocopy /E` 覆盖程序目录（不删除文件，便携 `data` 保留）；应用文件同样用 `robocopy` 覆盖，安装版随后把“应用和功能”中的版本改为新版本。然后重新启动 Marklore。下次启动时读取 `pending.json` 报告结果并删除下载；下载里有 `app.asar`，Electron 的 `fs` 会把它当作归档读，所以删除用 `original-fs`。`FOLIO_UPDATE_FEED` 可把查询指向本地测试服务；`tests/native-update.mjs` 用它端到端测试：压缩包版先用完整包、再用应用文件更新，安装版（`tools/installer-check.ps1 -Newer`）先用新安装包、再用应用文件更新。

### 发布与清理本地产物

版本发布到 GitHub Releases（安装包、win-x64 zip、应用文件 zip、source zip、`SHA256SUMS-vX.Y.Z.txt`）后，本地只需保留最近几个版本：

```powershell
pnpm prune-releases            # 预览：列出将被清理的项目
pnpm prune-releases --apply    # 移到回收站
```

默认保留最近 3 个版本的 zip／校验文件（`--keep N`）和最近 1 个版本的解包目录（`--keep-dirs N`）。只处理带版本号的项目；`release/win-unpacked` 等无版本号的输出不会被改动。清空回收站后才释放磁盘空间。

`package.json` 当前只将 README、LICENSE 和第三方声明作为额外文件复制到发行目录，不包含本仓库的 `docs/`。发行包中的 README 保留了基本运行说明；完整指南需在仓库内阅读。

## 源码结构

| 路径                                                                                                 | 职责                                                                 |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`desktop/main.mjs`](../desktop/main.mjs)、[`desktop/preload.cjs`](../desktop/preload.cjs)           | 窗口、隔离接口、文件监听与会话恢复。                                 |
| [`desktop/files.mjs`](../desktop/files.mjs)                                                          | 文件授权、编码、版本校验、备份与目录操作。                           |
| [`desktop/integration.mjs`](../desktop/integration.mjs)                                              | Windows 系统集成。                                                   |
| [`src/app.js`](../src/app.js)                                                                        | 文档状态、编辑器和交互协调。                                         |
| [`src/markdown.js`](../src/markdown.js)、[`src/positions.js`](../src/positions.js)                   | Markdown／公式解析、HTML 清理、源码映射与阅读锚点。                  |
| [`src/render-cache.js`](../src/render-cache.js)                                                      | 有界的近期预览 DOM 复用。                                            |
| [`src/tab-bar.js`](../src/tab-bar.js)、[`src/tab-groups.js`](../src/tab-groups.js)                   | 标签交互、排序与分组。                                               |
| [`src/editing.js`](../src/editing.js)、[`src/block-editing.js`](../src/block-editing.js)             | 源码格式工具与块级就地编辑。                                         |
| [`src/direct-editing.js`](../src/direct-editing.js)、[`src/direct-hosts.js`](../src/direct-hosts.js) | 在渲染后的笔记中直接编辑；每个块各自是编辑区，跨块的光标移动与选择。 |
| [`src/memory-release.js`](../src/memory-release.js)                                                  | 繁重渲染结束、页面安静后请主进程回收内存。                           |
| [`src/copy-source.js`](../src/copy-source.js)                                                        | 从阅读区复制对应的 Markdown 源码。                                   |
| [`src/link-preview.js`](../src/link-preview.js)                                                      | 链接悬浮预览与异步状态管理。                                         |
| [`src/export.js`](../src/export.js)、[`desktop/export.mjs`](../desktop/export.mjs)                   | 内容快照、离线资源嵌入和 PDF／HTML 导出。                            |
| [`tools/readme-media.mjs`](../tools/readme-media.mjs)                                                | 用示例笔记库重新生成 README 截图与动图（需要构建与 ffmpeg）。        |
| [`tests/`](../tests/)                                                                                | 单元、浏览器与原生回归用例。                                         |

渲染进程没有直接的 Node／文件系统访问权限，本地文件操作经过主进程的授权接口。新增渲染能力应保持 HTML 清理、图表限制和本地资源授权边界，不通过放开远程加载来解决展示问题。

长文相关改动需同时检查首次打开、编辑、切换模式／标签和阅读位置恢复。滚动路径上不要加非被动的 `wheel` 监听，也不要在滚动时逐次测量阅读锚点：渲染后的公式会让每次命中测试花费约 10 ms，直接造成滚轮卡顿（参见 `src/app.js` 中的滚动遮罩与 `src/table-layout.js` 的延迟锚点）。现有缓存减少重复工作，但首次解析仍有成本，不能仅凭小样本声称任意长文流畅。

直接编辑时，笔记本身不可编辑，每个顶层块（段落、标题、列表、引用、表格）各自是一个编辑区：浏览器处理一次按键的开销随编辑区大小增长，1800 行的笔记上从每键约 40 ms 降到约 20 ms。把整篇笔记临时设为可编辑会让整篇重新计算样式（约 0.3 s），所以不在两种方式之间切换。浏览器把光标和选区限制在一个编辑区内，跨块的方向键、Shift 选择、拖选、Shift+点击、Ctrl+A、Ctrl+Home/End、PageUp/PageDown 和块之间的点击由 `src/direct-hosts.js` 处理；跨块选区的复制与剪切写入完整内容（浏览器自己只会复制第一个块的部分）。给块加 CSS `contain` 在这种方式下测不出收益，加在列表等块上还会改变外边距，所以没有使用。

输入法组字（拼音尚未上屏）期间，后台工作不改动页面：Windows 会把组字附近文字的变化通知输入法，搜狗拼音等因此提前结束组字。`src/composing.js` 记录是否在组字；公式补排、表格列宽、图表插入、链接标记、悬停标记和内存回收在组字时推迟到结束后（`tests/ui/direct-edit.spec.js` 检查组字期间页面没有其他变化）。新增会改动页面的后台工作也要这样做。

源码窗格（CodeMirror）只测量屏幕附近的行，其余按字数估算高度；自动换行的长行（中文尤甚）估算偏低 20–45%，滚动时滚动条会不断变短、跳动。`src/editor-heights.js` 在空闲时分片把整篇滚一遍并测量（用 CodeMirror 未公开的同步 `view.measure()`），每片结束前把屏幕顶部那一行放回原处；之后估算误差在 3% 以内。笔记大改或宽度变化后重新测量。

长笔记渲染（公式、表格，尤其是 Mermaid 图）会留下大量垃圾，Chromium 要到内存紧张时才回收。页面出现超过 100 ms 的长任务后安静 5 秒且没有输入时，渲染进程请求主进程回收（`releaseMemory`）；主进程只在渲染进程超过 200 MB、且距上次至少 1 分钟时，通过调试接口执行 `HeapProfiler.collectGarbage`（V8 的低内存回收，同时整理 Blink 的堆）。1800 行的示例笔记上约减少 85–95 MB，耗时约 0.2 s。

## 文档维护

README 保留项目定位、核心功能和快速开始；操作细节放入[使用指南](user-guide.md)，构建和测试流程放在本文，版本验证结果写入 [VERIFICATION.md](../VERIFICATION.md)。不要把每次界面微调和修复说明追加为 README 的功能清单。

文档只描述所在分支已具备的行为，不将未合并 PR 写成已发布功能；版本号和命令以 `package.json` 为准。更新后检查链接、标题锚点、命令和代码围栏，可使用：

```powershell
pnpm exec prettier --check README.md docs/user-guide.md docs/development.md
```

## 分发前检查

自有代码与文档采用 MIT 许可证，第三方组件仍受各自许可证约束。公开分发前需核对 [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)、依赖、字体以及 Electron／Chromium 随包许可，并完成已有项目说明中列出的 Mermaid／elkjs（EPL-2.0）源码提供与告知事项检查。

本项目独立实现，不包含 MDLook 的实现、资源或二进制。不得从其他查看器提取字体或资源纳入发行包。
