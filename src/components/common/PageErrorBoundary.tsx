/**
 * Catches a crash while rendering a routed page so the user sees a message and a way out instead of a blank screen.
 * A failed lazy chunk (a tab left open across a deploy asks for a file that no longer exists) is retried once with a
 * full reload, guarded by sessionStorage so it can never loop.
 */
import React from "react";

const RELOAD_KEY = "artify_cc_chunk_reload";

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg);
}

/** Returns true when it started a reload (first failure for this tab); false when a reload was already tried. */
export function reloadOnceForChunkError(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

interface Props { resetKey?: string; children: React.ReactNode }
interface State { error: Error | null; reloading: boolean }

export class PageErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidMount() {
    // A page that stays up for a while means the reload worked; allow one more automatic reload for a later deploy.
    this.clearTimer = window.setTimeout(() => { try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ } }, 15000);
  }

  componentWillUnmount() {
    window.clearTimeout(this.clearTimer);
  }

  private clearTimer = 0;

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) this.setState({ reloading: true });
    else console.error("[page-error]", error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, reloading: false });
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (reloading) return null;
    return (
      <div role="alert" className="max-w-md mx-auto mt-16 rounded-2xl p-6 text-center space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
        <h2 className="text-base font-bold">This page could not be shown</h2>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {isChunkLoadError(error) ? "The app was updated while this tab was open. Reload to get the latest version." : "Something went wrong while loading this page. Your data is safe. Reload to try again."}
        </p>
        <button type="button" onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>
          Reload page
        </button>
      </div>
    );
  }
}
