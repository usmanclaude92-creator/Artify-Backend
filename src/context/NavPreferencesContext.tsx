/**
 * Sidebar preferences: rail collapse (per user) and pinned favourites (per user + workspace), stored server-side.
 * Rail state is also mirrored in localStorage so the layout doesn't flash on reload. Updates are optimistic; a failed
 * save rolls back. Without a provider (tests, isolated renders) every hook returns inert defaults.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { navPreferencesApi } from "../lib/api";
import { useAuth } from "./AuthContext";

export const MAX_PINS = 8;
const RAIL_STORAGE_KEY = "artify_cc_rail_collapsed";

interface NavPreferencesValue {
  railCollapsed: boolean;
  toggleRail: () => void;
  pinned: string[];
  isPinned: (id: string) => boolean;
  /** Returns false (and does nothing) when pinning would exceed MAX_PINS. */
  togglePin: (id: string) => boolean;
  /** Moves a pinned id by `delta` positions (negative = up). */
  movePin: (id: string, delta: number) => void;
  /** Moves the pin at `from` to index `to` (drag & drop). */
  reorderPin: (from: number, to: number) => void;
  maxPins: number;
}

const inert: NavPreferencesValue = {
  railCollapsed: false,
  toggleRail: () => {},
  pinned: [],
  isPinned: () => false,
  togglePin: () => false,
  movePin: () => {},
  reorderPin: () => {},
  maxPins: MAX_PINS,
};

const NavPreferencesContext = createContext<NavPreferencesValue>(inert);

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export const NavPreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const organizationId = user?.organizationId;
  const [railCollapsed, setRailCollapsed] = useState<boolean>(readRail);
  const [pinned, setPinned] = useState<string[]>([]);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    navPreferencesApi
      .get()
      .then((prefs) => {
        if (cancelled) return;
        setRailCollapsed(prefs.railCollapsed);
        setPinned(prefs.pinned);
        try {
          localStorage.setItem(RAIL_STORAGE_KEY, prefs.railCollapsed ? "1" : "0");
        } catch {
          /* best effort */
        }
      })
      .catch(() => {
        /* offline / not yet migrated: keep local defaults */
      });
    return () => {
      cancelled = true;
    };
    // Pins are per workspace, so reload when the active workspace changes.
  }, [userId, organizationId]);

  const toggleRail = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RAIL_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* best effort */
      }
      navPreferencesApi.update({ railCollapsed: next }).catch(() => setRailCollapsed(prev));
      return next;
    });
  }, []);

  const savePins = useCallback((next: string[]) => {
    const previous = pinnedRef.current;
    setPinned(next);
    pinnedRef.current = next;
    navPreferencesApi.update({ pinned: next }).catch(() => {
      setPinned(previous);
      pinnedRef.current = previous;
    });
  }, []);

  const togglePin = useCallback(
    (id: string) => {
      const current = pinnedRef.current;
      if (current.includes(id)) {
        savePins(current.filter((x) => x !== id));
        return true;
      }
      if (current.length >= MAX_PINS) return false;
      savePins([...current, id]);
      return true;
    },
    [savePins]
  );

  const reorderPin = useCallback(
    (from: number, to: number) => {
      const current = pinnedRef.current;
      if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      savePins(next);
    },
    [savePins]
  );

  const movePin = useCallback(
    (id: string, delta: number) => {
      const index = pinnedRef.current.indexOf(id);
      if (index >= 0) reorderPin(index, index + delta);
    },
    [reorderPin]
  );

  const value = useMemo<NavPreferencesValue>(
    () => ({ railCollapsed, toggleRail, pinned, isPinned: (id) => pinned.includes(id), togglePin, movePin, reorderPin, maxPins: MAX_PINS }),
    [railCollapsed, toggleRail, pinned, togglePin, movePin, reorderPin]
  );
  return <NavPreferencesContext.Provider value={value}>{children}</NavPreferencesContext.Provider>;
};

export function useNavPreferences(): NavPreferencesValue {
  return useContext(NavPreferencesContext);
}
