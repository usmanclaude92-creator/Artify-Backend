/**
 * Phase 14 — Automation: workflows, execution history, approvals, tasks
 * (docs/AUTOMATION_ARCHITECTURE.md). The backend engine (imported in an
 * earlier phase) was fully built and tested but had no Control Center UI
 * at all until this page. Workflow trigger/step configuration is authored
 * as JSON (validated client-side before submit) rather than a drag-drop
 * builder — the engine's `WorkflowStepConfig` union is too expressive
 * (CONDITION/LOOP/APPROVAL/BUSINESS_ACTION/etc., see
 * server/services/automation/types.ts) for a first UI pass to special-case
 * visually without fabricating a narrower builder than what's real.
 */
import React, { useEffect, useState } from "react";
import { Workflow, Play, Pause, CheckCircle2, XCircle, RotateCcw, Ban, Plus, Search } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  automationApi,
  type AutomationWorkflow,
  type AutomationWorkflowStatusValue,
  type AutomationTriggerTypeValue,
  type AutomationExecution,
  type AutomationExecutionStatusValue,
  type AutomationApproval,
  type AutomationTask,
  type AutomationTaskStatusValue,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, DataTable, type DataTableColumn } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

type Tab = "overview" | "workflows" | "executions" | "approvals" | "tasks";

const WORKFLOW_STATUS_TONE: Record<AutomationWorkflowStatusValue, "success" | "warning" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  PAUSED: "warning",
  ARCHIVED: "danger",
};
const EXECUTION_STATUS_TONE: Record<AutomationExecutionStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  QUEUED: "neutral",
  RUNNING: "info",
  WAITING_APPROVAL: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "danger",
};

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
      style={active ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
    >
      {children}
    </button>
  );
}

const StatCard: React.FC<{ label: string; value: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }> = ({ label, value }) => (
  <Card className="p-4">
    <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
      {value}
    </p>
    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
      {label}
    </p>
  </Card>
);

