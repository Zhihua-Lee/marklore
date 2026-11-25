// In-memory back end with a sample notebook (OneNote-export style), for
// developing and testing the interface without a Microsoft account.
// Query flags: ?mock (signed in, synced), ?mock=empty (signed in, no folder yet),
// ?mock=signedout, ?mock=unconfigured (no application ID).
import { leadingHeading } from "../desktop/note-names.mjs";

const curve = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><rect width="320" height="160" fill="#eef3f1"/><path d="M10 150 C 80 10, 160 10, 310 140" stroke="#246d5d" stroke-width="4" fill="none"/><text x="20" y="30" font-size="18" fill="#246d5d">f(x)</text></svg>`;

const longNote = [
  "# 长笔记：实分析习题",
  "",
  ...Array.from({ length: 40 }, (_, i) => [
    `## 第 ${i + 1} 题`,
    "",
    `设 $f_${i + 1}(x) = x^{${i + 1}}$，讨论它在 $[0, 1]$ 上的一致收敛性。这一段文字用来撑开页面，检查滚动位置和大纲跳转是否准确。`,
    "",
    "- 先求逐点极限；",
    "- 再估计 $\\sup |f_n - f|$。",
    "",
  ]).flat(),
].join("\n");

export const SAMPLE = {
  "_目录.md": `# 数学分析

- [第一章 实数](第一章%20实数/_目录.md)
  - [确界原理](第一章%20实数/确界原理.md)
  - [实数的完备性](<第一章 实数/实数的完备性.md>)
- [一致收敛](一致收敛.md)
- [长笔记：实分析习题](长笔记.md)
- [English notes](English%20notes.md)
`,
  "第一章 实数/_目录.md": `# 第一章 实数

- [确界原理](确界原理.md)
- [实数的完备性](实数的完备性.md)
`,
  "第一章 实数/确界原理.md": `# 确界原理

非空有上界的实数集必有**上确界**。

## 上确界

设 $E \\subset \\mathbb{R}$ 非空且有上界，则存在 $\\sup E$。

## 下确界

对称地，非空有下界的集合有下确界 $\\inf E$。

返回 [一致收敛](../一致收敛.md#weierstrass-判别法)。
`,
  "第一章 实数/实数的完备性.md": `# 实数的完备性

柯西序列在 $\\mathbb{R}$ 中收敛。见 [确界原理](确界原理.md#上确界)。
`,
  "一致收敛.md": `---
notebook: 数学分析
section: 函数列
---

# 一致收敛

设 $\\{f_n\\}$ 是定义在区间 $I$ 上的函数列。若对任意 $\\varepsilon > 0$，存在 $N$，使得当 $n > N$ 时对一切 $x \\in I$ 都有 $|f_n(x) - f(x)| < \\varepsilon$，则称 $f_n$ **一致收敛**于 $f$。

$$
\\sup_{x \\in I} |f_n(x) - f(x)| \\to 0 \\quad (n \\to \\infty)
$$

![函数图像](images/curve.svg)

## Weierstrass 判别法

若 $|u_n(x)| \\le M_n$ 且 $\\sum M_n$ 收敛，则级数一致收敛。参见 [确界原理](第一章%20实数/确界原理.md)。

| 性质 | 逐点收敛 | 一致收敛 |
| --- | --- | --- |
| 保持连续性 | 否 | 是 |
| 可逐项积分 | 不一定 | 是 |

\`\`\`python
def sup_gap(f, g, xs):
    return max(abs(f(x) - g(x)) for x in xs)
\`\`\`

> 一致收敛是"整体地"接近，逐点收敛只是"每一点"接近。
`,
  "长笔记.md": longNote,
  "English notes.md": `# English notes

Uniform convergence preserves continuity. See [一致收敛](一致收敛.md).
`,
};
const IMAGES = { "images/curve.svg": curve };

const states = new Map();
const store = (key) => `marklore-mock:${key}`;

