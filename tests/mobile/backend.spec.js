// The real back end against a simulated Microsoft sign-in and OneDrive
// (all network routed in the test): sign-in with PKCE, first sync, delta
// changes (rename, delete, edit), token refresh, expired delta, and the
// fallback for folders without delta. Uses window.markloreReader (main.js).
import { test, expect } from "@playwright/test";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = `${b64({ alg: "none" })}.${b64({ name: "测试用户" })}.x`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';

function fakeDrive() {
  const files = {
    R: { name: "数学笔记", folder: {} },
    F1: { name: "第一章 实数", folder: {}, parent: "R" },
    N1: {
      name: "一致收敛.md",
      parent: "R",
      body: "﻿# 一致收敛\n\n设 $f_n$ 一致收敛。",
      tag: "a1",
    },
    N2: {
      name: "确界原理.md",
      parent: "F1",
      body: "# 确界原理\n\n上确界。",
      tag: "b1",
    },
    I1: { name: "curve.svg", parent: "F1", body: SVG, tag: "c1" },
    X1: { name: "slides.pptx", parent: "R", body: "x", tag: "d1" },
  };
  const item = (id) => {
    const f = files[id];
    return {
      id,
      name: f.name,
      ...(f.folder
        ? { folder: { childCount: 1 } }
        : { file: {}, size: f.body.length, cTag: f.tag }),
      ...(f.parent ? { parentReference: { id: f.parent } } : {}),
      lastModifiedDateTime: "2026-11-25T10:00:00Z",
    };
  };
  return {
    files,
    item,
    changes: [],
    deltaMode: "ok",
    tokenCalls: [],
    downloads: [],
    fail401: 0,
  };
}

async function routeMicrosoft(page, drive, seen) {
  // Network requests only (WebKit also reports blob: and data: URLs).
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (/^https?:$/.test(url.protocol)) seen.push(url.host);
  });
  await page.route("https://login.microsoftonline.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/authorize")) {
      const p = url.searchParams;
      expect(p.get("code_challenge_method")).toBe("S256");
      expect(p.get("client_id")).toBe("test-client");
      const back = new URL(p.get("redirect_uri"));
      back.search = new URLSearchParams({
        code: "CODE1",
        state: p.get("state"),
      });
      // Playwright's WebKit cannot fulfill a 302; the sign-in page sends the
      // browser back with a script instead.
      return route.fulfill({
        contentType: "text/html",
        body: `<script>location.replace(${JSON.stringify(back.href)})</script>`,
      });
    }
    const form = new URLSearchParams(route.request().postData() || "");
    drive.tokenCalls.push(form.get("grant_type"));
    if (form.get("grant_type") === "authorization_code")
      expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    return route.fulfill({
      headers: { "Access-Control-Allow-Origin": "*" },
      json: {
        access_token: "AT" + drive.tokenCalls.length,
        refresh_token: "RT",
        expires_in: 3600,
        id_token: idToken,
      },
    });
  });
  await page.route("https://graph.microsoft.com/**", async (route) => {
    const url = new URL(route.request().url());
    const cors = { "Access-Control-Allow-Origin": "*" };
    expect(route.request().headers().authorization).toMatch(/^Bearer AT\d+$/);
    if (drive.fail401 > 0) {
      drive.fail401--;
      return route.fulfill({
        status: 401,
        headers: cors,
        json: { error: { code: "InvalidAuthenticationToken" } },
      });
    }
    const path = decodeURIComponent(url.pathname.replace("/v1.0", ""));
    let m;
    if (path === "/me/drive/root/children")
      return route.fulfill({
        headers: cors,
        json: {
          value: [
            {
              id: "R",
              name: "数学笔记",
              folder: { childCount: 3 },
              parentReference: { path: "/drive/root:" },
            },
          ],
        },
      });
    if ((m = path.match(/^\/me\/drive\/items\/(\w+)\/content$/))) {
      drive.downloads.push(m[1]);
      return route.fulfill({ headers: cors, body: drive.files[m[1]].body });
    }
    if ((m = path.match(/^\/me\/drive\/items\/(\w+)\/children$/)))
      return route.fulfill({
        headers: cors,
        json: {
          value: Object.keys(drive.files)
            .filter((id) => drive.files[id].parent === m[1])
            .map(drive.item),
        },
      });
    if ((m = path.match(/^\/me\/drive\/items\/(\w+)$/)))
      return route.fulfill({ headers: cors, json: drive.item(m[1]) });
    if (path === "/me/drive/items/R/delta") {
      if (drive.deltaMode === "unsupported")
        return route.fulfill({
          status: 400,
          headers: cors,
          json: { error: { code: "invalidRequest" } },
        });
      const token = url.searchParams.get("token");
      if (token === "GONE")
        return route.fulfill({
          status: 410,
          headers: cors,
          json: { error: { code: "resyncRequired" } },
        });
      if (!token) {
        // A full listing, in two pages.
        const ids = Object.keys(drive.files);
        if (!url.searchParams.get("page"))
          return route.fulfill({
            headers: cors,
            json: {
              value: ids.slice(0, 3).map(drive.item),
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/me/drive/items/R/delta?page=2",
            },
          });
        return route.fulfill({
          headers: cors,
          json: {
            value: ids.slice(3).map(drive.item),
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/drive/items/R/delta?token=T" +
              Date.now(),
          },
        });
      }
      const value = drive.changes.splice(0);
      return route.fulfill({
        headers: cors,
        json: {
          value,
          "@odata.deltaLink":
            drive.nextToken ||
            "https://graph.microsoft.com/v1.0/me/drive/items/R/delta?token=T" +
              Date.now(),
        },
      });
    }
    return route.fulfill({
      status: 404,
      headers: cors,
      json: { error: { code: "itemNotFound" } },
    });
  });
}

