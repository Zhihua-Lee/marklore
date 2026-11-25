// Real back end: IndexedDB library + Microsoft account and sync.
import { openDatabase, createLibrary } from "./library.js";
import { createAuth } from "./auth.js";
import { createGraph } from "./graph.js";
import { createAccount } from "./account.js";

export async function createBackend() {
  const auth = createAuth({
    defaultClientId: import.meta.env.VITE_MS_CLIENT_ID || "",
  });
  const signin = await auth.handleRedirect();
  const db = await openDatabase();
  const { library, internal } = createLibrary(db);
  const graph = createGraph(auth);
  const account = createAccount({ auth, graph, internal });
  // Images a note shows that are not on the phone yet.
  internal.setFetcher((id) =>
    navigator.onLine === false || !auth.signedIn()
      ? null
      : graph.download(id, { quick: true }),
  );
  await account.ready;
  account.signinResult = signin;
  // A sign-in that just finished: sync right away when a folder is known.
  if (signin.done && account.status().folder) account.sync().catch(() => {});
  return { library, account };
}
