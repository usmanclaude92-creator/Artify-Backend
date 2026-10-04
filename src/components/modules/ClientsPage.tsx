/** Phase 5 §24-26 — Clients: list/search/filter/pagination + master-detail with embedded contact management. Phase 6 §28 adds onboarding/workspace provisioning. */
import React, { useEffect, useState } from "react";
import { Building2, Plus, Search, UserPlus, Star, Trash2, Rocket, ClipboardCheck, Ban, History, TrendingUp, FileSignature, Repeat, Receipt } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  clientsApi,
  contactsApi,
  workspacesApi,
  onboardingApi,
  usersApi,
  industriesApi,
  opportunitiesApi,
  contractsApi,
  subscriptionsApi,
  invoicesApi,
  mediaApi,
  type CrmClient,
  type CrmContact,
  type ClientStatusValue,
  type Onboarding,
  type OnboardingChecklistItem,
  type SanitizedUser,
  type Industry,
  type Opportunity,
  type Contract,
  type Subscription,
  type Invoice,
  type CmsMedia,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";
import { formatMoney } from "../../lib/money";
import { STAGE_LABEL, STAGE_TONE } from "./OpportunitiesPage";
import { ActivityTimelineModal } from "./ActivityTimelineModal";
import { ClientDocumentsPanel } from "./ClientDocumentsPanel";

/** Generic status-badge tone for Contract/Subscription/Invoice statuses — these three resources don't share one enum, but ACTIVE/PAID-like "good" statuses and TERMINATED/VOID/CANCELLED-like "bad" statuses are consistent in spirit, so one small heuristic covers all three without duplicating three full tone tables here. */
function genericStatusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (["ACTIVE", "PAID", "READY", "COMPLETED"].includes(status)) return "success";
  if (["DRAFT", "PROSPECT"].includes(status)) return "neutral";
  if (["TERMINATED", "VOID", "CANCELLED", "EXPIRED", "OVERDUE", "FAILED"].includes(status)) return "danger";
  return "info";
}

const PROVISIONING_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  NOT_PROVISIONED: "neutral",
  PROVISIONING: "info",
  PROVISIONED: "success",
  SUSPENDED: "danger",
};
const ONBOARDING_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "warning",
  READY: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
};

const STATUS_OPTIONS: ClientStatusValue[] = ["PROSPECT", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"];
const STATUS_TONE: Record<ClientStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PROSPECT: "info",
  ACTIVE: "success",
  INACTIVE: "neutral",
  SUSPENDED: "warning",
  ARCHIVED: "danger",
};

const ClientFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (client?: CrmClient) => void;
  mode: "create" | "edit";
  client?: CrmClient;
}> = ({ open, onClose, onSaved, mode, client }) => {
  const { notify } = useToast();
  const [clientCode, setClientCode] = useState(client?.clientCode ?? "");
  const [name, setName] = useState(client?.name ?? "");
  const [legalName, setLegalName] = useState(client?.legalName ?? "");
  const [status, setStatus] = useState<ClientStatusValue>(client?.status ?? "PROSPECT");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [website, setWebsite] = useState(client?.website ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [source, setSource] = useState(client?.source ?? "");
  const [industryId, setIndustryId] = useState(client?.industryId ?? "");
  const [accountManager, setAccountManager] = useState(client?.accountManager ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [users, setUsers] = useState<SanitizedUser[]>([]);

  useEffect(() => {
    if (open) {
      setClientCode(client?.clientCode ?? "");
      setName(client?.name ?? "");
      setLegalName(client?.legalName ?? "");
      setStatus(client?.status ?? "PROSPECT");
      setEmail(client?.email ?? "");
      setPhone(client?.phone ?? "");
      setWebsite(client?.website ?? "");
      setAddress(client?.address ?? "");
      setNotes(client?.notes ?? "");
      setSource(client?.source ?? "");
      setIndustryId(client?.industryId ?? "");
      setAccountManager(client?.accountManager ?? "");
      setError(null);
      void industriesApi.list().then((res) => setIndustries(res.industries));
      void usersApi.list({ limit: 100 }).then((res) => setUsers(res.items));
    }
  }, [open, client]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await clientsApi.create({
          clientCode,
          name,
          legalName,
          status,
          email,
          phone,
          website,
          address,
          notes,
          source: source || undefined,
          industryId: industryId || undefined,
          accountManager: accountManager || undefined,
        });
        notify("Client created.", "success");
        onSaved(res.client);
      } else if (client) {
        const res = await clientsApi.update(client.id, {
          name,
          legalName,
          status,
          email,
          phone,
          website,
          address,
          notes,
          source: source || null,
          industryId: industryId || null,
          accountManager: accountManager || null,
        });
        notify("Client updated.", "success");
        onSaved(res.client);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save client.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New client" : `Edit ${client?.name}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client code">
            <Input required disabled={mode === "edit"} value={clientCode} onChange={(e) => setClientCode(e.target.value)} />
          </Field>
          <Field label="Display name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Legal / business name">
          <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Website">
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ClientStatusValue)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Industry">
            <Select value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
              <option value="">Unspecified</option>
              {industries.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source" hint="e.g. referral, converted_lead">
            <Input value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
        </div>
        <Field label="Account manager">
          <Select value={accountManager} onChange={(e) => setAccountManager(e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create client" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ContactFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; clientId: string }> = ({
  open,
  onClose,
  onSaved,
  clientId,
}) => {
  const { notify } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setJobTitle("");
      setIsPrimary(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await clientsApi.addContact(clientId, { firstName, lastName, email, phone, jobTitle, isPrimary });
      notify("Contact added.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add contact.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add contact">
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Job title">
          <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
          Set as primary contact
        </label>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Add contact
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const InviteAdminModal: React.FC<{ open: boolean; onClose: () => void; workspaceId: string; onSent: () => void }> = ({
  open,
  onClose,
  workspaceId,
  onSent,
}) => {
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setError(null);
      setDevToken(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await workspacesApi.invite(workspaceId, email);
      notify("Invitation sent.", "success");
      if (res.devToken) setDevToken(res.devToken);
      onSent();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not send invitation.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite workspace administrator">
      {devToken ? (
        <div className="space-y-3">
          <div className="text-xs rounded-lg px-3 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
            Invitation created. No email provider is configured yet (Phase 13) — share this acceptance link directly for now.
          </div>
          <Input readOnly value={`${window.location.origin}/accept-invitation?token=${devToken}`} onFocus={(e) => e.target.select()} />
          <div className="pt-2 border-t flex justify-end" style={{ borderColor: "var(--border)" }}>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              Send invitation
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

/** Phase 13 — per-step due date/assignee/notes, and (if the step requires one) attaching an already-uploaded client document. */
const StepEditModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onboardingId: string;
  step: OnboardingChecklistItem | null;
  users: SanitizedUser[];
  documents: CmsMedia[];
  onSaved: () => void;
}> = ({ open, onClose, onboardingId, step, users, documents, onSaved }) => {
  const { notify } = useToast();
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [documentMediaId, setDocumentMediaId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && step) {
      setDueDate(step.dueDate?.slice(0, 10) ?? "");
      setAssignedTo(step.assignedTo ?? "");
      setNotes(step.notes ?? "");
      setDocumentMediaId(step.documentMediaId ?? "");
    }
  }, [open, step]);

  if (!step) return null;

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await onboardingApi.updateStep(onboardingId, step.key, {
        dueDate: dueDate || null,
        assignedTo: assignedTo || null,
        notes: notes || null,
        documentMediaId: documentMediaId || null,
      });
      notify("Step updated.", "success");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update step.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Step — ${step.label}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Assigned to">
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {step.requiresDocument && (
          <Field label="Attached document" hint="From this client's uploaded documents.">
            <Select value={documentMediaId} onChange={(e) => setDocumentMediaId(e.target.value)}>
              <option value="">None</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName ?? d.originalFilename}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Notes">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={submitting} onClick={() => void handleSave()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};

/** Phase 13 — overall onboarding owner/target date (record-level, distinct from each step's own assignee/dueDate). */
const OnboardingOwnerModal: React.FC<{ open: boolean; onClose: () => void; onboarding: Onboarding; users: SanitizedUser[]; onSaved: () => void }> = ({
  open,
  onClose,
  onboarding,
  users,
  onSaved,
}) => {
  const { notify } = useToast();
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setOwnerId(onboarding.ownerId ?? "");
      setDueDate(onboarding.dueDate?.slice(0, 10) ?? "");
    }
  }, [open, onboarding]);

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await onboardingApi.updateOwner(onboarding.id, { ownerId: ownerId || null, dueDate: dueDate || null });
      notify("Onboarding owner/due date updated.", "success");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update onboarding.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Onboarding owner & target date">
      <div className="space-y-3">
        <Field label="Owner">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Target completion date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={submitting} onClick={() => void handleSave()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const OnboardingWorkspaceSection: React.FC<{ client: CrmClient; onClientChanged: () => void }> = ({ client, onClientChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canStartOnboarding = hasPermission(user?.role.permissions, "onboarding.create");
  const canCompleteOnboarding = hasPermission(user?.role.permissions, "onboarding.complete");
  const canUpdateOnboarding = hasPermission(user?.role.permissions, "onboarding.update");
  const canProvision = hasPermission(user?.role.permissions, "workspaces.create");
  const canSuspend = hasPermission(user?.role.permissions, "workspaces.suspend");
  const canInvite = hasPermission(user?.role.permissions, "invitations.create");
  const canSeeUsers = hasPermission(user?.role.permissions, "users.read");
  const canSeeDocuments = hasPermission(user?.role.permissions, "media.read");

  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [suspendConfirm, setSuspendConfirm] = useState(false);
  const [users, setUsers] = useState<SanitizedUser[]>([]);
  const [documents, setDocuments] = useState<CmsMedia[]>([]);
  const [stepEditTarget, setStepEditTarget] = useState<OnboardingChecklistItem | null>(null);
  const [ownerEditOpen, setOwnerEditOpen] = useState(false);

  useEffect(() => {
    if (canSeeUsers) void usersApi.list({ limit: 100 }).then((res) => setUsers(res.items));
  }, [canSeeUsers]);

  useEffect(() => {
    if (canSeeDocuments) void mediaApi.list({ clientId: client.id, limit: 100 }).then((res) => setDocuments(res.items));
  }, [canSeeDocuments, client.id]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await clientsApi.getOnboarding(client.id);
      setOnboarding(res.onboarding);
    } catch {
      setOnboarding(null);
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStart = async () => {
    try {
      await clientsApi.startOnboarding(client.id);
      notify("Onboarding started.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not start onboarding.", "error");
    }
  };

  const handleProvision = async () => {
    try {
      await clientsApi.provisionWorkspace(client.id);
      notify("Workspace provisioned.", "success");
      onClientChanged();
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not provision workspace.", "error");
    }
  };

  const handleComplete = async () => {
    if (!onboarding) return;
    try {
      await onboardingApi.complete(onboarding.id);
      notify("Onboarding completed.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not complete onboarding.", "error");
    }
  };

  const handleSuspend = async () => {
    if (!client.workspaceOrganizationId) return;
    try {
      await workspacesApi.update(client.workspaceOrganizationId, { status: "SUSPENDED" });
      notify("Workspace suspended.", "success");
      onClientChanged();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not suspend workspace.", "error");
    } finally {
      setSuspendConfirm(false);
    }
  };

  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Onboarding &amp; Workspace
        </h3>
        <Badge tone={PROVISIONING_TONE[client.provisioningStatus]}>{client.provisioningStatus.replace("_", " ")}</Badge>
      </div>

      {loading ? (
        <LoadingState />
      ) : (
        <div className="space-y-3">
          {onboarding ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span style={{ color: "var(--text-muted)" }}>Onboarding:</span>
                <Badge tone={ONBOARDING_TONE[onboarding.status]}>{onboarding.status}</Badge>
                {onboarding.currentStep && <span style={{ color: "var(--text-muted)" }}>· current step: {onboarding.currentStep}</span>}
                {onboarding.dueDate && <span style={{ color: "var(--text-muted)" }}>· target: {onboarding.dueDate.slice(0, 10)}</span>}
                {onboarding.ownerId && (
                  <span style={{ color: "var(--text-muted)" }}>
                    · owner: {users.find((u) => u.id === onboarding.ownerId)?.firstName ?? "—"}
                  </span>
                )}
                {canUpdateOnboarding && (
                  <Button variant="ghost" onClick={() => setOwnerEditOpen(true)}>
                    Set owner/due date
                  </Button>
                )}
              </div>
              <ul className="grid sm:grid-cols-2 gap-1">
                {onboarding.checklist.map((item) => (
                  <li
                    key={item.key}
                    className="text-[11px] flex items-center gap-1.5 justify-between"
                    style={{ color: item.completed ? "var(--text-primary)" : "var(--text-muted)" }}
                  >
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span>{item.completed ? "✓" : "○"}</span> {item.label}
                      {item.dueDate && <span style={{ color: "var(--text-muted)" }}>(due {item.dueDate.slice(0, 10)})</span>}
                      {item.requiresDocument && !item.documentMediaId && <Badge tone="warning">Doc needed</Badge>}
                    </span>
                    {canUpdateOnboarding && !item.completed && (
                      <Button variant="ghost" onClick={() => setStepEditTarget(item)}>
                        Edit
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Onboarding has not been started for this client.
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {canStartOnboarding && !onboarding && (
              <Button variant="secondary" onClick={handleStart}>
                <ClipboardCheck className="w-3.5 h-3.5" /> Start onboarding
              </Button>
            )}
            {canProvision && client.provisioningStatus === "NOT_PROVISIONED" && (
              <Button variant="primary" onClick={handleProvision}>
                <Rocket className="w-3.5 h-3.5" /> Provision workspace
              </Button>
            )}
            {canInvite && client.workspaceOrganizationId && (
              <Button variant="secondary" onClick={() => setInviteOpen(true)}>
                <UserPlus className="w-3.5 h-3.5" /> Invite administrator
              </Button>
            )}
            {canCompleteOnboarding && onboarding?.status === "READY" && (
              <Button variant="primary" onClick={handleComplete}>
                Complete onboarding
              </Button>
            )}
            {canSuspend && client.provisioningStatus === "PROVISIONED" && (
              <Button variant="danger" onClick={() => setSuspendConfirm(true)}>
                <Ban className="w-3.5 h-3.5" /> Suspend workspace
              </Button>
            )}
          </div>
        </div>
      )}

      {client.workspaceOrganizationId && (
        <InviteAdminModal open={inviteOpen} onClose={() => setInviteOpen(false)} workspaceId={client.workspaceOrganizationId} onSent={load} />
      )}
      <ConfirmDialog
        open={suspendConfirm}
        title="Suspend workspace"
        message={`Suspend the workspace for "${client.name}"? Its users will lose access until reactivated.`}
        confirmLabel="Suspend"
        destructive
        onConfirm={handleSuspend}
        onCancel={() => setSuspendConfirm(false)}
      />
      {onboarding && (
        <>
          <StepEditModal
            open={!!stepEditTarget}
            onClose={() => setStepEditTarget(null)}
            onboardingId={onboarding.id}
            step={stepEditTarget}
            users={users}
            documents={documents}
            onSaved={load}
          />
          <OnboardingOwnerModal open={ownerEditOpen} onClose={() => setOwnerEditOpen(false)} onboarding={onboarding} users={users} onSaved={load} />
        </>
      )}
    </div>
  );
};

/** Shared read-only "related records" list — used for Opportunities/Contracts/Subscriptions/Invoices on the Client detail view, each a thin window (most-recent 10) into that resource's own full page. */
function RelatedRecordsSection<T extends { id: string }>({
  title,
  icon: Icon,
  load,
  renderItem,
  emptyLabel,
}: {
  title: string;
  icon: React.ElementType;
  load: () => Promise<{ items: T[] }>;
  renderItem: (item: T) => React.ReactNode;
  emptyLabel: string;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then((res) => !cancelled && setItems(res.items))
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
      <h3 className="text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </h3>
      {loading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {emptyLabel}
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {items.map((item) => (
            <li key={item.id} className="py-2 text-xs">
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ClientDetail: React.FC<{ client: CrmClient; onChanged: (c?: CrmClient) => void }> = ({ client, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "clients.update");
  const canDelete = hasPermission(user?.role.permissions, "clients.delete");
  const canCreateContact = hasPermission(user?.role.permissions, "contacts.create");
  const canUpdateContact = hasPermission(user?.role.permissions, "contacts.update");
  const canDeleteContact = hasPermission(user?.role.permissions, "contacts.delete");
  const canSeeUsers = hasPermission(user?.role.permissions, "users.read");
  const canSeeOpportunities = hasPermission(user?.role.permissions, "opportunities.read");
  const canSeeContracts = hasPermission(user?.role.permissions, "contracts.read");
  const canSeeSubscriptions = hasPermission(user?.role.permissions, "subscriptions.read");
  const canSeeInvoices = hasPermission(user?.role.permissions, "invoices.read");
  const canSeeDocuments = hasPermission(user?.role.permissions, "media.read");

  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [removeContact, setRemoveContact] = useState<CrmContact | null>(null);
  const [users, setUsers] = useState<SanitizedUser[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    if (!canSeeUsers) return;
    void usersApi.list({ limit: 100 }).then((res) => setUsers(res.items));
  }, [canSeeUsers]);

  const accountManagerName = users.find((u) => u.id === client.accountManager);

  const loadContacts = React.useCallback(async () => {
    setContactsLoading(true);
    try {
      const res = await clientsApi.contacts(client.id, { limit: 50 });
      setContacts(res.items);
    } catch {
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  }, [client.id]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const handleMakePrimary = async (contact: CrmContact) => {
    try {
      await contactsApi.update(contact.id, { isPrimary: true });
      notify("Primary contact updated.", "success");
      void loadContacts();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update contact.", "error");
    }
  };

  const handleRemoveContact = async () => {
    if (!removeContact) return;
    try {
      await contactsApi.remove(removeContact.id);
      notify("Contact removed.", "success");
      void loadContacts();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not remove contact.", "error");
    } finally {
      setRemoveContact(null);
    }
  };

  const handleArchive = async () => {
    try {
      await clientsApi.remove(client.id);
      notify("Client archived.", "success");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive client.", "error");
    } finally {
      setArchiveOpen(false);
    }
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {client.name}
            <Badge tone={STATUS_TONE[client.status]}>{client.status}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {client.clientCode} {client.legalName ? `· ${client.legalName}` : ""}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" onClick={() => setActivityOpen(true)} aria-label="View activity">
            <History className="w-3.5 h-3.5" />
          </Button>
          {canUpdate && (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {canDelete && client.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 grid sm:grid-cols-2 gap-3 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Email</p>
          <p style={{ color: "var(--text-primary)" }}>{client.email ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Phone</p>
          <p style={{ color: "var(--text-primary)" }}>{client.phone ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Website</p>
          <p style={{ color: "var(--text-primary)" }}>{client.website ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Address</p>
          <p style={{ color: "var(--text-primary)" }}>{client.address ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Industry</p>
          <p style={{ color: "var(--text-primary)" }}>{client.industry?.name ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Source</p>
          <p style={{ color: "var(--text-primary)" }}>{client.source ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Account manager</p>
          <p style={{ color: "var(--text-primary)" }}>
            {accountManagerName ? `${accountManagerName.firstName} ${accountManagerName.lastName}` : "Unassigned"}
          </p>
        </div>
        {client.notes && (
          <div className="sm:col-span-2">
            <p style={{ color: "var(--text-muted)" }}>Notes</p>
            <p style={{ color: "var(--text-primary)" }}>{client.notes}</p>
          </div>
        )}
      </div>

      <OnboardingWorkspaceSection client={client} onClientChanged={() => onChanged()} />

      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Contacts
        </h3>
        {canCreateContact && (
          <Button variant="primary" onClick={() => setAddContactOpen(true)}>
            <UserPlus className="w-3.5 h-3.5" /> Add contact
          </Button>
        )}
      </div>

      {contactsLoading ? (
        <LoadingState />
      ) : contacts.length === 0 ? (
        <EmptyState title="No contacts" description="Add a contact for this client." />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {contacts.map((c) => (
            <li key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                  {c.firstName} {c.lastName}
                  {c.isPrimary && <Badge tone="success">Primary</Badge>}
                </p>
                <p style={{ color: "var(--text-muted)" }}>
                  {c.jobTitle ?? "—"} {c.email ? `· ${c.email}` : ""}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {canUpdateContact && !c.isPrimary && (
                  <Button variant="secondary" onClick={() => void handleMakePrimary(c)}>
                    <Star className="w-3 h-3" /> Make primary
                  </Button>
                )}
                {canDeleteContact && (
                  <Button variant="danger" onClick={() => setRemoveContact(c)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canSeeOpportunities && (
        <RelatedRecordsSection<Opportunity>
          title="Opportunities"
          icon={TrendingUp}
          load={() => opportunitiesApi.list({ clientId: client.id, limit: 10, sort: "updatedAt", order: "desc" })}
          emptyLabel="No opportunities for this client."
          renderItem={(o) => (
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--text-primary)" }}>{o.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span style={{ color: "var(--text-muted)" }}>{formatMoney(o.value, o.currency)}</span>
                <Badge tone={STAGE_TONE[o.stage]}>{STAGE_LABEL[o.stage]}</Badge>
              </div>
            </div>
          )}
        />
      )}

      {canSeeContracts && (
        <RelatedRecordsSection<Contract>
          title="Contracts"
          icon={FileSignature}
          load={() => contractsApi.list({ clientId: client.id, limit: 10 })}
          emptyLabel="No contracts for this client."
          renderItem={(c) => (
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--text-primary)" }}>{c.title}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span style={{ color: "var(--text-muted)" }}>{formatMoney(c.contractValue, c.currency)}</span>
                <Badge tone={genericStatusTone(c.status)}>{c.status}</Badge>
              </div>
            </div>
          )}
        />
      )}

      {canSeeSubscriptions && (
        <RelatedRecordsSection<Subscription>
          title="Subscriptions"
          icon={Repeat}
          load={() => subscriptionsApi.list({ clientId: client.id, limit: 10 })}
          emptyLabel="No subscriptions for this client."
          renderItem={(s) => (
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--text-primary)" }}>{s.subscriptionNumber}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span style={{ color: "var(--text-muted)" }}>{formatMoney(s.price, s.currency)}</span>
                <Badge tone={genericStatusTone(s.status)}>{s.status}</Badge>
              </div>
            </div>
          )}
        />
      )}

      {canSeeInvoices && (
        <RelatedRecordsSection<Invoice>
          title="Invoices"
          icon={Receipt}
          load={() => invoicesApi.list({ clientId: client.id, limit: 10 })}
          emptyLabel="No invoices for this client."
          renderItem={(i) => (
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--text-primary)" }}>{i.invoiceNumber}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span style={{ color: "var(--text-muted)" }}>{formatMoney(i.total, i.currency)}</span>
                <Badge tone={genericStatusTone(i.effectiveStatus)}>{i.effectiveStatus}</Badge>
              </div>
            </div>
          )}
        />
      )}

      {canSeeDocuments && <ClientDocumentsPanel clientId={client.id} />}

      <ClientFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => onChanged(updated)}
        mode="edit"
        client={client}
      />
      <ContactFormModal open={addContactOpen} onClose={() => setAddContactOpen(false)} onSaved={loadContacts} clientId={client.id} />
      <ActivityTimelineModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        title={`Activity — ${client.name}`}
        load={() => clientsApi.activity(client.id)}
      />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive client"
        message={`Archive "${client.name}"? Historical records are preserved; the client will no longer appear as active.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
      <ConfirmDialog
        open={!!removeContact}
        title="Remove contact"
        message={`Remove ${removeContact?.firstName} ${removeContact?.lastName} from this client?`}
        confirmLabel="Remove"
        destructive
        onConfirm={handleRemoveContact}
        onCancel={() => setRemoveContact(null)}
      />
    </Card>
  );
};

export const ClientsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "clients.create");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState<ClientStatusValue | "">("");
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [selected, setSelected] = useState<CrmClient | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Command Center "New Client" deep link (?new=1)
  useEffect(() => {
    if (consumeNewFlag()) setCreateOpen(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await clientsApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setClients(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((c) => c.id === prev.id) ? res.items.find((c) => c.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Building2 className="w-5 h-5" /> Clients
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Manage client accounts and their contacts.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New client
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ClientStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : clients.length === 0 ? (
        <Card>
          <EmptyState title="No clients found" description="Create a client or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {clients.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selected?.id === c.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{c.name}</span>
                <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selected && <ClientDetail client={selected} onChanged={(updated) => (updated ? setSelected(updated) : void load())} />}
        </div>
      )}

      <ClientFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" />
    </div>
  );
};
