/** Phase 4 §13 — real data, permission-scoped actions, no password hashes/tokens ever rendered. */
import React, { useEffect, useState } from "react";
import { Users as UsersIcon, Plus, Search } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { usersApi, rolesApi, type SanitizedUser, type AdminSession } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, Select, ConfirmDialog, DataTable, type DataTableColumn } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const FALLBACK_ROLES = ["ADMIN", "MANAGER", "USER", "VIEWER"];
const STATUS_TONE: Record<string, "success" | "warning" | "danger"> = { ACTIVE: "success", INVITED: "warning", DISABLED: "danger" };

const UserFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mode: "create" | "edit";
  user?: SanitizedUser;
  canAssignRole: boolean;
  roleOptions: string[];
}> = ({ open, onClose, onSaved, mode, user, canAssignRole, roleOptions }) => {
  const { notify } = useToast();
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [roleKey, setRoleKey] = useState(user?.role.key && user.role.key !== "SUPER_ADMIN" ? user.role.key : "VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(user?.email ?? "");
      setPassword("");
      setFirstName(user?.firstName ?? "");
      setLastName(user?.lastName ?? "");
      setRoleKey(user?.role.key && user.role.key !== "SUPER_ADMIN" ? user.role.key : "VIEWER");
      setError(null);
    }
  }, [open, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        await usersApi.create({ email, password, firstName, lastName, roleKey });
        notify("User created.", "success");
      } else if (user) {
        const payload: Parameters<typeof usersApi.update>[1] = { firstName, lastName };
        if (canAssignRole && roleKey !== user.role.key) payload.roleKey = roleKey;
        await usersApi.update(user.id, payload);
        notify("User updated.", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save user.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "Invite user" : `Edit ${user?.displayName ?? user?.email}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <Input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" required disabled={mode === "edit"} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode === "create" && (
          <Field label="Initial password" hint="At least 10 characters. Share with the user out-of-band.">
            <Input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {canAssignRole && (mode === "create" || user?.id !== undefined) && (
          <Field label="Role">
            <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)} disabled={mode === "edit" && user?.role.key === "SUPER_ADMIN"}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create user" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const UserSecurityModal: React.FC<{ user: SanitizedUser | null; canManage: boolean; canViewSessions: boolean; onClose: () => void }> = ({ user, canManage, canViewSessions, onClose }) => {
  const { notify } = useToast();
  const [sessions, setSessions] = useState<AdminSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"revoke" | "unlock" | null>(null);

  const load = React.useCallback(async () => {
    if (!user || !canViewSessions) return;
    try {
      setSessions((await usersApi.sessions(user.id)).sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sessions.");
    }
  }, [user, canViewSessions]);
  useEffect(() => { setSessions(null); setError(null); void load(); }, [load]);

  const run = async () => {
    if (!user || !confirm) return;
    try {
      if (confirm === "revoke") {
        const r = await usersApi.revokeSessions(user.id);
        notify(`Signed out ${r.revoked} session${r.revoked === 1 ? "" : "s"}.`, "success");
      } else {
        await usersApi.unlock(user.id);
        notify("Account unlocked.", "success");
      }
    } catch (e) {
      notify(e instanceof ApiClientError ? e.message : "Action failed.", "error");
    } finally {
      setConfirm(null);
      void load();
    }
  };

  return (
    <Modal open={!!user} onClose={onClose} title={`Security — ${user?.displayName ?? user?.email ?? ""}`}>
      <div className="space-y-3">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Role: <Badge tone="info">{user?.role.key ?? ""}</Badge> · Status: {user?.status}
        </p>
        {canViewSessions && (
          <div>
            <p className="text-[10px] uppercase font-bold mb-1" style={{ color: "var(--text-muted)" }}>Active sessions</p>
            {error ? (
              <ErrorState message={error} />
            ) : sessions === null ? (
              <LoadingState />
            ) : sessions.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>No active sessions.</p>
            ) : (
              <ul className="text-xs divide-y" style={{ borderColor: "var(--border)" }}>
                {sessions.map((s) => (
                  <li key={s.id} className="py-1.5 flex justify-between gap-3">
                    <span style={{ color: "var(--text-primary)" }}>{(s.userAgent ?? "Unknown device").slice(0, 40)} · {s.ipAddress ?? "unknown IP"}</span>
                    <span style={{ color: "var(--text-muted)" }}>{s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleString() : "never used"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <Button variant="danger" onClick={() => setConfirm("revoke")}>Sign out everywhere</Button>
            <Button variant="secondary" onClick={() => setConfirm("unlock")}>Unlock account</Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "revoke" ? "Sign out everywhere" : "Unlock account"}
        message={confirm === "revoke" ? `End every active session for ${user?.email}? They will have to sign in again on all devices.` : `Clear the sign-in lockout for ${user?.email}?`}
        confirmLabel={confirm === "revoke" ? "Sign out everywhere" : "Unlock"}
        destructive={confirm === "revoke"}
        onConfirm={() => void run()}
        onCancel={() => setConfirm(null)}
      />
    </Modal>
  );
};

export const UsersPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(currentUser?.role.permissions, "users.create");
  const canUpdate = hasPermission(currentUser?.role.permissions, "users.update");
  const canAssignRole = hasPermission(currentUser?.role.permissions, "roles.assign");
  const canViewSessions = hasPermission(currentUser?.role.permissions, "security.read");
  const canManageSecurity = hasPermission(currentUser?.role.permissions, "users.update");
  const [roleOptions, setRoleOptions] = useState<string[]>(FALLBACK_ROLES);
  const [securityUser, setSecurityUser] = useState<SanitizedUser | null>(null);

  useEffect(() => {
    if (!hasPermission(currentUser?.role.permissions, "roles.read")) return;
    rolesApi
      .list()
      .then((r) => setRoleOptions(r.roles.map((x) => x.key).filter((k) => k !== "SUPER_ADMIN")))
      .catch(() => setRoleOptions(FALLBACK_ROLES));
  }, [currentUser]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<SanitizedUser[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; user?: SanitizedUser } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await usersApi.list({ page, limit: 20 });
      setUsers(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const [deactivating, setDeactivating] = useState<SanitizedUser | null>(null);
  const toggleStatus = async (u: SanitizedUser) => {
    try {
      await usersApi.update(u.id, { status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE" });
      notify(u.status === "ACTIVE" ? "User deactivated." : "User activated.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update user.", "error");
    }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.email.toLowerCase().includes(q) || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q);
  });

  const userColumns: DataTableColumn<SanitizedUser>[] = [
    {
      key: "name",
      header: "Name",
      render: (u) => (
        <>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {u.displayName ?? `${u.firstName} ${u.lastName}`}
            {u.id === currentUser?.id && (
              <span className="ml-1 text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
                (you)
              </span>
            )}
          </p>
          <p style={{ color: "var(--text-muted)" }}>{u.email}</p>
        </>
      ),
    },
    { key: "role", header: "Role", render: (u) => <Badge tone="info">{u.role.key}</Badge> },
    { key: "status", header: "Status", render: (u) => <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge> },
    {
      key: "lastLogin",
      header: "Last login",
      cellStyle: { color: "var(--text-muted)" },
      render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (u) => (
        <>
          {canUpdate && (
            <Button variant="secondary" onClick={() => setModal({ mode: "edit", user: u })}>
              Edit
            </Button>
          )}
          {(canManageSecurity || canViewSessions) && (
            <Button variant="secondary" onClick={() => setSecurityUser(u)}>
              Security
            </Button>
          )}
          {canUpdate && u.id !== currentUser?.id && (
            <Button variant={u.status === "ACTIVE" ? "danger" : "primary"} onClick={() => (u.status === "ACTIVE" ? setDeactivating(u) : void toggleStatus(u))}>
              {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
            </Button>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <UsersIcon className="w-5 h-5" /> Users
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Manage accounts in your organization.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setModal({ mode: "create" })}>
            <Plus className="w-4 h-4" /> Invite user
          </Button>
        )}
      </div>

      <Card className="p-3">
        <div className="relative max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search this page…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No users found" description="Invite a user or adjust your search." />
        ) : (
          <DataTable columns={userColumns} rows={filtered} keyOf={(u) => u.id} />
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>

      <UserFormModal
        open={!!modal}
        onClose={() => setModal(null)}
        onSaved={load}
        mode={modal?.mode ?? "create"}
        user={modal?.user}
        canAssignRole={canAssignRole}
        roleOptions={roleOptions}
      />
      <ConfirmDialog
        open={!!deactivating}
        title="Deactivate user"
        message={`Deactivate ${deactivating?.email}? They are signed out everywhere immediately and cannot sign in until reactivated.`}
        confirmLabel="Deactivate"
        destructive
        onCancel={() => setDeactivating(null)}
        onConfirm={() => { const u = deactivating!; setDeactivating(null); void toggleStatus(u); }}
      />
      <UserSecurityModal user={securityUser} canManage={canManageSecurity} canViewSessions={canViewSessions} onClose={() => setSecurityUser(null)} />
    </div>
  );
};
