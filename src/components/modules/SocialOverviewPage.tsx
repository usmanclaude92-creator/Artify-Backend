/** Social Media → Overview: connected accounts, status counts and warnings for the active workspace. */
import React, { useEffect, useState } from "react";
import { Share2, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { socialAnalyticsApi, socialApi, socialInboxApi, socialPublishingApi, type AnalyticsSummary, type InboxMetrics, type PublishingMetrics, type SocialAccountSummary } from "../../lib/api";
import { useRouter } from "../../lib/router";
import { useAuth } from "../../context/AuthContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, LoadingState, ErrorState, EmptyState } from "./../ui/ui";
import { ProviderAvatar, StatusBadge, expiresSoon, timeAgo } from "./socialShared";
import { formatDuration } from "./socialInboxShared";
import { fmtNumber, providerLabel } from "./socialAnalyticsShared";

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
  const canSeeAnalytics = hasPermission(user?.role.permissions, "social.analytics.read");
  const [accounts, setAccounts] = useState<SocialAccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PublishingMetrics | null>(null);
  const [inbox, setInbox] = useState<InboxMetrics | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null | "failed">(null);

  useEffect(() => {
    // Publishing health is optional context: a failure here must never break the page.
    socialPublishingApi.metrics().then(setMetrics).catch(() => setMetrics(null));
    socialInboxApi.metrics().then(setInbox).catch(() => setInbox(null));
    // Analytics is optional context too, and only requested for people who may see it.
    setAnalytics(null);
    if (canSeeAnalytics) socialAnalyticsApi.summary().then(setAnalytics).catch(() => setAnalytics("failed"));
  }, [current?.organizationId, canSeeAnalytics]);

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
            {current?.organizationName ? `${current.organizationName} · ` : ""}Accounts, publishing, inbox and performance for this workspace.
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

          {inbox && (
            <Card className="p-4" aria-label="Inbox health">
              <h2 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>Inbox</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Open" value={inbox.open} />
                <Stat label="Overdue" value={inbox.overdue} tone={inbox.overdue ? "danger" : undefined} />
                <Stat label="Unassigned" value={inbox.unassigned} tone={inbox.unassigned ? "warning" : undefined} />
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>Median first reply</p>
                  <p className="text-sm font-bold pt-1.5" style={{ color: "var(--text-primary)" }}>{formatDuration(inbox.medianFirstResponseMs)}</p>
                </div>
              </div>
              <Button variant="secondary" className="mt-3" onClick={() => navigate("/social/inbox")}>Open inbox <ArrowRight className="w-3.5 h-3.5" /></Button>
            </Card>
          )}

          {canSeeAnalytics && analytics && analytics !== "failed" && (() => {
            const supported = analytics.accounts.filter((a) => a.analytics === "supported");
            const withData = supported.filter((a) => a.headline.some((k) => k.current !== null));
            return (
              <Card className="p-4 space-y-3" aria-label="Performance">
                <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Performance · last {analytics.days} days</h2>
                {withData.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {supported.length === 0 ? "None of the connected networks provides analytics to this app." : "No analytics have been collected yet. The daily job takes the first snapshot after an account is connected with the Insights permission; nothing is shown until Meta provides numbers."}
                  </p>
                ) : (
                  <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {withData.map((a) => (
                      <li key={a.id} className="py-2 grid grid-cols-2 sm:grid-cols-5 gap-2 items-center text-xs">
                        <span className="font-bold truncate" style={{ color: "var(--text-primary)" }}>{a.displayName}<span className="block font-normal" style={{ color: "var(--text-muted)" }}>{providerLabel(a.provider)}</span></span>
                        {a.headline.map((k) => (
                          <span key={k.metric} title={k.current === null ? (k.unavailableReason ?? "Not available yet") : k.kind === "flow" && k.daysWithData < k.daysInRange ? `${k.daysWithData} of ${k.daysInRange} days have data` : undefined}>
                            <span className="block text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>{k.label}</span>
                            <span className="font-bold" style={{ color: k.current === null ? "var(--text-muted)" : "var(--text-primary)" }}>{fmtNumber(k.current)}</span>
                            {k.kind === "flow" && k.current !== null && k.daysWithData < k.daysInRange && <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>{k.daysWithData}/{k.daysInRange} days</span>}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                <Button variant="secondary" onClick={() => navigate("/social/analytics")}>Open analytics <ArrowRight className="w-3.5 h-3.5" /></Button>
              </Card>
            );
          })()}

          {metrics && (
            <Card className="p-4" aria-label="Publishing health">
              <h2 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>Publishing (last 24h)</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <Stat label="Published" value={metrics.last24h.published} tone={metrics.last24h.published ? "success" : undefined} />
                <Stat label="Failed" value={metrics.last24h.failed} tone={metrics.last24h.failed ? "danger" : undefined} />
                <Stat label="Retried" value={metrics.last24h.retried} tone={metrics.last24h.retried ? "warning" : undefined} />
                <Stat label="Queued" value={metrics.queued} />
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>Oldest due, unpublished</p>
                  <p className="text-sm font-bold pt-1.5" style={{ color: metrics.oldestDueSeconds && metrics.oldestDueSeconds > 600 ? "#f59e0b" : "var(--text-primary)" }}>
                    {metrics.oldestDueSeconds === null ? "none" : `${Math.max(1, Math.round(metrics.oldestDueSeconds / 60))} min overdue`}
                  </p>
                </div>
              </div>
              {metrics.needsAttention > 0 && (
                <Button variant="secondary" className="mt-3" onClick={() => navigate("/social/failures")}>
                  {metrics.needsAttention} publish{metrics.needsAttention === 1 ? "" : "es"} need attention <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </Card>
          )}

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
