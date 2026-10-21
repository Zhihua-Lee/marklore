import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  newer,
  parseSums,
  assetNames,
  createUpdater,
  helperScript,
  distrusted,
} from "../desktop/updater.mjs";

test("compares release versions", () => {
  assert.equal(newer("v0.3.0", "0.2.9"), true);
  assert.equal(newer("0.2.10", "0.2.9"), true);
  assert.equal(newer("0.2.9", "0.2.9"), false);
  assert.equal(newer("0.2.8", "0.2.9"), false);
  assert.equal(newer("1.0.0", "0.99.99"), true);
});

test("refuses certificate chains through eMudhra", () => {
  const cert = (cn, org, issuerCert) => ({
    subjectName: cn,
    issuerName: issuerCert?.subjectName ?? cn,
    subject: { commonName: cn, organizations: [org] },
    issuerCert,
  });
  const sectigo = cert("AAA Certificate Services", "Comodo CA Limited");
  sectigo.issuerCert = sectigo;
  const forged = cert(
    "api.github.com",
    "GitHub, Inc.",
    cert("EM DV TLS CA - G3B", "eMudhra Inc", sectigo),
  );
  assert.equal(distrusted(forged), true);
  // By name alone, whatever the organization says.
  assert.equal(
    distrusted(cert("x", "x", cert("EM OV CS CA - G3C", "Other", sectigo))),
    true,
  );
  const github = cert(
    "api.github.com",
    "GitHub, Inc.",
    cert(
      "Sectigo ECC Domain Validation Secure Server CA",
      "Sectigo Limited",
      sectigo,
    ),
  );
  assert.equal(distrusted(github), false);
  assert.equal(distrusted(undefined), false);
});

test("reads sha256sum lines", () => {
  const sums = parseSums(
    `${"a".repeat(64)}  Marklore-Setup-v0.3.0-x64.exe\r\n` +
      `${"B".repeat(64)} *Marklore-v0.3.0-win-x64.zip\n\nnot a line\n`,
  );
  assert.equal(sums.get("Marklore-Setup-v0.3.0-x64.exe"), "a".repeat(64));
  assert.equal(sums.get("Marklore-v0.3.0-win-x64.zip"), "b".repeat(64));
  assert.equal(sums.size, 2);
});

test("the helper overwrites without deleting and restarts the program", () => {
  assert.match(helperScript, /robocopy \$Source \$Target \/E /);
  assert.doesNotMatch(helperScript, /\/MIR|\/PURGE/);
  assert.match(helperScript, /'--updated', "\/D=\$Target"/);
  assert.match(helperScript, /Start-Process -FilePath \$exe/);
});

// A release feed and its assets, served from memory.
function feed(version, files) {
  const names = assetNames(version);
  const sums = Object.entries(files)
    .map(
      ([name, body]) =>
        `${createHash("sha256").update(body).digest("hex")}  ${name}`,
    )
    .join("\n");
  const bodies = { ...files, [names.sums]: Buffer.from(sums) };
  const release = {
    tag_name: "v" + version,
    html_url: "https://example.test/release",
    assets: Object.keys(bodies).map((name) => ({
      name,
      size: bodies[name].length,
      browser_download_url: "https://example.test/" + name,
    })),
  };
  return async (url) => {
    const name = url.split("/").pop();
    const body = url.endsWith("/latest")
      ? Buffer.from(JSON.stringify(release))
      : bodies[name];
    if (!body) return new Response(null, { status: 404 });
    return new Response(body, {
      headers: { "content-length": String(body.length) },
    });
  };
}

// The folder the update was unpacked to (a new one each time).
async function staged(temp, names) {
  const folder = path.join(temp, "marklore-update");
  const [staging] = (await fs.readdir(folder)).filter((name) =>
    name.startsWith("staging-"),
  );
  return path.join(folder, staging, names.folder);
}

async function setup({
  installed,
  files,
  version = "0.3.1",
  electron = "44.4.5",
}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-update-"));
  const program = path.join(temp, "app");
  await fs.mkdir(program);
  const spawned = [],
    states = [];
  const updater = createUpdater({
    version: "0.3.0",
    executable: path.join(program, "Marklore.exe"),
    installed,
    available: true,
    temp,
    feed: "https://example.test/latest",
    fetch: feed(version, files),
    electron,
    // Stands in for tar: unpack the "zip" as one folder, with the program or
    // only the app files.
    run: async (_tar, args) => {
      const folder = path.join(args[3], assetNames(version).folder);
      await fs.mkdir(path.join(folder, "resources"), { recursive: true });
      if (args[1].includes("-app-"))
        await fs.writeFile(path.join(folder, "resources", "app.asar"), "new");
      else await fs.writeFile(path.join(folder, "Marklore.exe"), "new");
    },
    spawn: (...args) => {
      spawned.push(args);
      const child = new EventEmitter();
      setTimeout(() => child.emit("exit", 0));
      return child;
    },
    onChange: (state) => states.push(state),
  });
  return { temp, program, updater, spawned, states };
}

