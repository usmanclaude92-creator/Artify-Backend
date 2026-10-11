/**
 * Session hand-off for the Facebook/Instagram connect redirect. The session token lives in per-tab sessionStorage, but some browsers
 * (Android Chrome, in-app browsers) open the provider's return link in a NEW tab, which has no token and would show the login screen.
 * Just before leaving for the provider the token is copied to a one-time slot; the returning tab adopts it and the slot is deleted.
 *
 * Exposure is kept small on purpose: the slot expires after 10 minutes, is single use, is adopted only on /social/accounts with an OAuth
 * `state` in the URL (the provider return), and is removed as soon as the original tab boots with its own token. The state value is still
 * verified server-side, so this adds no way to connect anything without the signed-in session.
 */
export const SESSION_TOKEN_KEY = "artify_cc_session_token";
const SLOT = "artify.oauthSession";
const PATH = "/social/accounts";
const TTL_MS = 10 * 60 * 1000;

/** Call right before redirecting to the provider. */
export function stashSessionForOAuth(): void {
  try {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (token) localStorage.setItem(SLOT, JSON.stringify({ token, at: Date.now() }));
  } catch { /* storage unavailable: the returning tab just asks for sign-in, as before */ }
}

/** Removes the slot (the original tab came back with its own token, or the slot is stale). */
export function clearStashedSession(): void {
  try { localStorage.removeItem(SLOT); } catch { /* ignore */ }
}

/** Single use. Returns the token only for a fresh provider return; otherwise null. Always clears the slot. */
export function adoptStashedSession(): string | null {
  try {
    const raw = localStorage.getItem(SLOT);
    if (!raw) return null;
    localStorage.removeItem(SLOT);
    const v = JSON.parse(raw) as { token?: string; at?: number };
    const isReturn = window.location.pathname === PATH && new URLSearchParams(window.location.search).has("state");
    if (!v.token || typeof v.at !== "number" || Date.now() - v.at > TTL_MS || !isReturn) return null;
    return v.token;
  } catch { return null; }
}
