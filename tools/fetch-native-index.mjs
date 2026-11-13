// Fetches a native index binary built by the "Native index" workflow into
// native/index, for packaging without a Rust toolchain.
//   node tools/fetch-native-index.mjs [--ref <commit|branch>] [--target <platform-arch>]
// --ref defaults to HEAD and --target to this system. The binary is taken from
// the latest successful run whose commit is the ref or an ancestor of it with
// no change since to the files the workflow builds from (its "paths"), so a
// commit that left the index alone still finds its binary. A binary for this
// system is loaded once to check it; its sha256 is printed either way.
// Uses the GitHub CLI (GH, default "gh") and git (GIT, default "git").
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = "Zhihua-Lee/marklore";
const workflow = "Native index";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const ref = option("--ref", "HEAD");
const target = option("--target", `${process.platform}-${process.arch}`);
const run = (exe, list) =>
  execFileSync(exe, list, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const git = (...list) =>
  run(process.env.GIT || "git", ["-c", "safe.directory=*", ...list]);
const gh = (...list) => run(process.env.GH || "gh", list);

// The files the binary is built from, as the workflow lists them.
const yml = await fs.readFile(
  path.join(root, ".github", "workflows", "native-index.yml"),
  "utf8",
);
const paths = JSON.parse(yml.match(/^\s*paths:\s*(\[.*\])\s*$/m)[1]);
const commit = git("rev-parse", "--verify", `${ref}^{commit}`);

const runs = JSON.parse(
  gh(
    "run",
    "list",
    "-R",
    repo,
    "--workflow",
    workflow,
    "--status",
    "success",
    "-L",
    "100",
    "--json",
    "databaseId,headSha,headBranch,createdAt",
  ),
);
const usable = (sha) => {
  try {
    git("cat-file", "-e", `${sha}^{commit}`);
    git("merge-base", "--is-ancestor", sha, commit);
    git("diff", "--quiet", sha, commit, "--", ...paths);
    return true;
  } catch {
    return false; // unknown here, not an ancestor, or the index changed since
  }
};
const found = runs.find((r) => usable(r.headSha));
if (!found) {
  console.error(
    `No successful "${workflow}" run matches ${commit.slice(0, 7)}: ` +
      "push the index changes or run the workflow, then try again.",
  );
  process.exit(1);
}
const name = `marklore-index.${target}.node`;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "marklore-index-"));
try {
  gh(
    "run",
    "download",
    String(found.databaseId),
    "-R",
    repo,
    "-n",
    `marklore-index-${target}`,
    "-D",
    temp,
  );
  const downloaded = path.join(temp, name);
  const data = await fs.readFile(downloaded);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const to = path.join(root, "native", "index", name);
  await fs.copyFile(downloaded, to);
  console.log(
    `run ${found.databaseId} (${found.headSha.slice(0, 7)}, ${found.createdAt})`,
  );
  console.log(`${sha256}  ${path.relative(root, to)}`);
  if (target === `${process.platform}-${process.arch}`) {
    const { indexInfo, loadNative, API } = await import(
      pathToFileURL(path.join(root, "desktop", "native-index.mjs"))
    );
    const info = indexInfo();
    if (info.kind !== "native" || path.resolve(info.file) !== to)
      throw Error(`the binary does not load: ${info.error}`);
    console.log(`loads: native index, API ${loadNative().apiVersion()}/${API}`);
  }
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
