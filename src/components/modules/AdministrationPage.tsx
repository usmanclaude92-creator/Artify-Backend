/** Phase 17 — Administration dashboard. Every figure is a real, organization-scoped count from the backend; nothing is estimated. */
import React, { useEffect, useState } from "react";
import { Gauge, Users, ShieldCheck, MonitorSmartphone, ShieldAlert, Plug, Webhook, KeyRound } from "lucide-react";
import { adminApi, type AdminOverview } from "../../lib/api";
import { useRouter } from "../../lib/router";
import { Card, Badge, LoadingState, ErrorState, EmptyState } from "../ui/ui";

const SEVERITY_TONE = { info: "neutral", warning: "warning", critical: "danger" } as const;

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: "danger" | "warning" }> = ({ label, value, hint, tone }) => (
  <div>
    <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>
      {label}
    </p>
    <p className="text-2xl font-bold" style={{ color: tone === "danger" ? "#f43f5e" : tone === "warning" ? "#f59e0b" : "var(--text-primary)" }}>
      {value}
    </p>
    {hint && (
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {hint}
      </p>
    )}
  </div>
);

const Section: React.FC<{ icon: React.ElementType; title: string; to?: string; children: React.ReactNode }> = ({ icon: Icon, title, to, children }) => {
  const { navigate } = useRouter();
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Icon className="w-4 h-4" /> {title}
        </h2>
        {to && (
          <button className="text-[11px] underline" style={{ color: "var(--text-muted)" }} onClick={() => navigate(to)}>
            Manage
          </button>
        )}
      </div>
      {children}
    </Card>
  );
};

export const AdministrationPage: React.FC = () => {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .overview()
      .then((res) => setOverview(res.overview))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the administration overview."));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!overview) return <LoadingState />;
  const { users, roles, sessions, security, integrations } = overview;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Gauge className="w-5 h-5" /> Administration
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Users, access, security and integrations for your organization — live data only.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Section icon={Users} title="Users" to="/users">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Total" value={users.total} />
            <Stat label="Active" value={users.active} />
            <Stat label="Disabled" value={users.disabled} tone={users.disabled > 0 ? "warning" : undefined} />
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {users.invited} invited · {users.lockedNow} currently locked out
          </p>
        </Section>

        <Section icon={ShieldCheck} title="Roles" to="/roles">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Roles" value={roles.total} hint={`${roles.custom} custom`} />
            <Stat label="Assignments" value={roles.distribution.reduce((n, d) => n + d.members, 0)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {roles.distribution.map((d) => (
              <Badge key={d.roleKey} tone="info">
                {d.roleName}: {d.members}
              </Badge>
            ))}
          </div>
        </Section>

        <Section icon={MonitorSmartphone} title="Sessions" to="/security-center">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Active now" value={sessions.active} />
            <Stat label="Started in 24h" value={sessions.createdLast24h} />
          </div>
        </Section>

        <Section icon={ShieldAlert} title="Security (last 24h / 7d)" to="/security-center">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Failed sign-ins" value={security.failedLogins24h} tone={security.failedLogins24h > 0 ? "warning" : undefined} />
            <Stat label="Lockouts (7d)" value={security.lockoutsLast7d} tone={security.lockoutsLast7d > 0 ? "warning" : undefined} />
            <Stat label="Keys expiring (14d)" value={security.expiringApiKeys14d} tone={security.expiringApiKeys14d > 0 ? "warning" : undefined} />
          </div>
        </Section>

        <Section icon={Plug} title="Integrations" to="/integrations">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="System configured" value={`${integrations.systemConfigured}/${integrations.systemTotal}`} hint="from deployment configuration" />
            <Stat label="Failing" value={integrations.configurableFailing} tone={integrations.configurableFailing > 0 ? "danger" : undefined} hint={`${integrations.configurableEnabled} enabled`} />
          </div>
        </Section>

        <Section icon={Webhook} title="Webhooks & API keys" to="/integrations">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Endpoints" value={integrations.webhookEndpoints.enabled} hint={`${integrations.webhookEndpoints.total} total`} />
            <Stat label="Failed (24h)" value={integrations.webhookEndpoints.failedDeliveries24h} tone={integrations.webhookEndpoints.failedDeliveries24h > 0 ? "danger" : undefined} hint={`${integrations.webhookEndpoints.retrying} retrying`} />
            <Stat label="API keys" value={integrations.apiKeys.active} />
          </div>
        </Section>
      </div>

      {overview.organizations && (
        <Card className="p-4">
          <p className="text-xs font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <KeyRound className="w-4 h-4" /> Platform: {overview.organizations.visibleToCaller} organizations (
            {Object.entries(overview.organizations.byStatus).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(", ")})
          </p>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>
          Recent administrative activity
        </h2>
        {overview.recentActivity.length === 0 ? (
          <EmptyState title="No administrative activity yet" />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {overview.recentActivity.map((a) => (
              <li key={a.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <span className="font-mono" style={{ color: "var(--text-primary)" }}>
                    {a.action}
                  </span>
                  <span className="ml-2" style={{ color: "var(--text-muted)" }}>
                    {a.actorName ?? a.actorType}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                  <span style={{ color: "var(--text-muted)" }}>{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
