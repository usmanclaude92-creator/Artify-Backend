/** Publishing Queue: upcoming and in-progress publishes with live countdowns, plus the current publishing mode. */
import React, { useCallback, useEffect, useState } from "react";
import { Clock, Send, PauseCircle, FlaskConical, ArrowRight } from "lucide-react";
import { socialPublishingApi, type PublishingMetrics, type PublishingSettingsView, type PublishingTarget } from "../../lib/api";
import { useRouter } from "../../lib/router";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { Card, Button, LoadingState, ErrorState, EmptyState } from "../ui/ui";
import { ProviderAvatar, formatCountdown } from "./socialShared";
import { PROVIDER_LABEL, REASON_LABEL, TargetStatusBadge } from "./socialPublishingShared";

export const ModeBanner: React.FC<{ settings: PublishingSettingsView }> = ({ settings }) => {
  const e = settings.effective;
  const [Icon, tone, title, text] = !e.publishing
    ? [PauseCircle, "#f59e0b", "Publishing is paused", REASON_LABEL[(e as { reason: string }).reason] ?? "Publishing is off."]
    : e.dryRun
      ? [FlaskConical, "#0891b2", "Dry-run mode", "Everything runs except the final send. Nothing is posted to any network."]
      : [Send, "#10b981", "Publishing is live", "Due posts are sent automatically."];
  return (
    <Card className="p-3 flex items-start gap-3" role="status" aria-label="Publishing mode">
      <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: tone }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{title}</p>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{text}</p>
      </div>
    </Card>
  );
};

export const SocialQueuePage: React.FC = () => {
  const { navigate } = useRouter();
  const { current } = useActiveWorkspace();
  const [items, setItems] = useState<PublishingTarget[] | null>(null);
  const [settings, setSettings] = useState<PublishingSettingsView | null>(null);
  const [metrics, setMetrics] = useState<PublishingMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    Promise.all([socialPublishingApi.queue(), socialPublishingApi.settings(), socialPublishingApi.metrics()])
      .then(([q, s, m]) => { setItems(q.items); setSettings(s); setMetrics(m); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the publishing queue."));
  }, []);

  useEffect(() => { setItems(null); load(); }, [load, current?.organizationId]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(load, 30_000);
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Clock className="w-5 h-5" style={{ color: "var(--accent)" }} /> Publishing Queue
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Scheduled and in-progress publishes. The scheduler checks every few minutes.</p>
        </div>
        <Button variant="secondary" onClick={() => navigate("/social/failures")}>Failures &amp; settings <ArrowRight className="w-3.5 h-3.5" /></Button>
      </div>

      {error ? <ErrorState message={error} /> : items === null || !settings ? <LoadingState /> : (
        <>
          <ModeBanner settings={settings} />
          {metrics && metrics.oldestDueSeconds !== null && metrics.oldestDueSeconds > 600 && (
            <Card className="p-3 text-xs" style={{ color: "#b45309" }} role="alert">
              The oldest due post is {Math.round(metrics.oldestDueSeconds / 60)} minutes overdue — the scheduler may be paused or delayed.
            </Card>
          )}
          {items.length === 0 ? (
            <Card><EmptyState title="Nothing queued" description="Schedule an approved post from the Composer and it will appear here." /></Card>
          ) : (
            <Card className="divide-y" style={{ borderColor: "var(--border)" }}>
              {items.map((t) => (
                <div key={t.id} className="p-3 flex items-center gap-3 flex-wrap">
                  <ProviderAvatar account={t.account} />
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>{t.post.title}</p>
                    <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                      {t.account.displayName} · {PROVIDER_LABEL[t.account.provider] ?? t.account.provider} · {t.scheduledAt ? new Date(t.scheduledAt).toLocaleString() : "no time"}
                    </p>
                    {t.nextAttemptAt && t.status === "SCHEDULED" && (
                      <p className="text-[11px]" style={{ color: "#b45309" }}>Retry {formatCountdown(t.nextAttemptAt, now)} (attempt {t.attempts + 1})</p>
                    )}
                  </div>
                  <span className="text-xs font-mono tabular-nums" style={{ color: "var(--text-secondary)" }} aria-label="Countdown">
                    {t.status === "PUBLISHING" ? "sending…" : formatCountdown(t.scheduledAt, now)}
                  </span>
                  <TargetStatusBadge status={t.status} />
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
};
