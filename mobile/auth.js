// Microsoft sign-in for a static page: authorization code with PKCE, as a
// single-page application (no secret). The application ID is the owner's own
// registration (Azure "App registrations", platform "Single-page application",
// redirect URI = this page's address). Tokens stay on the phone.
//
// The verifier and state are kept in localStorage, not sessionStorage: on iOS
// a home-screen app may finish the sign-in in a different browsing context.
// SPA refresh tokens last about 24 hours; after that sync asks to sign in
// again. Reading stored notes never needs the account.

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
export const SCOPES = "openid profile offline_access Files.Read";
const KEY = "marklore-reader:";

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export const redirectUri = () => location.origin + location.pathname;

export function createAuth({
  storage = localStorage,
  defaultClientId = "",
} = {}) {
  const read = (k) => {
    try {
      return JSON.parse(storage.getItem(KEY + k));
    } catch {
      return null;
    }
  };
  const write = (k, v) =>
    v === null
      ? storage.removeItem(KEY + k)
      : storage.setItem(KEY + k, JSON.stringify(v));

  const clientId = () => read("client-id") || defaultClientId || "";
  const tokens = () => read("tokens");

  function userFrom(idToken) {
    try {
      const body = JSON.parse(
        decodeURIComponent(
          escape(
            atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
          ),
        ),
      );
      return body.name || body.preferred_username || null;
    } catch {
      return null;
    }
  }

  async function tokenRequest(params) {
    const response = await fetch(`${AUTHORITY}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId(),
        scope: SCOPES,
        ...params,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      const error = new Error(
        body.error_description || body.error || `HTTP ${response.status}`,
      );
      error.code = body.error || "token_failed";
      throw error;
    }
    const previous = tokens();
    const next = {
      access: body.access_token,
      refresh: body.refresh_token || previous?.refresh || null,
      expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60_000,
      user:
        (body.id_token && userFrom(body.id_token)) || previous?.user || null,
    };
    write("tokens", next);
    return next;
  }

  return {
    clientId,
    setClientId(id) {
      write("client-id", String(id || "").trim() || null);
    },
    configured: () => Boolean(clientId()),
    signedIn: () => Boolean(tokens()?.refresh || tokens()?.access),
    user: () => tokens()?.user || null,

    async signIn() {
      const verifier = random(48);
      const challenge = b64url(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      );
      const state = random(16);
      write("pkce", { verifier, state, at: Date.now() });
      const url = new URL(`${AUTHORITY}/authorize`);
      url.search = new URLSearchParams({
        client_id: clientId(),
        response_type: "code",
        redirect_uri: redirectUri(),
        response_mode: "query",
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        prompt: "select_account",
      });
      location.assign(url.href);
    },

    // On load: finishes a sign-in that came back with ?code=…; returns
    // { done } or { error }. Always removes the code from the address bar.
    async handleRedirect() {
      const params = new URLSearchParams(location.search);
      const code = params.get("code");
      const error = params.get("error");
      if (!code && !error) return {};
      const clean = new URL(location.href);
      for (const k of [
        "code",
        "state",
        "session_state",
        "error",
        "error_description",
        "client_info",
      ])
        clean.searchParams.delete(k);
      history.replaceState(history.state, "", clean.href);
      if (error) return { error: params.get("error_description") || error };
      const pkce = read("pkce");
      write("pkce", null);
      if (
        !pkce ||
        pkce.state !== params.get("state") ||
        Date.now() - pkce.at > 15 * 60_000
      )
        return { error: "登录已过期或不匹配，请重新登录" };
      try {
        await tokenRequest({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri(),
          code_verifier: pkce.verifier,
        });
        return { done: true };
      } catch (e) {
        return { error: e.message };
      }
    },

    // A valid access token, refreshed when needed; throws code "signin_required".
    async accessToken({ force = false } = {}) {
      const current = tokens();
      if (current?.access && !force && current.expires > Date.now())
        return current.access;
      if (!current?.refresh) {
        const e = new Error("需要重新登录");
        e.code = "signin_required";
        throw e;
      }
      try {
        return (
          await tokenRequest({
            grant_type: "refresh_token",
            refresh_token: current.refresh,
          })
        ).access;
      } catch (e) {
        if (
          ["invalid_grant", "interaction_required", "invalid_client"].includes(
            e.code,
          )
        ) {
          write("tokens", null);
          e.code = "signin_required";
          e.message = "登录已过期，请重新登录";
        }
        throw e;
      }
    },

    signOut() {
      write("tokens", null);
      write("pkce", null);
    },
  };
}
