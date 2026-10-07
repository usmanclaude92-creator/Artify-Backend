/**
 * OAuth return handoff. Providers send the browser back to /social/accounts?state=&code=, but a browser with no
 * session (e.g. an in-app browser) is bounced to /login, which drops the query. Stash it before routing and
 * resume after sign-in. Stored per-tab (sessionStorage), single use, short-lived; the state value is verified
 * server-side, so a stale/forged entry cannot connect anything.
 */
const KEY = "artify.oauthReturn";
const PATH = "/social/accounts";
const TTL_MS = 10 * 60 * 1000;

export type OAuthReturn = { state: string; code?: string; error?: string };

export function stashOAuthReturn(): void {
  try {
    if (window.location.pathname !== PATH) return;
    const p = new URLSearchParams(window.location.search);
    const state = p.get("state");
    if (!state) return;
    sessionStorage.setItem(KEY, JSON.stringify({ state, code: p.get("code") ?? undefined, error: p.get("error") ?? undefined, at: Date.now() }));
  } catch { /* storage unavailable: fall back to the live URL */ }
}

export function hasPendingOAuthReturn(): boolean {
  return peek() !== null;
}

function peek(): OAuthReturn | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as OAuthReturn & { at: number };
    if (!v.state || Date.now() - v.at > TTL_MS) { sessionStorage.removeItem(KEY); return null; }
    return { state: v.state, code: v.code, error: v.error };
  } catch { return null; }
}

/** Single-use: returns and clears the stashed return, else falls back to the live URL query. */
export function takeOAuthReturn(): OAuthReturn | null {
  const stashed = peek();
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  if (stashed) return stashed;
  const p = new URLSearchParams(window.location.search);
  const state = p.get("state");
  return state ? { state, code: p.get("code") ?? undefined, error: p.get("error") ?? undefined } : null;
}
