/** Self-registered client-portal accounts waiting to be linked to a CRM client. Renders nothing unless there is something to review (and the caller is allowed to see it). */
import React, { useCallback, useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { portalRegistrationsApi, clientsApi, type PortalRegistration, type CrmClient } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Badge, Select, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

export const PortalRegistrationsPanel: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "workspaces.update");
  const canReject = hasPermission(user?.role.permissions, "workspaces.suspend");
  const [rows, setRows] = useState<PortalRegistration[]>([]);
  const [linkTarget, setLinkTarget] = useState<PortalRegistration | null>(null);
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [clientId, setClientId] = useState("");
  const [rejectTarget, setRejectTarget] = useState<PortalRegistration | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await portalRegistrationsApi.list()).registrations);
    } catch {
      setRows([]); // not an agency operator (403) or unavailable — nothing to show
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openLink = async (row: PortalRegistration) => {
    setLinkTarget(row);
    setClientId("");
    try {
      setClients((await clientsApi.list({ limit: 100, sort: "name", order: "asc" })).items);
    } catch {
      setClients([]);
    }
  };

  const doLink = async () => {
    if (!linkTarget || !clientId) return;
    setBusy(true);
    try {
      await portalRegistrationsApi.link(linkTarget.organizationId, clientId);
      notify("Portal account linked and activated.", "success");
      setLinkTarget(null);
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not link the account.", "error");
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    try {
      await portalRegistrationsApi.reject(rejectTarget.organizationId);
      notify("Registration rejected.", "success");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not reject the registration.", "error");
    } finally {
      setRejectTarget(null);
    }
  };

  if (rows.length === 0) return null;

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
        <UserCheck className="w-4 h-4" style={{ color: "var(--accent)" }} />
        <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          Pending client portal registrations
        </h2>
        <Badge tone="warning">{rows.length}</Badge>
      </div>
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {rows.map((r) => (
          <li key={r.organizationId} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div>
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {r.organizationName}
              </p>
              <p style={{ color: "var(--text-muted)" }}>
                {r.contactName} · {r.contactEmail} · {new Date(r.registeredAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={r.emailVerified ? "success" : "neutral"}>{r.emailVerified ? "Email verified" : "Email unverified"}</Badge>
              {canUpdate && (
                <Button variant="primary" onClick={() => void openLink(r)}>
                  Link to client
                </Button>
              )}
              {canReject && (
                <Button variant="danger" onClick={() => setRejectTarget(r)}>
                  Reject
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Modal open={!!linkTarget} onClose={() => setLinkTarget(null)} title="Link portal account to a client">
        <div className="space-y-3">
          <Field label="CRM client" hint="The account will see this client's contracts, invoices and onboarding in the portal.">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full">
              <option value="">Select a client…</option>
              {clients
                .filter((c) => !c.workspaceOrganizationId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setLinkTarget(null)}>Cancel</Button>
            <Button variant="primary" disabled={!clientId || busy} onClick={() => void doLink()}>
              {busy ? "Linking…" : "Link and activate"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!rejectTarget}
        title="Reject registration"
        message="The account will be suspended and any active sessions ended."
        confirmLabel="Reject"
        destructive
        onConfirm={() => void doReject()}
        onCancel={() => setRejectTarget(null)}
      />
    </Card>
  );
};
