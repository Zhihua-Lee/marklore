// electron-builder afterPack: leave out Chromium's parts that Marklore never
// uses, before the installer and the zip are made (about 33 MB on Windows).
// - dxcompiler.dll, dxil.dll: the shader compiler for WebGPU.
// - vk_swiftshader.dll, vk_swiftshader_icd.json, vulkan-1.dll: Vulkan and
//   software WebGL for machines without a usable GPU.
// Pages are drawn with the GPU when there is one and in software otherwise;
// neither needs these. Diagrams use canvas 2D. tests/native-gpu.mjs starts
// the packaged app with the GPU off to check.
// Also debug.log: Electron writes one beside electron.exe when it runs from
// node_modules during development, with local paths in it, and the package
// is copied from there.
const fs = require("node:fs");
const path = require("node:path");

const unused = [
  "dxcompiler.dll",
  "dxil.dll",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
  "debug.log",
];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  for (const name of unused)
    fs.rmSync(path.join(context.appOutDir, name), { force: true });
};
