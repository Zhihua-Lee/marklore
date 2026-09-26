import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore } from "../desktop/files.mjs";
import { buildExportDocument, createExporter } from "../desktop/export.mjs";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
test("standalone export embeds licensed fonts/images, preserves notes and guards destinations", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "folio-export-unit-"));
  try {
    const dist = path.join(temp, "dist"),
      assets = path.join(dist, "assets");
    await fs.mkdir(assets, { recursive: true });
    const fontDir = path.join(project, "node_modules/katex/dist/fonts");
    for (const name of await fs.readdir(fontDir))
      if (name.endsWith(".woff2"))
        await fs.copyFile(
          path.join(fontDir, name),
          path.join(assets, name.replace(".woff2", "-test.woff2")),
        );
    await fs.copyFile(
      path.join(project, "THIRD-PARTY-NOTICES.txt"),
      path.join(temp, "THIRD-PARTY-NOTICES.txt"),
    );
    const source = path.join(temp, "source.md"),
      output = path.join(temp, "note.html");
    await fs.writeFile(source, "ORIGINAL NOTE");
    await fs.writeFile(
      path.join(temp, "image.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="teal"/></svg>',
    );
    const files = new FileStore(),
      doc = await files.open(source);
    const payload = {
      format: "html",
      name: "source.md",
      fileId: doc.id,
      html: '<h1>UNSAVED DRAFT</h1><img src="folio-export-image:12345678-1234-1234-1234-123456789012">',
      css: await fs.readFile(
        path.join(project, "node_modules/katex/dist/katex.min.css"),
        "utf8",
      ),
      images: [
        { key: "12345678-1234-1234-1234-123456789012", path: "image.svg" },
      ],
      warnings: [],
    };
    const rendered = await buildExportDocument(payload, files, dist);
    assert.match(rendered, /UNSAVED DRAFT/);
    assert.match(rendered, /data:font\/woff2;base64,/);
    assert.match(rendered, /data:image\/svg\+xml;base64,/);
    assert.match(rendered, /Khan Academy/);
    assert.match(rendered, /script-src 'none'/);
    assert.doesNotMatch(
      rendered,
      /folio-asset:|folio-export-image:|url\(fonts\//,
    );
    await assert.rejects(
      buildExportDocument(
        { ...payload, css: "@import 'https://example.com/a.css'" },
        files,
        dist,
      ),
      /不支持的导出样式/,
    );
    await assert.rejects(
      buildExportDocument({ ...payload, fileId: "unauthorized" }, files, dist),
      /未授权/,
    );
    let choice = { canceled: true };
    const exporter = createExporter({
      dialog: { showSaveDialog: async () => choice },
      owner: () => null,
      files,
      dist,
    });
    assert.deepEqual(await exporter(payload), { canceled: true });
    choice = { canceled: false, filePath: source };
    await assert.rejects(exporter(payload), /\.html/);
    assert.equal(await fs.readFile(source, "utf8"), "ORIGINAL NOTE");
    choice = { canceled: false, filePath: output };
    assert.equal((await exporter(payload)).path, output);
    assert.equal(await fs.readFile(output, "utf8"), rendered);
    await fs.writeFile(output, "PREVIOUS EXPORT");
    await exporter(payload);
    assert.equal(await fs.readFile(output, "utf8"), rendered);
    assert.equal(await fs.readFile(source, "utf8"), "ORIGINAL NOTE");
    assert.equal(
      (await fs.readdir(temp)).some((name) =>
        name.startsWith(".folio-export-"),
      ),
      false,
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
