// Microsoft Graph calls the reader needs: list folders, delta, download.
export const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT =
  "id,name,size,file,folder,package,deleted,parentReference,cTag,eTag,lastModifiedDateTime";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = 30_000;
const DOWNLOAD_TIMEOUT = 120_000;

export function createGraph(
  auth,
  {
    fetcher = (...a) => fetch(...a),
    timeout = TIMEOUT,
    downloadTimeout = DOWNLOAD_TIMEOUT,
    retryDelay = 1000,
  } = {},
) {
  // GET with the access token; retries throttling and transient errors, and
  // refreshes the token once on 401.
  async function get(
    url,
    { as = "json", attempt = 0, refreshed = false } = {},
  ) {
    const token = await auth.accessToken({ force: refreshed });
    let response;
    // A request can stall without failing (iOS suspends a home-screen app's
    // requests while it is in the background): give up and retry instead.
    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort(),
      as === "blob" ? downloadTimeout : timeout,
    );
    try {
      response = await fetcher(url.startsWith("http") ? url : GRAPH + url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      });
      if (response.ok)
        return await (as === "blob" ? response.blob() : response.json());
    } catch (e) {
      if (attempt < 3) {
        await wait(retryDelay * 2 ** attempt);
        return get(url, { as, attempt: attempt + 1, refreshed });
      }
      throw new Error(
        abort.signal.aborted
          ? "OneDrive 长时间没有响应，请稍后再同步"
          : "网络不可用：" + e.message,
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 && !refreshed)
      return get(url, { as, attempt, refreshed: true });
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
      const after = Number(response.headers.get("Retry-After"));
      await wait(after > 0 ? Math.min(after, 60) * 1000 : 1000 * 2 ** attempt);
      return get(url, { as, attempt: attempt + 1, refreshed });
    }
    const body = await response.json().catch(() => ({}));
    const error = new Error(
      body.error?.message || `OneDrive 返回 ${response.status}`,
    );
    error.status = response.status;
    error.code = body.error?.code;
    throw error;
  }

  async function* pages(url) {
    let next = url;
    while (next) {
      const body = await get(next);
      yield body;
      next = body["@odata.nextLink"] || null;
      if (!next && body["@odata.deltaLink"]) return body["@odata.deltaLink"];
    }
  }

  return {
    get,
    async folders(parentId) {
      const base = parentId
        ? `/me/drive/items/${encodeURIComponent(parentId)}`
        : "/me/drive/root";
      const out = [];
      for await (const body of pages(
        `${base}/children?$select=id,name,folder,parentReference&$top=200`,
      ))
        for (const item of body.value || [])
          if (item.folder)
            out.push({
              id: item.id,
              name: item.name,
              path: (
                (item.parentReference?.path || "").replace(
                  /^\/drive\/root:?/,
                  "",
                ) +
                "/" +
                item.name
              ).replace(/^\/+/, "/"),
              childCount: item.folder.childCount ?? 0,
            });
      return out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    },
    async item(id) {
      return get(`/me/drive/items/${encodeURIComponent(id)}?$select=${SELECT}`);
    },
    // All delta pages from `link` (or the folder's start); returns
    // { items, deltaLink }. Throws with `.status` when delta is not offered
    // for this folder (work or school accounts allow it only at the root).
    async delta(folderId, link = null, onPage = () => {}) {
      const items = [];
      let deltaLink = null;
      let next =
        link ||
        `/me/drive/items/${encodeURIComponent(folderId)}/delta?$select=${SELECT}`;
      while (next) {
        const body = await get(next);
        items.push(...(body.value || []));
        onPage(items.length);
        next = body["@odata.nextLink"] || null;
        deltaLink = body["@odata.deltaLink"] || deltaLink;
      }
      return { items, deltaLink };
    },
    // Every item below a folder by walking children (fallback without delta).
    async walk(folderId, onPage = () => {}) {
      const items = [await this.item(folderId)];
      const queue = [folderId];
      while (queue.length) {
        const id = queue.shift();
        for await (const body of pages(
          `/me/drive/items/${encodeURIComponent(id)}/children?$select=${SELECT}&$top=200`,
        ))
          for (const item of body.value || []) {
            items.push(item);
            if (item.folder) queue.push(item.id);
          }
        onPage(items.length);
      }
      return items;
    },
    // `quick`: no waiting retries on a network error (an image a note is
    // showing; a sync retries).
    download(id, { quick = false } = {}) {
      return get(`/me/drive/items/${encodeURIComponent(id)}/content`, {
        as: "blob",
        attempt: quick ? 3 : 0,
      });
    },
  };
}