test("an installed copy downloads the checked setup and runs it", async () => {
  const names = assetNames("0.3.1");
  const { temp, program, updater, spawned, states } = await setup({
    installed: true,
    files: { [names.setup]: Buffer.alloc(300000, 7) },
  });
  const state = await updater.check();
  assert.equal(state.available, true);
  assert.equal(state.latest, "0.3.1");
  assert.equal(state.kind, "installer");
  await updater.prepare();
  assert.equal(updater.status().ready, "0.3.1");
  assert.ok(states.some((s) => s.progress > 0 && s.progress < 100));
  await updater.apply();
  const args = spawned[0][1];
  assert.equal(args[args.indexOf("-Kind") + 1], "installer");
  assert.equal(
    args[args.indexOf("-Source") + 1],
    path.join(temp, "marklore-update", names.setup),
  );
  assert.equal(args[args.indexOf("-Target") + 1], program);
  assert.equal(args[args.indexOf("-Parent") + 1], String(process.pid));
});

test("a zip copy unpacks the checked zip beside itself", async () => {
  const names = assetNames("0.3.1");
  const { temp, updater, spawned } = await setup({
    installed: false,
    files: { [names.zip]: Buffer.from("zip") },
  });
  await updater.check();
  assert.equal(updater.status().kind, "folder");
  await updater.prepare();
  await updater.apply();
  const args = spawned[0][1];
  assert.equal(args[args.indexOf("-Kind") + 1], "folder");
  assert.equal(args[args.indexOf("-Source") + 1], await staged(temp, names));
});

test("on the same Electron, either copy takes only the app files", async () => {
  const names = assetNames("0.3.1", "44.4.5");
  assert.equal(names.app, "Marklore-v0.3.1-app-electron-44.4.5.zip");
  for (const installed of [true, false]) {
    const { temp, program, updater, spawned } = await setup({
      installed,
      files: {
        [names.setup]: Buffer.alloc(300000, 7),
        [names.zip]: Buffer.from("zip"),
        [names.app]: Buffer.from("app"),
      },
    });
    await updater.check();
    await updater.prepare();
    await updater.apply();
    const args = spawned[0][1];
    assert.equal(args[args.indexOf("-Kind") + 1], "app");
    assert.equal(args[args.indexOf("-Source") + 1], await staged(temp, names));
    assert.equal(args[args.indexOf("-Target") + 1], program);
    assert.equal(args[args.indexOf("-Version") + 1], "0.3.1");
    // Only the app files were downloaded.
    assert.deepEqual(
      (await fs.readdir(path.join(temp, "marklore-update")))
        .filter((name) => !name.startsWith("staging-"))
        .sort(),
      ["apply-update.ps1", names.app, "pending.json", names.sums].sort(),
    );
  }
});

test("another Electron takes the whole package", async () => {
  const names = assetNames("0.3.1", "45.0.0");
  const { updater, spawned } = await setup({
    installed: false,
    files: { [names.zip]: Buffer.from("zip"), [names.app]: Buffer.from("app") },
  });
  await updater.check();
  await updater.prepare();
  await updater.apply();
  const args = spawned[0][1];
  assert.equal(args[args.indexOf("-Kind") + 1], "folder");
});

test("the helper sets an installed copy's version after app files", () => {
  assert.match(helperScript, /\$Kind -eq 'app'/);
  assert.match(helperScript, /Set-ItemProperty \$_\.PSPath DisplayVersion/);
  assert.match(helperScript, /'-Version', \$Version, '-Own'/);
});

test("a download that does not match its checksum is refused", async () => {
  const names = assetNames("0.3.1");
  const { updater, spawned } = await setup({
    installed: true,
    files: { [names.setup]: Buffer.from("setup") },
  });
  // Serve different bytes than the ones listed in SHA256SUMS.
  const real = await updater.check();
  assert.equal(real.available, true);
  const tampered = createUpdater({
    version: "0.3.0",
    executable: path.join(os.tmpdir(), "Marklore.exe"),
    installed: true,
    available: true,
    temp: await fs.mkdtemp(path.join(os.tmpdir(), "marklore-update-")),
    feed: "https://example.test/latest",
    fetch: async (url) => {
      const response = await feed("0.3.1", {
        [names.setup]: Buffer.from("setup"),
      })(url);
      return url.endsWith(names.setup)
        ? new Response(Buffer.from("other"))
        : response;
    },
  });
  await tampered.check();
  await assert.rejects(tampered.prepare(), /校验不符/);
  assert.equal(tampered.status().ready, undefined);
  await assert.rejects(tampered.apply(), /尚未下载/);
  assert.equal(spawned.length, 0);
});

test("no update when the release is not newer", async () => {
  const { updater } = await setup({
    installed: true,
    version: "0.3.0",
    files: {},
  });
  assert.equal((await updater.check()).available, false);
  await assert.rejects(updater.prepare(), /没有可用的更新/);
});

test("after the restart, says whether the update landed", async () => {
  const names = assetNames("0.3.1");
  const { temp, updater } = await setup({
    installed: true,
    files: { [names.setup]: Buffer.from("setup") },
  });
  await updater.check();
  await updater.prepare();
  await updater.apply();
  const again = createUpdater({
    version: "0.3.1",
    executable: "x",
    available: true,
    temp,
  });
  assert.deepEqual(await again.settle(), {
    updated: true,
    version: "0.3.1",
    from: "0.3.0",
    detail: null,
  });
  // The downloads are cleared, and nothing is reported a second time.
  assert.equal(await again.settle(), null);
});