const OverviewTab: React.FC = () => {
  const [data, setData] = useState<Awaited<ReturnType<typeof automationApi.dashboard>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void automationApi
      .dashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load automation dashboard."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active workflows" value={`${data.metrics.activeWorkflows} / ${data.metrics.totalWorkflows}`} />
        <StatCard label="Running / queued" value={data.metrics.runningExecutions} />
        <StatCard label="Success rate" value={`${data.metrics.successRate}%`} />
        <StatCard label="Pending approvals" value={data.metrics.pendingApprovals} />
        <StatCard label="Completed executions" value={data.metrics.completedExecutions} />
        <StatCard label="Failed executions" value={data.metrics.failedExecutions} />
        <StatCard label="Active tasks" value={data.metrics.activeTasks} />
        <StatCard label="Total executions" value={data.metrics.totalExecutions} />
      </div>
      <Card>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            Recent executions
          </h2>
        </div>
        {data.recentExecutions.length === 0 ? (
          <EmptyState title="No executions yet" description="Trigger a workflow or wait for its event/schedule to fire." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {data.recentExecutions.map((e) => (
              <li key={e.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                <span className="truncate font-semibold" style={{ color: "var(--text-primary)" }}>
                  {e.workflow?.name ?? e.workflowId}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={EXECUTION_STATUS_TONE[e.status]}>{e.status}</Badge>
                  <span style={{ color: "var(--text-muted)" }}>{new Date(e.createdAt).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

const WorkflowFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void }> = ({ open, onClose, onSaved }) => {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [triggerType, setTriggerType] = useState<AutomationTriggerTypeValue>("EVENT");
  const [triggerConfig, setTriggerConfig] = useState('{\n  "eventType": "lead.created"\n}');
  const [steps, setSteps] = useState("[]");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setCategory("GENERAL");
      setTriggerType("EVENT");
      setTriggerConfig('{\n  "eventType": "lead.created"\n}');
      setSteps("[]");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let parsedTriggerConfig: Record<string, unknown>;
    let parsedSteps: Record<string, unknown>[];
    try {
      parsedTriggerConfig = JSON.parse(triggerConfig || "{}");
    } catch {
      setError("Trigger config must be valid JSON.");
      return;
    }
    try {
      parsedSteps = JSON.parse(steps || "[]");
      if (!Array.isArray(parsedSteps)) throw new Error();
    } catch {
      setError("Steps must be a valid JSON array.");
      return;
    }
    setSubmitting(true);
    try {
      await automationApi.createWorkflow({ name, description: description || undefined, category, triggerType, triggerConfig: parsedTriggerConfig, steps: parsedSteps });
      notify("Workflow created as DRAFT.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create workflow.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New workflow">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Input value={category} onChange={(e) => setCategory(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Trigger type">
            <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value as AutomationTriggerTypeValue)}>
              {(["EVENT", "SCHEDULE", "MANUAL", "API", "CONDITIONAL"] as AutomationTriggerTypeValue[]).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Trigger config (JSON)" hint='EVENT: {"eventType": "lead.created"}. SCHEDULE: {"scheduleType": "CRON", "cronExpression": "0 9 * * *"}.'>
          <textarea
            className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
            style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
            rows={4}
            value={triggerConfig}
            onChange={(e) => setTriggerConfig(e.target.value)}
          />
        </Field>
        <Field label="Steps (JSON array)" hint="Each step needs id/name/type (CONDITION, BUSINESS_ACTION, NOTIFICATION, DELAY, etc. — see docs/AUTOMATION_ARCHITECTURE.md).">
          <textarea
            className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
            style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
            rows={6}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
          />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting || !name.trim()}>
            Create workflow
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const WorkflowDetailModal: React.FC<{ open: boolean; onClose: () => void; workflowId: string | null; onChanged: () => void }> = ({ open, onClose, workflowId, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canPublish = hasPermission(user?.role.permissions, "automation.publish");
  const canExecute = hasPermission(user?.role.permissions, "automation.execute");
  const [workflow, setWorkflow] = useState<AutomationWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !workflowId) return;
    setLoading(true);
    void automationApi
      .getWorkflow(workflowId)
      .then(setWorkflow)
      .finally(() => setLoading(false));
  }, [open, workflowId]);

  if (!workflowId) return null;

  const runAction = async (fn: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await fn();
      notify(successMessage, "success");
      onChanged();
      const refreshed = await automationApi.getWorkflow(workflowId);
      setWorkflow(refreshed);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={workflow?.name ?? "Workflow"}>
      {loading || !workflow ? (
        <LoadingState />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge tone={WORKFLOW_STATUS_TONE[workflow.status]}>{workflow.status}</Badge>
            <Badge tone="neutral">{workflow.triggerType}</Badge>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              v{workflow.currentVersion}
              {workflow.publishedVersion ? ` · published v${workflow.publishedVersion}` : " · never published"}
            </span>
          </div>
          {workflow.description && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{workflow.description}</p>}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>
              Trigger config
            </p>
            <pre className="text-[11px] rounded-lg p-2 overflow-x-auto" style={{ background: "var(--bg-surface-alt)", color: "var(--text-secondary)" }}>
              {JSON.stringify(workflow.triggerConfig, null, 2)}
            </pre>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>
              Steps ({workflow.steps.length})
            </p>
            <pre className="text-[11px] rounded-lg p-2 overflow-x-auto max-h-60" style={{ background: "var(--bg-surface-alt)", color: "var(--text-secondary)" }}>
              {JSON.stringify(workflow.steps, null, 2)}
            </pre>
          </div>
          <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
            {canPublish && workflow.status === "DRAFT" && (
              <Button variant="primary" disabled={busy} onClick={() => void runAction(() => automationApi.publishWorkflow(workflow.id), "Workflow published and activated.")}>
                Publish
              </Button>
            )}
            {canExecute && workflow.status === "ACTIVE" && (
              <Button variant="secondary" disabled={busy} onClick={() => void runAction(() => automationApi.triggerWorkflow(workflow.id), "Workflow triggered.")}>
                <Play className="w-3.5 h-3.5" /> Trigger now
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};

const WorkflowsTab: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "automation.create");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AutomationWorkflowStatusValue | "">("");
  const [rows, setRows] = useState<AutomationWorkflow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await automationApi.listWorkflows({ page, limit: 20, search: search || undefined, status: status || undefined });
      setRows(res.rows);
      setTotalPages(Math.max(1, Math.ceil(res.total / res.limit)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows.");
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: DataTableColumn<AutomationWorkflow>[] = [
    { key: "name", header: "Name", cellClassName: "font-semibold", cellStyle: { color: "var(--text-primary)" }, render: (r) => r.name },
    { key: "status", header: "Status", render: (r) => <Badge tone={WORKFLOW_STATUS_TONE[r.status]}>{r.status}</Badge> },
    { key: "trigger", header: "Trigger", cellStyle: { color: "var(--text-secondary)" }, render: (r) => r.triggerType },
    { key: "category", header: "Category", cellStyle: { color: "var(--text-secondary)" }, render: (r) => r.category },
    { key: "executions", header: "Executions", cellStyle: { color: "var(--text-muted)" }, render: (r) => r._count?.executions ?? 0 },
    { key: "updated", header: "Updated", cellStyle: { color: "var(--text-muted)" }, render: (r) => new Date(r.updatedAt).toLocaleDateString() },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
            <Input placeholder="Search workflows…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as AutomationWorkflowStatusValue | "")}>
            <option value="">All statuses</option>
            {(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as AutomationWorkflowStatusValue[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Card>
        {canCreate && (
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4" /> New workflow
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No workflows" description="Create a workflow to automate a real business trigger." />
        ) : (
          <DataTable columns={columns} rows={rows} keyOf={(r) => r.id} onRowClick={(r) => setDetailId(r.id)} />
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>

      <WorkflowFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => void load()} />
      <WorkflowDetailModal open={!!detailId} onClose={() => setDetailId(null)} workflowId={detailId} onChanged={() => void load()} />
    </div>
  );
};

const ExecutionDetailModal: React.FC<{ open: boolean; onClose: () => void; executionId: string | null; onChanged: () => void }> = ({ open, onClose, executionId, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canExecute = hasPermission(user?.role.permissions, "automation.execute");
  const canManage = hasPermission(user?.role.permissions, "automation.manage");
  const [execution, setExecution] = useState<AutomationExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !executionId) return;
    setLoading(true);
    void automationApi
      .getExecution(executionId)
      .then((res) => setExecution(res.execution))
      .finally(() => setLoading(false));
  }, [open, executionId]);

  if (!executionId) return null;

  const runAction = async (fn: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await fn();
      notify(successMessage, "success");
      onChanged();
      const res = await automationApi.getExecution(executionId);
      setExecution(res.execution);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={execution?.workflow?.name ?? "Execution"}>
      {loading || !execution ? (
        <LoadingState />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge tone={EXECUTION_STATUS_TONE[execution.status]}>{execution.status}</Badge>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {execution.triggerType} · started {execution.startedAt ? new Date(execution.startedAt).toLocaleString() : "not yet"}
            </span>
          </div>
          {execution.errorMessage && (
            <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{execution.errorMessage}</div>
          )}
          {execution.stepExecutions && execution.stepExecutions.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>
                Steps
              </p>
              <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--border)" }}>
                {execution.stepExecutions.map((s) => (
                  <li key={s.id} className="px-3 py-2 flex items-center justify-between text-xs">
                    <span style={{ color: "var(--text-primary)" }}>
                      {s.stepIndex + 1}. {s.stepName} ({s.stepType})
                    </span>
                    <Badge tone={s.status === "COMPLETED" ? "success" : s.status === "FAILED" ? "danger" : "neutral"}>{s.status}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
            {canExecute && execution.status === "FAILED" && (
              <Button variant="secondary" disabled={busy} onClick={() => void runAction(() => automationApi.retryExecution(execution.id), "Execution retried.")}>
                <RotateCcw className="w-3.5 h-3.5" /> Retry
              </Button>
            )}
            {canManage && (execution.status === "RUNNING" || execution.status === "QUEUED" || execution.status === "WAITING_APPROVAL") && (
              <Button variant="danger" disabled={busy} onClick={() => void runAction(() => automationApi.cancelExecution(execution.id), "Execution cancelled.")}>
                <Ban className="w-3.5 h-3.5" /> Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};

const ExecutionsTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<AutomationExecutionStatusValue | "">("");
  const [rows, setRows] = useState<AutomationExecution[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await automationApi.listExecutions({ page, limit: 20, status: status || undefined });
      setRows(res.rows);
      setTotalPages(Math.max(1, Math.ceil(res.total / res.limit)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load executions.");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: DataTableColumn<AutomationExecution>[] = [
    { key: "workflow", header: "Workflow", cellClassName: "font-semibold", cellStyle: { color: "var(--text-primary)" }, render: (r) => r.workflow?.name ?? r.workflowId },
    { key: "status", header: "Status", render: (r) => <Badge tone={EXECUTION_STATUS_TONE[r.status]}>{r.status}</Badge> },
    { key: "trigger", header: "Trigger", cellStyle: { color: "var(--text-secondary)" }, render: (r) => r.triggerType },
    { key: "steps", header: "Step", cellStyle: { color: "var(--text-muted)" }, render: (r) => `${r.currentStepIndex} / ${r.totalSteps || "?"}` },
    { key: "started", header: "Started", cellStyle: { color: "var(--text-muted)" }, render: (r) => (r.startedAt ? new Date(r.startedAt).toLocaleString() : "—") },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-3 flex gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value as AutomationExecutionStatusValue | "")}>
          <option value="">All statuses</option>
          {(["QUEUED", "RUNNING", "WAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"] as AutomationExecutionStatusValue[]).map((s) => (
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
          <EmptyState title="No executions" description="Executions appear here once a workflow's trigger fires." />
        ) : (
          <DataTable columns={columns} rows={rows} keyOf={(r) => r.id} onRowClick={(r) => setDetailId(r.id)} />
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
      <ExecutionDetailModal open={!!detailId} onClose={() => setDetailId(null)} executionId={detailId} onChanged={() => void load()} />
    </div>
  );
};

const ApprovalsTab: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canApprove = hasPermission(user?.role.permissions, "automation.approve");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AutomationApproval[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await automationApi.listApprovals({ page, limit: 20 });
      setRows(res.rows);
      setTotalPages(Math.max(1, Math.ceil(res.total / res.limit)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, decision: "APPROVED" | "REJECTED") => {
    setBusyId(id);
    try {
      await automationApi.decideApproval(id, decision);
      notify(decision === "APPROVED" ? "Approved." : "Rejected.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not decide.", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No approvals" description="Human-in-the-loop approval gates appear here when a workflow requests one." />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {rows.map((a) => (
            <li key={a.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {a.action} — {a.workflow?.name ?? a.workflowId}
                </p>
                <p style={{ color: "var(--text-muted)" }}>{a.description ?? "No description."}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge tone={a.status === "APPROVED" ? "success" : a.status === "REJECTED" ? "danger" : a.status === "EXPIRED" ? "neutral" : "warning"}>{a.status}</Badge>
                {canApprove && a.status === "PENDING" && (
                  <>
                    <Button variant="primary" disabled={busyId === a.id} onClick={() => void decide(a.id, "APPROVED")}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                    </Button>
                    <Button variant="danger" disabled={busyId === a.id} onClick={() => void decide(a.id, "REJECTED")}>
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </Card>
  );
};

const TaskFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void }> = ({ open, onClose, onSaved }) => {
  const { notify } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setDueDate("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await automationApi.createTask({ title, description: description || undefined, dueDate: dueDate || undefined });
      notify("Task created.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create task.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New task">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting || !title.trim()}>
            Create task
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const TaskStatusValues: AutomationTaskStatusValue[] = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

const TasksTab: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canExecute = hasPermission(user?.role.permissions, "automation.execute");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<AutomationTaskStatusValue | "">("");
  const [rows, setRows] = useState<AutomationTask[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await automationApi.listTasks({ page, limit: 20, status: status || undefined });
      setRows(res.rows);
      setTotalPages(Math.max(1, Math.ceil(res.total / res.limit)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const setTaskStatus = async (id: string, next: AutomationTaskStatusValue) => {
    setBusyId(id);
    try {
      await automationApi.updateTask(id, { status: next });
      notify("Task updated.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update task.", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Card className="p-3 flex-1">
          <Select value={status} onChange={(e) => setStatus(e.target.value as AutomationTaskStatusValue | "")}>
            <option value="">All statuses</option>
            {TaskStatusValues.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Card>
        {canExecute && (
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4" /> New task
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No tasks" description="Ad hoc or workflow-generated follow-up work appears here." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {rows.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {t.title}
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>
                    {t.priority} {t.dueDate && `· due ${t.dueDate.slice(0, 10)}`} {t.isAiGenerated && "· AI-generated"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={t.status === "COMPLETED" ? "success" : t.status === "CANCELLED" ? "danger" : t.status === "IN_PROGRESS" ? "info" : "neutral"}>
                    {t.status.replace("_", " ")}
                  </Badge>
                  {canExecute && t.status === "PENDING" && (
                    <Button variant="secondary" disabled={busyId === t.id} onClick={() => void setTaskStatus(t.id, "IN_PROGRESS")}>
                      <Play className="w-3.5 h-3.5" /> Start
                    </Button>
                  )}
                  {canExecute && t.status === "IN_PROGRESS" && (
                    <Button variant="primary" disabled={busyId === t.id} onClick={() => void setTaskStatus(t.id, "COMPLETED")}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                    </Button>
                  )}
                  {canExecute && (t.status === "PENDING" || t.status === "IN_PROGRESS") && (
                    <Button variant="ghost" disabled={busyId === t.id} onClick={() => void setTaskStatus(t.id, "CANCELLED")}>
                      <Pause className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
      <TaskFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => void load()} />
    </div>
  );
};

export const AutomationPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Workflow className="w-5 h-5" /> Automation
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Event/schedule-driven workflows, execution history, approvals, and tasks.
        </p>
      </div>

      <div className="flex gap-1 flex-wrap">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={tab === "workflows"} onClick={() => setTab("workflows")}>
          Workflows
        </TabButton>
        <TabButton active={tab === "executions"} onClick={() => setTab("executions")}>
          Executions
        </TabButton>
        <TabButton active={tab === "approvals"} onClick={() => setTab("approvals")}>
          Approvals
        </TabButton>
        <TabButton active={tab === "tasks"} onClick={() => setTab("tasks")}>
          Tasks
        </TabButton>
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "workflows" && <WorkflowsTab />}
      {tab === "executions" && <ExecutionsTab />}
      {tab === "approvals" && <ApprovalsTab />}
      {tab === "tasks" && <TasksTab />}
    </div>
  );
};
