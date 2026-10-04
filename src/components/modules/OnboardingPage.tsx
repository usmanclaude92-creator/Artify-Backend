/** Phase 6 §27 — onboarding queue: real records only, search/filter/pagination, read-only detail with checklist. Mutating actions live on the CRM Client detail page (§28). */
import React, { useEffect, useState } from "react";
import { ClipboardCheck, Search, Settings, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { onboardingApi, type Onboarding, type OnboardingStatusValue, type OnboardingTemplateStep } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, DataTable, type DataTableColumn } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const TemplateManagerModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { notify } = useToast();
  const [steps, setSteps] = useState<OnboardingTemplateStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    onboardingApi
      .getTemplate()
      .then((res) => setSteps(res.steps))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load template."))
      .finally(() => setLoading(false));
  }, [open]);

  const updateStep = (index: number, patch: Partial<OnboardingTemplateStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    setSteps((prev) => [...prev, { key: `STEP_${prev.length + 1}`, label: "New step", requiresDocument: false }]);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onboardingApi.updateTemplate(steps);
      notify("Onboarding template saved.", "success");
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save template.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Onboarding checklist template">
      <div className="space-y-3">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          New onboarding started for a client uses these steps, in order. Existing onboarding records keep their own checklist unchanged.
        </p>
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        {loading ? (
          <LoadingState />
        ) : (
          <>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={step.key}
                    onChange={(e) => updateStep(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })}
                    placeholder="STEP_KEY"
                    className="w-40 font-mono text-[11px]"
                  />
                  <Input value={step.label} onChange={(e) => updateStep(i, { label: e.target.value })} placeholder="Label" className="flex-1" />
                  <label className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                    <input type="checkbox" checked={step.requiresDocument} onChange={(e) => updateStep(i, { requiresDocument: e.target.checked })} />
                    Doc
                  </label>
                  <Button variant="ghost" onClick={() => removeStep(i)} aria-label="Remove step">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="secondary" onClick={addStep}>
              <Plus className="w-3.5 h-3.5" /> Add step
            </Button>
          </>
        )}
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={submitting || steps.length === 0} onClick={() => void handleSave()}>
            Save template
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const STATUS_OPTIONS: OnboardingStatusValue[] = ["NOT_STARTED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"];
const STATUS_TONE: Record<OnboardingStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "warning",
  READY: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
};

const OnboardingDetailModal: React.FC<{ open: boolean; onClose: () => void; onboarding: Onboarding | null; onChanged: () => void }> = ({
  open,
  onClose,
  onboarding,
  onChanged,
}) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canComplete = hasPermission(user?.role.permissions, "onboarding.complete");
  const [submitting, setSubmitting] = useState(false);

  if (!onboarding) return null;

  const handleComplete = async () => {
    setSubmitting(true);
    try {
      await onboardingApi.complete(onboarding.id);
      notify("Onboarding completed.", "success");
      onChanged();
      onClose();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not complete onboarding.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Onboarding — ${onboarding.client?.name ?? onboarding.clientId}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[onboarding.status]}>{onboarding.status}</Badge>
          {onboarding.currentStep && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Current step: {onboarding.currentStep}
            </span>
          )}
        </div>
        <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--border)" }}>
          {onboarding.checklist.map((item) => (
            <li key={item.key} className="px-3 py-2 flex items-center justify-between text-xs">
              <span style={{ color: "var(--text-primary)" }}>{item.label}</span>
              <Badge tone={item.completed ? "success" : "neutral"}>{item.completed ? "Done" : "Pending"}</Badge>
            </li>
          ))}
        </ul>
        {canComplete && onboarding.status === "READY" && (
          <div className="pt-2 border-t flex justify-end" style={{ borderColor: "var(--border)" }}>
            <Button variant="primary" disabled={submitting} onClick={handleComplete}>
              Complete onboarding
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export const OnboardingPage: React.FC = () => {
  const { user } = useAuth();
  const { path } = useRouter();
  const isPendingView = path === "/onboarding/pending";
  const canManageTemplate = hasPermission(user?.role.permissions, "onboarding.update");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<OnboardingStatusValue | "">(isPendingView ? "IN_PROGRESS" : "");
  const [rows, setRows] = useState<Onboarding[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Onboarding | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);

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
      const res = await onboardingApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setRows(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load onboarding queue.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onboardingColumns: DataTableColumn<Onboarding>[] = [
    { key: "client", header: "Client", cellClassName: "font-semibold", cellStyle: { color: "var(--text-primary)" }, render: (row) => row.client?.name ?? row.clientId },
    { key: "status", header: "Onboarding", render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge> },
    {
      key: "workspace",
      header: "Workspace",
      cellStyle: { color: "var(--text-secondary)" },
      render: (row) => row.client?.workspaceOrganization?.status ?? "—",
    },
    { key: "currentStep", header: "Current step", cellStyle: { color: "var(--text-secondary)" }, render: (row) => row.currentStep ?? "—" },
    {
      key: "started",
      header: "Started",
      cellStyle: { color: "var(--text-muted)" },
      render: (row) => (row.startedAt ? new Date(row.startedAt).toLocaleDateString() : "—"),
    },
    {
      key: "lastActivity",
      header: "Last activity",
      cellStyle: { color: "var(--text-muted)" },
      render: (row) => new Date(row.updatedAt).toLocaleDateString(),
    },
    {
      key: "completed",
      header: "Completed",
      cellStyle: { color: "var(--text-muted)" },
      render: (row) => (row.completedAt ? new Date(row.completedAt).toLocaleDateString() : "—"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <ClipboardCheck className="w-5 h-5" /> {isPendingView ? "Pending Onboarding" : "Onboarding Overview"}
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Client onboarding progress, from CRM client to active workspace.
          </p>
        </div>
        {canManageTemplate && (
          <Button variant="secondary" onClick={() => setTemplateOpen(true)}>
            <Settings className="w-3.5 h-3.5" /> Manage template
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search by client…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as OnboardingStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </Select>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No onboarding records" description="Start onboarding from a CRM client's detail page." />
        ) : (
          <DataTable columns={onboardingColumns} rows={rows} keyOf={(row) => row.id} onRowClick={(row) => setDetail(row)} />
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>

      <OnboardingDetailModal open={!!detail} onClose={() => setDetail(null)} onboarding={detail} onChanged={load} />
      <TemplateManagerModal open={templateOpen} onClose={() => setTemplateOpen(false)} />
    </div>
  );
};
