// Phone reader: a Graph request that stalls (iOS suspends a home-screen app's
// requests in the background) times out and is retried instead of hanging.
import test from "node:test";
import assert from "node:assert/strict";
import { createGraph } from "../mobile/graph.js";

const auth = { accessToken: async () => "AT" };
const stall = (_url, { signal }) =>
  new Promise((_, reject) =>
    signal.addEventListener("abort", () => reject(new Error("aborted"))),
  );
const answer = (json) => ({ ok: true, status: 200, json: async () => json });

test("a stalled listing request is retried and the listing completes", async () => {
  let calls = 0;
  const graph = createGraph(auth, {
    timeout: 20,
    retryDelay: 1,
    fetcher: (url, init) =>
      ++calls === 1
        ? stall(url, init)
        : Promise.resolve(
            answer({ value: [{ id: "A" }], "@odata.deltaLink": "D" }),
          ),
  });
  const pages = [];
  const result = await graph.delta("R", null, (n) => pages.push(n));
  assert.equal(calls, 2);
  assert.deepEqual(result, { items: [{ id: "A" }], deltaLink: "D" });
  assert.deepEqual(pages, [1]);
});

test("a request that keeps stalling ends with a message instead of hanging", async () => {
  let calls = 0;
  const graph = createGraph(auth, {
    timeout: 20,
    retryDelay: 1,
    fetcher: (url, init) => (calls++, stall(url, init)),
  });
  await assert.rejects(graph.delta("R"), /长时间没有响应/);
  assert.equal(calls, 4);
});
