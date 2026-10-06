/** Social Media → Overview: connected accounts, status counts and warnings for the active workspace. */
import React, { useEffect, useState } from "react";
import { Share2, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { socialApi, type SocialAccountSummary } from "../../lib/api";
import { useRouter } from "../../lib/router";
import { useAuth } from "../../context/AuthContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, LoadingState, ErrorState, EmptyState } from "./../ui/ui";
import { ProviderAvatar, StatusBadge, expiresSoon, timeAgo } from "./socialShared";

const Stat: React.FC<{ label: string; value: number; tone?: "danger" | "warning" | "success" }> = ({ label, value, tone }) => (
  <div>
    <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>
      {label}
    </p>
    <p className="text-2xl font-bold" style={{ color: tone === "danger" ? "#f43f5e" : tone === "warning" ? "#f59e0b" : tone === "success" ? "#10b981" : "var(--text-primary)" }}>
      {value}
    </p>
  </div>
);

export const SocialOverviewPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const { current } = useActiveWorkspace();
  const canSeeAccounts = hasPermission(user?.role.permissions, "social.read");
  const [accounts, setAccounts] = useState<SocialAccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAccounts(null);
    setError(null);
    socialApi
      .list()
      .then((res) => !cancelled && setAccounts(res.accounts))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load social accounts."));
    return () => {
      cancelled = true;
    };
  }, [current?.organizationId]);

  const count = (status: SocialAccountSummary["status"]) => (accounts ?? []).filter((a) => a.status === status).length;
  const warnings = (accounts ?? []).filter((a) => a.status === "NEEDS_REAUTH" || a.status === "ERROR" || expiresSoon(a));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Share2 className="w-5 h-5" style={{ color: "var(--accent)" }} /> Social Overview
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {current?.organizationName ? `${current.organizationName} · ` : ""}Publishing, inbox and analytics arrive in later phases. Connect your accounts first.
          </p>
        </div>
        {canSeeAccounts && (
          <Button variant="secondary" onClick={() => navigate("/social/accounts")}>
            Manage accounts <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : accounts === null ? (
        <LoadingState />
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState title="No social accounts connected" description="Connect a network under Connected Accounts to start. Nothing is posted or read until you do." />
        </Card>
      ) : (
        <>
          <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Accounts" value={accounts.length} />
            <Stat label="Connected" value={count("CONNECTED")} tone="success" />
            <Stat label="Needs reconnect" value={count("NEEDS_REAUTH")} tone={count("NEEDS_REAUTH") ? "warning" : undefined} />
            <Stat label="Errors" value={count("ERROR")} tone={count("ERROR") ? "danger" : undefined} />
          </Card>

          <Card className="p-4 space-y-2" aria-label="Warnings">
            <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              {warnings.length ? <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />}
              {warnings.length ? `${warnings.length} account${warnings.length === 1 ? "" : "s"} need attention` : "All connections look healthy"}
            </h2>
            {warnings.map((a) => (
              <p key={a.id} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                <strong>{a.displayName}</strong> — {a.status === "CONNECTED" ? "token expires within 7 days" : (a.lastError ?? "needs to be reconnected")}
              </p>
            ))}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>
              Connected accounts
            </h2>
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {accounts.map((a) => (
                <li key={a.id} className="py-2.5 flex items-center gap-3">
                  <ProviderAvatar account={a} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>
                      {a.displayName}
                    </span>
                    <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                      {a.handle ?? a.externalAccountId} · last sync {timeAgo(a.lastSyncAt)}
                    </span>
                  </span>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
};
