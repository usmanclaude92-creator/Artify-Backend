import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { apiKeysApi, type ApiKeySummary } from "../../../lib/api";
import { ApiClientError } from "../../../lib/apiClient";
import { hasPermission } from "../../../lib/permissions";
import { Card, Badge, Button, Input, Field, Select, Modal, ConfirmDialog, LoadingState, ErrorState, EmptyState, DataTable, type DataTableColumn } from "../../ui/ui";
import { SecretRevealModal } from "./SecretRevealModal";

/** Mirrors server/services/admin/criticalPermissions.ts — hidden from the picker because the API rejects them anyway. */
const ADMIN_ONLY = new Set(["roles.create", "roles.update", "roles.delete", "roles.assign", "users.delete", "organizations.delete", "settings.manage", "security.manage", "integrations.manage", "webhooks.manage", "api_keys.manage"]);
const STATUS_TONE = { active: "success", revoked: "neutral", expired: "warning" } as const;
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

const CreateKeyModal: React.FC<{ open: boolean; onClose: () => void; onCreated: (key: string) => void }> = ({ open, onClose, onCreated }) => {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [scopes, setScopes] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A key can never exceed what its creator holds (enforced server-side; mirrored here for UX).
  const available = useMemo(() => (user?.role.permissions ?? []).filter((p) => !ADMIN_ONLY.has(p)).sort(), [user]);
  const visible = available.filter((p) => p.includes(filter.toLowerCase()));

  useEffect(() => { if (open) { setName(""); setDays("90"); setScopes([]); setFilter(""); setError(null); } }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiKeysApi.create({ name, scopes, ...(days ? { expiresInDays: Number(days) } : {}) });
      onCreated(res.key);
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create API key.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create API key">
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Reporting integration" /></Field>
        <Field label="Expires">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="180">In 180 days</option>
            <option value="365">In 1 year</option>
          </Select>
        </Field>
        <Field label={`Scopes (${scopes.length} selected)`} hint="Limit the key to the least access it needs. You can only grant permissions you hold yourself.">
          <Input placeholder="Filter scopes…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-1.5" />
          <div className="max-h-44 overflow-y-auto border rounded-lg p-2 space-y-1" style={{ borderColor: "var(--border)" }}>
            {visible.map((p) => (
              <label key={p} className="flex items-center gap-2 text-xs font-mono">
                <input type="checkbox" checked={scopes.includes(p)} onChange={() => setScopes((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]))} /> {p}
              </label>
            ))}
          </div>
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || scopes.length === 0}>Create key</Button>
        </div>
      </form>
    </Modal>
  );
};

export const ApiKeysPanel: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "api_keys.manage");
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys((await apiKeysApi.list()).apiKeys);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const revoke = async () => {
    if (!revoking) return;
    try {
      await apiKeysApi.revoke(revoking.id);
      notify("API key revoked.", "success");
    } catch (e) {
      notify(e instanceof ApiClientError ? e.message : "Could not revoke key.", "error");
    } finally {
      setRevoking(null);
      void load();
    }
  };

  const columns: DataTableColumn<ApiKeySummary>[] = [
    { key: "name", header: "Name", render: (k) => (<><p className="font-semibold" style={{ color: "var(--text-primary)" }}>{k.name}</p><p className="font-mono" style={{ color: "var(--text-muted)" }}>{k.prefix}…</p></>) },
    { key: "scopes", header: "Scopes", cellStyle: { color: "var(--text-muted)" }, render: (k) => (k.scopes.length > 3 ? `${k.scopes.slice(0, 3).join(", ")} +${k.scopes.length - 3}` : k.scopes.join(", ")) },
    { key: "status", header: "Status", render: (k) => <Badge tone={STATUS_TONE[k.status]}>{k.status}</Badge> },
    { key: "expires", header: "Expires", cellStyle: { color: "var(--text-muted)" }, render: (k) => (k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never") },
    { key: "used", header: "Last used", cellStyle: { color: "var(--text-muted)" }, render: (k) => when(k.lastUsedAt) },
    { key: "act", header: "", align: "right", render: (k) => (canManage && k.status === "active" ? <Button variant="danger" onClick={() => setRevoking(k)}>Revoke</Button> : null) },
  ];

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Keys authenticate machine access to <span className="font-mono">/api/v1/external/*</span>. A key is shown once when created and stored only as a hash; keys are scoped, expire, and can be revoked instantly.
        </p>
        {canManage && <Button variant="primary" onClick={() => setCreating(true)}>Create API key</Button>}
      </div>
      <Card className="overflow-hidden">
        {keys.length === 0 ? <EmptyState title="No API keys" description="Create a key to let an external system call the Artify API." /> : <DataTable columns={columns} rows={keys} keyOf={(k) => k.id} />}
      </Card>
      <CreateKeyModal open={creating} onClose={() => setCreating(false)} onCreated={(k) => { setNewKey(k); void load(); }} />
      <SecretRevealModal title="Your new API key" label="API key" secret={newKey} onClose={() => setNewKey(null)} />
      <ConfirmDialog open={!!revoking} title="Revoke API key" message={`Revoke “${revoking?.name}”? Any system using it stops working immediately. This cannot be undone.`} confirmLabel="Revoke key" destructive onCancel={() => setRevoking(null)} onConfirm={() => void revoke()} />
    </div>
  );
};
