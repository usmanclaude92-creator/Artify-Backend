/**
 * Minimal path-based router (Phase 4 §8) — no new routing dependency
 * (§37 "do not prematurely introduce complex state management"). Backed
 * by the real browser URL via History API, so reload/bookmark/back-button
 * all work, unlike the previous state-only `currentView` pattern this
 * replaces.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface RouterContextValue {
  path: string;
  navigate: (path: string) => void;
}

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: string) => {
    // `next` may carry a query string (the `?q=`/`?new=1` deep-link
    // convention — see src/lib/deepLink.ts) — only the pathname is ever
    // stored as `path`, matching the popstate handler above and
    // NAV_ITEMS' exact-path lookup (AppShell.tsx/Sidebar.tsx both do
    // `path === item.path`, which a path carrying its own query string
    // would never match). The full string (query included) still goes to
    // the real browser URL via pushState, so reload/bookmark/back-button
    // keep working.
    const nextPathname = next.split("?")[0]!.split("#")[0]!;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.pushState({}, "", next);
    }
    setPath(nextPathname);
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
};

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within RouterProvider");
  return ctx;
}