const api = (page, fn, arg) => page.evaluate(fn, arg);

test("sign in, sync a folder, then follow renames, deletions and edits", async ({
  page,
}) => {
  const drive = fakeDrive();
  const seen = [];
  await routeMicrosoft(page, drive, seen);
  await page.goto("./");
  await page.waitForFunction(() => window.markloreReader);
  expect(
    await api(page, () => window.markloreReader.account.status().configured),
  ).toBe(false);
  await api(page, () =>
    window.markloreReader.account.setClientId("test-client"),
  );
  await Promise.all([
    page.waitForURL(
      (u) => !u.search.includes("code=") && u.host.startsWith("127.0.0.1"),
      { waitUntil: "load" },
    ),
    api(page, () => window.markloreReader.account.signIn()),
  ]);
  await page.waitForFunction(
    () => window.markloreReader?.account.status().signedIn,
  );
  expect(page.url()).not.toContain("code=");
  expect(
    await api(page, () => window.markloreReader.account.status().user),
  ).toBe("测试用户");
  expect(drive.tokenCalls).toEqual(["authorization_code"]);

  const folders = await api(page, () =>
    window.markloreReader.account.folders(null),
  );
  expect(folders).toEqual([
    { id: "R", name: "数学笔记", path: "/数学笔记", childCount: 3 },
  ]);
  const first = await api(
    page,
    (f) => window.markloreReader.account.chooseFolder(f),
    folders[0],
  );
  expect(first.failed).toEqual([]);
  expect(first.added).toBe(3);
  const lib = () =>
    api(page, async () => {
      const { library } = window.markloreReader;
      return { list: await library.list(), info: await library.info() };
    });
  let state = await lib();
  expect(state.list.map((n) => [n.path, n.title])).toEqual([
    ["一致收敛.md", "一致收敛"],
    ["第一章 实数/确界原理.md", "确界原理"],
  ]);
  expect(state.info).toMatchObject({
    folderName: "数学笔记",
    notes: 2,
    images: 1,
  });
  expect(
    await api(page, () => window.markloreReader.library.text("一致收敛.md")),
  ).toBe("# 一致收敛\n\n设 $f_n$ 一致收敛。");
  const svg = await api(page, async () => {
    const url =
      await window.markloreReader.library.asset("第一章 实数/curve.svg");
    return url && (await (await fetch(url)).text());
  });
  expect(svg).toBe(SVG);
  expect(
    (await api(page, () => window.markloreReader.library.search("上确界")))[0],
  ).toMatchObject({
    path: "第一章 实数/确界原理.md",
    line: 2,
  });

  // Rename the folder, delete the image, edit a note.
  drive.files.F1.name = "第一章";
  drive.files.N1.body = "# 一致收敛（修订）";
  drive.files.N1.tag = "a2";
  drive.changes.push(drive.item("F1"), drive.item("N1"), {
    id: "I1",
    deleted: {},
  });
  drive.downloads.length = 0;
  const second = await api(page, () => window.markloreReader.account.sync());
  expect(second).toMatchObject({ added: 1, changed: 1, removed: 1 });
  expect(drive.downloads).toEqual(["N1"]);
  state = await lib();
  expect(state.list.map((n) => [n.path, n.title])).toEqual([
    ["一致收敛.md", "一致收敛（修订）"],
    ["第一章/确界原理.md", "确界原理"],
  ]);
  expect(state.info.images).toBe(0);

  // Stored notes survive a reload without any network.
  await page.reload();
  await page.waitForFunction(() => window.markloreReader);
  expect((await lib()).list.length).toBe(2);
  // Privacy: the page talks only to its own server and to Microsoft.
  const elsewhere = seen.filter(
    (h) =>
      !h.startsWith("127.0.0.1") &&
      !["login.microsoftonline.com", "graph.microsoft.com"].includes(h),
  );
  expect(elsewhere).toEqual([]);
});

