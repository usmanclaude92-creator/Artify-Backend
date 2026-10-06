/**
 * The active workspace. In this app a workspace IS an organization the user belongs to, and the active one is
 * already the scope of every API call (the session carries organizationId; switching issues a new session via
 * POST /auth/switch-organization). This context only wraps that existing mechanism so any module (Social, CRM…)
 * can read the active workspace — it changes no scoping. Persistence is the session itself (survives reloads).
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";
import type { MembershipSummary } from "../lib/api";

interface ActiveWorkspaceValue {
  workspaces: MembershipSummary[];
  current: MembershipSummary | null;
  /** True only when the user belongs to more than one workspace. */
  canSwitch: boolean;
  switching: boolean;
  switchTo: (organizationId: string) => Promise<void>;
}

const fallback: ActiveWorkspaceValue = { workspaces: [], current: null, canSwitch: false, switching: false, switchTo: async () => {} };
const ActiveWorkspaceContext = createContext<ActiveWorkspaceValue>(fallback);

export const ActiveWorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { organizations, switchOrganization } = useAuth();
  const { notify } = useToast();
  const [switching, setSwitching] = useState(false);
  const list = organizations ?? [];

  const switchTo = useCallback(
    async (organizationId: string) => {
      setSwitching(true);
      try {
        await switchOrganization(organizationId);
        notify("Switched workspace.", "success");
      } catch {
        notify("Could not switch workspace.", "error");
      } finally {
        setSwitching(false);
      }
    },
    [switchOrganization, notify]
  );

  const value = useMemo<ActiveWorkspaceValue>(
    () => ({ workspaces: list, current: list.find((o) => o.isCurrent) ?? null, canSwitch: list.length > 1, switching, switchTo }),
    [list, switching, switchTo]
  );
  return <ActiveWorkspaceContext.Provider value={value}>{children}</ActiveWorkspaceContext.Provider>;
};

export function useActiveWorkspace(): ActiveWorkspaceValue {
  return useContext(ActiveWorkspaceContext);
}
