/**
 * Roles. System roles are protected and read-only. Phase 17 adds platform-level
 * custom roles (SUPER_ADMIN only): create, edit permissions, delete — with the
 * server enforcing every rule shown here (this UI is convenience, not security).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Lock, Plus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { rolesApi, permissionsApi, type ResolvedRole, type Permission } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { hasPermission } from "../../lib/permissions";
import { Card, Badge, Button, Input, Field, Modal, ConfirmDialog, LoadingState, ErrorState } from "../ui/ui";

/** Mirrors server/services/admin/criticalPermissions.ts. */
const CRITICAL = new Set(["roles.create", "roles.update", "roles.delete", "roles.assign", "users.delete", "organizations.delete", "settings.manage", "security.manage", "integrations.manage", "webhooks.manage", "api_keys.manage"]);

const RoleEditor: React.FC<{ open: boolean; role: ResolvedRole | null; catalog: Permission[]; onClose: () => void; onSaved: () => void }> = ({ open, role, catalog, onClose, onSaved }) => {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [confirmCritical, setConfirmCritical] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setSelected(new Set(role?.permissions ?? []));
    setFilter("");
    setConfirmCritical(false);
    setError(null);
  }, [open, role]);

  const grouped = useMemo(() => {
    const out = new Map<string, Permission[]>();
    for (const p of catalog) {
      if (filter && !p.key.includes(filter.toLowerCase())) continue;
      out.set(p.module, [...(out.get(p.module) ?? []), p]);
    }
    return [...out.entries()];
  }, [catalog, filter]);

  const criticalSelected = [...selected].filter((k) => CRITICAL.has(k));
  const toggle = (k: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const keys = [...selected];
      if (role) {
        if (name !== role.name || (description || null) !== (role.description ?? null)) await rolesApi.update(role.id, { name, description: description || null });
        await rolesApi.setPermissions(role.id, keys, confirmCritical);
        notify("Role updated.", "success");
      } else {
        await rolesApi.create({ name, description: description || undefined, permissionKeys: keys, confirmCritical });
        notify("Role created.", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save role.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={role ? `Edit ${role.name}` : "Create custom role"}>
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Name"><Input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description (optional)"><Input maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label={`Permissions (${selected.size} selected)`}>
          <Input placeholder="Filter permissions…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-1.5" />
          <div className="max-h-56 overflow-y-auto border rounded-lg p-2 space-y-2" style={{ borderColor: "var(--border)" }}>
            {grouped.map(([module, perms]) => (
              <div key={module}>
                <p className="text-[10px] uppercase font-bold mb-0.5" style={{ color: "var(--text-muted)" }}>{module}</p>
                {perms.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 text-xs font-mono py-0.5">
                    <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} /> {p.key}
                    {CRITICAL.has(p.key) && <Badge tone="danger">critical</Badge>}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </Field>
        {criticalSelected.length > 0 && (
          <label className="flex items-start gap-2 text-xs rounded-lg p-2 bg-rose-500/10 border border-rose-500/30" style={{ color: "var(--text-primary)" }}>
            <input type="checkbox" checked={confirmCritical} onChange={(e) => setConfirmCritical(e.target.checked)} className="mt-0.5" />
            <span>This role grants permissions that control security, credentials or access ({criticalSelected.join(", ")}). I understand anyone assigned this role can use them.</span>
          </label>
        )}
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || (criticalSelected.length > 0 && !confirmCritical)}>{role ? "Save role" : "Create role"}</Button>
        </div>
      </form>
    </Modal>
  );
};

export const RolesPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "roles.create");
  const canUpdate = hasPermission(user?.role.permissions, "roles.update");
  const canDelete = hasPermission(user?.role.permissions, "roles.delete");
  const [roles, setRoles] = useState<ResolvedRole[]>([]);
  const [catalog, setCatalog] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ role: ResolvedRole | null } | null>(null);
  const [deleting, setDeleting] = useState<ResolvedRole | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([rolesApi.list(), permissionsApi.list()]);
      setRoles(r.roles);
      setCatalog(p.permissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async () => {
    if (!deleting) return;
    try {
      await rolesApi.remove(deleting.id);
      notify("Role deleted.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete role.", "error");
    } finally {
      setDeleting(null);
      void load();
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <ShieldCheck className="w-5 h-5" /> Roles
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            System roles are protected. Custom roles are platform-wide and managed by Super Administrators. Assign roles to people on the Users page.
          </p>
        </div>
        {canCreate && <Button variant="primary" onClick={() => setEditor({ role: null })}><Plus className="w-4 h-4" /> Create role</Button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {roles.map((role) => (
          <Card key={role.id} className="p-4">
            <div className="flex items-center justify-between mb-1 gap-2">
              <h2 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                {role.isSystem && <Lock className="w-3 h-3" aria-label="System role" />} {role.name}
              </h2>
              <Badge tone={role.key === "SUPER_ADMIN" ? "danger" : role.isSystem ? "neutral" : "info"}>{role.isSystem ? role.key : "Custom"}</Badge>
            </div>
            {role.description && <p className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>{role.description}</p>}
            <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
              {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"} · {role.memberCount ?? 0} assignment{(role.memberCount ?? 0) === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {role.permissions.slice(0, 30).map((p) => (
                <span key={p} className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>{p}</span>
              ))}
              {role.permissions.length > 30 && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>+{role.permissions.length - 30} more</span>}
            </div>
            {!role.isSystem && (canUpdate || canDelete) && (
              <div className="flex gap-2 mt-3">
                {canUpdate && <Button variant="secondary" onClick={() => setEditor({ role })}>Edit</Button>}
                {canDelete && <Button variant="danger" onClick={() => setDeleting(role)}>Delete</Button>}
              </div>
            )}
          </Card>
        ))}
      </div>

      <RoleEditor open={!!editor} role={editor?.role ?? null} catalog={catalog} onClose={() => setEditor(null)} onSaved={() => void load()} />
      <ConfirmDialog open={!!deleting} title="Delete role" message={`Delete the custom role “${deleting?.name}”? This only works if nobody is assigned to it.`} confirmLabel="Delete role" destructive onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />
    </div>
  );
};
