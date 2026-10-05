/** Phase 17 — organization-wide security: effective policy (read-only), security events, and active sessions with revoke. */
import React, { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { adminApi, type AdminSession, type AuditLogEntry, type SecurityPolicy } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { hasPermission } from "../../lib/permissions";
import { Card, Badge, Button, LoadingState, ErrorState, EmptyState, Pagination, ConfirmDialog, DataTable, type DataTableColumn } from "../ui/ui";

type Tab = "policy" | "events" | "sessions";
const SEVERITY_TONE = { info: "neutral", warning: "warning", critical: "danger" } as const;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-2 text-xs border-b last:border-0" style={{ borderColor: "var(--border)" }}>
    <span style={{ color: "var(--text-muted)" }}>{label}</span>
    <span className="text-right font-medium" style={{ color: "var(--text-primary)" }}>
      {children}
    </span>
  </div>
);

const PolicyTab: React.FC = () => {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    adminApi.policy().then((r) => setPolicy(r.policy)).catch((e) => setError(e instanceof Error ? e.message : "Failed to load policy."));
  }, []);
  if (error) return <ErrorState message={error} />;
  if (!policy) return <LoadingState />;
  return (
    <div className="space-y-3">
      <Card className="p-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {policy.note}
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text-primary)" }}>Authentication</h3>
          <Row label="Session lifetime">{policy.sessions.ttlHours} hours</Row>
          <Row label="Session storage">{policy.sessions.tokenStorage}</Row>
          <Row label="Minimum password length">{policy.passwords.minLength}</Row>
          <Row label="Password rules">{policy.passwords.rules.join("; ")}</Row>
          <Row label="Password hashing">{policy.passwords.hashing}</Row>
          <Row label="Lockout">{policy.lockout.failedAttemptsThreshold} failures → {policy.lockout.lockDurationMinutes} min</Row>
          <Row label="Reset-link lifetime">{policy.tokens.passwordResetTtlMinutes} min</Row>
          <Row label="Invitation lifetime">{policy.tokens.invitationTtlHours} hours</Row>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text-primary)" }}>Rate limits & transport</h3>
          {policy.rateLimits.map((r) => (
            <Row key={r.name} label={r.name}>{r.limit} / {r.windowMinutes} min</Row>
          ))}
          <Row label="Rate-limit store">{policy.rateLimitStore}</Row>
          <Row label="Secure headers">{policy.transport.secureHeaders}</Row>
          <Row label="Outbound requests">HTTPS only in production, private networks blocked</Row>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text-primary)" }}>Allowed origins (CORS)</h3>
          {policy.cors.allowedOrigins.map((o) => (
            <p key={o} className="text-xs font-mono py-0.5" style={{ color: "var(--text-secondary)" }}>{o}</p>
          ))}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text-primary)" }}>Credential storage</h3>
          <Row label="Encryption">{policy.secrets.credentialEncryption}</Row>
          <Row label="Key source">{policy.secrets.keySource === "dedicated" ? "Dedicated key" : "Derived from session secret"}</Row>
        </Card>
      </div>
    </div>
  );
};

const EventsTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    adminApi.events({ page, limit: 20 })
      .then((r) => { setRows(r.items); setTotalPages(r.totalPages); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load events."))
      .finally(() => setLoading(false));
  }, [page]);
  const columns: DataTableColumn<AuditLogEntry>[] = [
    { key: "when", header: "When", cellClassName: "whitespace-nowrap", cellStyle: { color: "var(--text-muted)" }, render: (e) => new Date(e.createdAt).toLocaleString() },
    { key: "action", header: "Event", cellClassName: "font-mono", cellStyle: { color: "var(--text-primary)" }, render: (e) => e.action },
    { key: "actor", header: "Actor", cellStyle: { color: "var(--text-muted)" }, render: (e) => e.actorName ?? e.actorType },
    { key: "ip", header: "IP", cellStyle: { color: "var(--text-muted)" }, render: (e) => e.ipAddress ?? "—" },
    { key: "sev", header: "Severity", render: (e) => <Badge tone={SEVERITY_TONE[e.severity ?? "info"]}>{e.severity ?? "info"}</Badge> },
  ];
  return (
    <Card className="overflow-hidden">
      {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="No security events" description="Sign-in failures, lockouts, role and credential changes appear here." /> : <DataTable columns={columns} rows={rows} keyOf={(e) => e.id} />}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </Card>
  );
};

const SessionsTab: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "security.manage");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminSession[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<AdminSession | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminApi.sessions({ page, limit: 20 });
      setRows(r.items);
      setTotalPages(r.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }, [page]);
  useEffect(() => { void load(); }, [load]);

  const revoke = async () => {
    if (!target) return;
    try {
      await adminApi.revokeSession(target.id);
      notify("Session revoked.", "success");
      void load();
    } catch (e) {
      notify(e instanceof ApiClientError ? e.message : "Could not revoke session.", "error");
    } finally {
      setTarget(null);
    }
  };

  const columns: DataTableColumn<AdminSession>[] = [
    { key: "user", header: "User", render: (s) => (<><p className="font-semibold" style={{ color: "var(--text-primary)" }}>{s.user ? `${s.user.firstName} ${s.user.lastName}` : s.userId}</p><p style={{ color: "var(--text-muted)" }}>{s.user?.email}</p></>) },
    { key: "ip", header: "IP", cellStyle: { color: "var(--text-muted)" }, render: (s) => s.ipAddress ?? "—" },
    { key: "ua", header: "Device", cellStyle: { color: "var(--text-muted)" }, render: (s) => (s.userAgent ?? "—").slice(0, 48) },
    { key: "last", header: "Last active", cellStyle: { color: "var(--text-muted)" }, render: (s) => (s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleString() : "—") },
    { key: "exp", header: "Expires", cellStyle: { color: "var(--text-muted)" }, render: (s) => new Date(s.expiresAt).toLocaleString() },
    { key: "act", header: "", align: "right", render: (s) => (canManage ? <Button variant="danger" onClick={() => setTarget(s)}>Revoke</Button> : null) },
  ];
  return (
    <Card className="overflow-hidden">
      {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : rows.length === 0 ? <EmptyState title="No active sessions" /> : <DataTable columns={columns} rows={rows} keyOf={(s) => s.id} />}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      <ConfirmDialog open={!!target} title="Revoke session" message={`Sign ${target?.user?.email ?? "this user"} out of this device immediately? They will need to sign in again.`} confirmLabel="Revoke session" destructive onConfirm={() => void revoke()} onCancel={() => setTarget(null)} />
    </Card>
  );
};

export const SecurityCenterPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>("events");
  const tabs: { id: Tab; label: string }[] = [
    { id: "events", label: "Security events" },
    { id: "sessions", label: "Active sessions" },
    { id: "policy", label: "Policy" },
  ];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <ShieldAlert className="w-5 h-5" /> Security Center
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Monitor sign-in activity, manage sessions and review the enforced security policy.
        </p>
      </div>
      <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }} role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="px-3 py-2 text-xs font-semibold border-b-2 -mb-px" style={{ borderColor: tab === t.id ? "var(--accent, #7c3aed)" : "transparent", color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "events" && <EventsTab />}
      {tab === "sessions" && <SessionsTab />}
      {tab === "policy" && <PolicyTab />}
    </div>
  );
};
