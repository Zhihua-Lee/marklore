// A synthetic library for benchmarks and comparison tests: notes in nested
// folders with headings, Markdown and wiki links, anchors, code, formulas,
// tables and Chinese text. The same seed gives the same notes on any system.
//   node tools/synthetic-library.mjs <folder> [notes=5000]
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "the of and theorem lemma proof measure integral bound sample risk learning kernel matrix vector space norm convex function gradient descent operator spectrum eigenvalue random variable expectation variance estimator consistency rate network layer training loss data model inference posterior prior likelihood entropy divergence martingale process brownian diffusion fourier series transform basis projection hilbert banach compact dense closed open set sequence limit converge uniform pointwise".split(
    " ",
  );
const RARE = ["zyzzogeton", "quillwort", "xenolith"];
const CJK =
  "定理 引理 证明 测度 积分 上界 样本 风险 学习 核函数 矩阵 向量 空间 范数 凸函数 梯度 下降 算子 谱 特征值 随机变量 期望 方差 估计量 一致性 收敛 网络 训练 损失 数据 模型 推断 后验 先验 似然 熵 散度 鞅 过程 布朗运动 傅里叶 级数 变换 基 投影 希尔伯特 紧集 稠密 闭集 开集 序列 极限 一致收敛".split(
    " ",
  );

export const DIRS = 50;
export const noteName = (i) =>
  i % 97 === 5 ? `Note ${i} Q&A.md` : `note-${String(i).padStart(4, "0")}.md`;
export const noteDir = (i) =>
  i % DIRS < 10
    ? `area-${i % DIRS}`
    : `area-${i % DIRS}/sub-${Math.floor(i / DIRS) % 3}`;
export const notePath = (root, i) => path.join(root, noteDir(i), noteName(i));

function relLink(from, to) {
  const rel = path.posix.relative(
    noteDir(from).split(path.sep).join("/"),
    noteDir(to).split(path.sep).join("/"),
  );
  const name = noteName(to);
  const file = rel ? `${rel}/${name}` : name;
  return /[ &]/.test(name) ? encodeURI(file).replace(/&/g, "%26") : file;
}

export function noteText(i, total) {
  const rnd = random(i * 7919 + 13);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
  const cjk = (n) => Array.from({ length: n }, () => pick(CJK)).join("");
  const target = () =>
    // A few popular notes collect many backlinks.
    rnd() < 0.15 ? Math.floor(rnd() * 10) : Math.floor(rnd() * total);
  const headings = [];
  const lines = [`# ${words(3)} ${i}`, ""];
  const sections = 3 + Math.floor(rnd() * 6);
  for (let s = 0; s < sections; s++) {
    const h = `${words(2)} ${cjk(2)}`;
    headings.push(h);
    if (rnd() < 0.2) lines.push(`<a id="anchor-${i}-${s}"></a>`, "");
    lines.push(`## ${h}`, "");
    const paragraphs = 1 + Math.floor(rnd() * 4);
    for (let p = 0; p < paragraphs; p++) {
      const kind = rnd();
      if (kind < 0.08) {
        lines.push(
          "```python",
          `x = ${words(2).replace(/ /g, "_")}  # [not a link](note-0001.md)`,
          "```",
          "",
        );
        continue;
      }
      if (kind < 0.14) {
        lines.push(
          `| ${words(1)} | ${cjk(1)} | $x_${s}$ |`,
          "| --- | --- | --- |",
          `| ${words(2)} | [${cjk(1)}](${relLink(i, target())}) | ${words(1)} |`,
          "",
        );
        continue;
      }
      const sentences = [];
      const n = 2 + Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) {
        const r = rnd();
        if (r < 0.25) {
          const t = target();
          const frag = rnd() < 0.3 ? `#${words(1)}-${cjk(1)}` : "";
          sentences.push(
            `${words(4)} [${words(2)}](${relLink(i, t)}${frag}) ${words(3)}.`,
          );
        } else if (r < 0.35)
          sentences.push(
            `${words(3)} [[note-${String(target()).padStart(4, "0")}]] ${words(2)}.`,
          );
        else if (r < 0.55) sentences.push(`${cjk(6)}，${cjk(5)}。`);
        else if (r < 0.62)
          sentences.push(`**${words(2)}** $\\sum_{k} a_k^{${s}}$ ${words(4)}.`);
        else if (r < 0.64)
          sentences.push(
            `${words(3)} \`${words(1)}\` ${pick(RARE)} ${words(2)}.`,
          );
        else if (r < 0.66)
          sentences.push(
            `see [web](https://example.com/${words(1)}) and ![img](pic-${i}.png) 🙂.`,
          );
        else if (r < 0.68)
          sentences.push(
            `[same note](#${headings.length ? headings[0].toLowerCase().replace(/ /g, "-") : "x"}) ${words(2)}.`,
          );
        else sentences.push(`${words(8 + Math.floor(rnd() * 10))}.`);
      }
      const prefix = rnd() < 0.15 ? "- " : rnd() < 0.05 ? "> " : "";
      lines.push(prefix + sentences.join(" "), "");
    }
  }
  return lines.join(i % 11 === 0 ? "\r\n" : "\n");
}

export async function writeLibrary(root, total = 5000) {
  await fs.rm(root, { recursive: true, force: true });
  const dirs = new Set();
  for (let i = 0; i < total; i++) dirs.add(noteDir(i));
  for (const d of dirs) await fs.mkdir(path.join(root, d), { recursive: true });
  // Software folders the walk skips.
  await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(
    path.join(root, "node_modules", "pkg", "README.md"),
    "# pkg\n",
  );
  for (let i = 0; i < total; i++)
    await fs.writeFile(
      notePath(root, i),
      (i % 13 === 0 ? "﻿" : "") + noteText(i, total),
    );
  return root;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [root, total = "5000"] = process.argv.slice(2);
  if (!root) throw Error("usage: synthetic-library.mjs <folder> [notes]");
  await writeLibrary(path.resolve(root), Number(total));
  console.log(`wrote ${total} notes to ${path.resolve(root)}`);
}