export function createMock(
  flag = new URLSearchParams(location.search).get("mock"),
) {
  const synced = !flag;
  let files = synced ? { ...SAMPLE } : {};
  const listeners = {
    change: new Set(),
    status: new Set(),
    progress: new Set(),
  };
  const urls = new Map();
  let status = {
    configured: flag !== "unconfigured",
    signedIn: flag !== "signedout" && flag !== "unconfigured",
    user: "测试用户",
    folder: synced
      ? { id: "f-notes", name: "数学笔记", path: "/数学笔记" }
      : null,
    syncing: false,
  };
  let lastSync = synced ? Date.now() - 3600_000 : null;
  const emit = (kind, value) => listeners[kind].forEach((fn) => fn(value));
  const on = (kind) => (fn) => (
    listeners[kind].add(fn),
    () => listeners[kind].delete(fn)
  );
  const titleOf = (path, text) =>
    leadingHeading(text)?.title || path.split("/").pop().replace(/\.md$/i, "");

  const library = {
    async info() {
      return lastSync === null
        ? null
        : {
            folderName: status.folder?.name || "",
            lastSync,
            notes: Object.keys(files).length,
            images: Object.keys(IMAGES).length,
          };
    },
    async list() {
      return Object.keys(files)
        .sort()
        .map((path) => ({
          path,
          title: titleOf(path, files[path]),
          modified: Date.now() - 86_400_000,
          size: files[path].length,
        }));
    },
    async text(path) {
      return files[path] ?? null;
    },
    async asset(path) {
      if (!(path in IMAGES) || lastSync === null) return null;
      if (!urls.has(path))
        urls.set(
          path,
          URL.createObjectURL(
            new Blob([IMAGES[path]], { type: "image/svg+xml" }),
          ),
        );
      return urls.get(path);
    },
    async search(query, { limit = 50 } = {}) {
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const hits = [];
      for (const [path, text] of Object.entries(files)) {
        const lower = text.toLowerCase();
        if (!words.every((w) => lower.includes(w))) continue;
        const lines = text.split("\n");
        const line = lines.findIndex((l) => l.toLowerCase().includes(words[0]));
        hits.push({
          path,
          title: titleOf(path, text),
          snippet: lines[line].slice(0, 120),
          line,
        });
        if (hits.length >= limit) break;
      }
      return hits;
    },
    state: {
      async get(key, fallback = null) {
        const raw = localStorage.getItem(store(key));
        return raw === null ? (states.get(key) ?? fallback) : JSON.parse(raw);
      },
      async set(key, value) {
        states.set(key, value);
        localStorage.setItem(store(key), JSON.stringify(value));
      },
    },
    onChange: on("change"),
  };

  const tree = {
    null: [
      { id: "f-notes", name: "数学笔记", path: "/数学笔记", childCount: 5 },
      { id: "f-docs", name: "文档", path: "/文档", childCount: 2 },
    ],
    "f-notes": [
      {
        id: "f-ch1",
        name: "第一章 实数",
        path: "/数学笔记/第一章 实数",
        childCount: 3,
      },
    ],
    "f-docs": [],
    "f-ch1": [],
  };
  const account = {
    status: () => ({ ...status }),
    onStatus: on("status"),
    setClientId() {
      status = { ...status, configured: true };
      emit("status", account.status());
    },
    signIn() {
      status = { ...status, signedIn: true, configured: true };
      emit("status", account.status());
    },
    signOut() {
      status = { ...status, signedIn: false };
      emit("status", account.status());
    },
    async folders(parentId) {
      return tree[parentId ?? "null"] ?? [];
    },
    async chooseFolder(folder) {
      status = { ...status, folder };
      emit("status", account.status());
      return account.sync();
    },
    async sync() {
      status = { ...status, syncing: true };
      emit("status", account.status());
      const names = Object.keys(SAMPLE);
      emit("progress", { phase: "listing", done: 0, total: 0, message: "" });
      for (let i = 0; i < names.length; i++) {
        await new Promise((r) => setTimeout(r, 30));
        emit("progress", {
          phase: "downloading",
          done: i + 1,
          total: names.length,
          message: names[i],
        });
      }
      const added = Object.keys(SAMPLE).filter((p) => !(p in files)).length;
      files = { ...SAMPLE };
      lastSync = Date.now();
      status = { ...status, syncing: false };
      emit("progress", {
        phase: "done",
        done: names.length,
        total: names.length,
        message: "",
      });
      emit("status", account.status());
      emit("change", null);
      return { added, changed: names.length - added, removed: 0 };
    },
    onProgress: on("progress"),
  };
  return { library, account };
}