test("a rejected token is refreshed once; an expired delta link lists again", async ({
  page,
}) => {
  const drive = fakeDrive();
  await routeMicrosoft(page, drive, []);
  await page.goto("./");
  await page.waitForFunction(() => window.markloreReader);
  await api(page, () =>
    window.markloreReader.account.setClientId("test-client"),
  );
  await Promise.all([
    page.waitForURL((u) => !u.search.includes("code="), { waitUntil: "load" }),
    api(page, () => window.markloreReader.account.signIn()),
  ]);
  await page.waitForFunction(
    () => window.markloreReader?.account.status().signedIn,
  );
  await api(page, () =>
    window.markloreReader.account.chooseFolder({
      id: "R",
      name: "数学笔记",
      path: "/数学笔记",
    }),
  );
  drive.fail401 = 1;
  await api(page, () => window.markloreReader.account.sync());
  expect(drive.tokenCalls).toEqual(["authorization_code", "refresh_token"]);

  // The delta link expired (410): start again from a full listing; a file
  // deleted meanwhile disappears.
  drive.nextToken =
    "https://graph.microsoft.com/v1.0/me/drive/items/R/delta?token=GONE";
  await api(page, () => window.markloreReader.account.sync());
  drive.nextToken = null;
  delete drive.files.N2;
  const result = await api(page, () => window.markloreReader.account.sync());
  expect(result.removed).toBe(1);
  const paths = await api(page, async () =>
    (await window.markloreReader.library.list()).map((n) => n.path),
  );
  expect(paths).toEqual(["一致收敛.md"]);
});

test("folders without delta (work or school accounts) sync by walking", async ({
  page,
}) => {
  const drive = fakeDrive();
  drive.deltaMode = "unsupported";
  await routeMicrosoft(page, drive, []);
  await page.goto("./");
  await page.waitForFunction(() => window.markloreReader);
  await api(page, () =>
    window.markloreReader.account.setClientId("test-client"),
  );
  await Promise.all([
    page.waitForURL((u) => !u.search.includes("code="), { waitUntil: "load" }),
    api(page, () => window.markloreReader.account.signIn()),
  ]);
  await page.waitForFunction(
    () => window.markloreReader?.account.status().signedIn,
  );
  const result = await api(page, () =>
    window.markloreReader.account.chooseFolder({
      id: "R",
      name: "数学笔记",
      path: "/数学笔记",
    }),
  );
  expect(result.added).toBe(3);
  delete drive.files.N1;
  expect(
    (await api(page, () => window.markloreReader.account.sync())).removed,
  ).toBe(1);
});
