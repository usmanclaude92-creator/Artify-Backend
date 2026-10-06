/** Sidebar badge counts: loaded on mount, refreshed every 60s and whenever the window regains focus. Failures are silent (badges just keep their last value). */
import { useCallback, useEffect, useState } from "react";
import { navApi, type NavBadges } from "./api";

export const NAV_BADGE_POLL_MS = 60_000;

export function useNavBadges(enabled = true): NavBadges | null {
  const [badges, setBadges] = useState<NavBadges | null>(null);

  const refresh = useCallback(() => {
    navApi
      .badges()
      .then(setBadges)
      .catch(() => {
        /* transient — the next tick retries */
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(refresh, NAV_BADGE_POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  return badges;
}
