/** Phase 12 — AI workflows: bounded, deterministic multi-step tool sequences (docs/AI_WORKFLOW_ARCHITECTURE.md). */
import React, { useCallback, useEffect, useState } from "react";
import { Workflow, Plus, Play, Trash2 } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { aiWorkflowsApi, aiToolsApi, type AiWorkflow, type AiWorkflowStep, type AiTool } from "../../../lib/aiApi";
import { ApiClientError } from "../../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field } from "../../ui/ui";
import { hasPermission } from "../../../lib/permissions";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { DRAFT: "neutral", ACTIVE: "success", ARCHIVED: "danger" };

const WorkflowFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; tools: AiTool[] }> = ({ open, onClose, onSaved, tools }) => {
  const { notify } = useToast();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<AiWorkflowStep[]>([{ order: 0, toolCode: tools[0]?.code ?? "" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setKey("");
      setName("");
      setDescription("");
      setSteps([{ order: 0, toolCode: tools[0]?.code ?? "" }]);
      setError(null);
    }
  }, [open, tools]);

  const addStep = () => setSteps((prev) => [...prev, { order: prev.length, toolCode: tools[0]?.code ?? "" }]);
  const removeStep = (order: number) => setSteps((prev) => prev.filter((s) => s.order !== order).map((s, i) => ({ ...s, order: i })));
  const updateStep = (order: number, toolCode: string) => setSteps((prev) => prev.map((s) => (s.order === order ? { ...s, toolCode } : s)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await aiWorkflowsApi.create({ key, name, description: description || undefined, steps, maxSteps: Math.max(steps.length, 1) });
      notify("Workflow created.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create workflow.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New AI workflow">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Key" hint="A stable, URL-safe identifier (e.g. lead-intake).">
          <Input required value={key} onChange={(e) => setKey(e.target.value.trim())} />
        </Field>
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Steps" hint="Runs in order — each step is one governed tool call.">
          <div className="space-y-2">
            {steps.map((step) => (
              <div key={step.order} className="flex items-center gap-2">
                <span className="text-xs font-mono w-5 shrink-0" style={{ color: "var(--text-muted)" }}>
                  {step.order + 1}.
                </span>
                <Select className="flex-1" value={step.toolCode} onChange={(e) => updateStep(step.order, e.target.value)}>
                  {tools.map((tool) => (
                    <option key={tool.code} value={tool.code}>
                      {tool.name} ({tool.riskLevel})
                    </option>
                  ))}
                </Select>
                {steps.length > 1 && (
                  <button type="button" onClick={() => removeStep(step.order)} aria-label="Remove step">
                    <Trash2 className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                  </button>
                )}
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={addStep} disabled={steps.length >= 10}>
              <Plus className="w-3.5 h-3.5" /> Add step
            </Button>
          </div>
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Create workflow
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const AiWorkflowsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "ai.workflows.create");
  const canPublish = hasPermission(user?.role.permissions, "ai.workflows.publish");
  const canDelete = hasPermission(user?.role.permissions, "ai.workflows.delete");
  const canExecute = hasPermission(user?.role.permissions, "ai.workflows.execute");

  const [page, setPage] = useState(1);
  const [workflows, setWorkflows] = useState<AiWorkflow[]>([]);
  const [tools, setTools] = useState<AiTool[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wfRes, toolsRes] = await Promise.all([aiWorkflowsApi.list({ page, limit: 20 }), aiToolsApi.list()]);
      setWorkflows(wfRes.items);
      setTotalPages(wfRes.totalPages);
      setTools(toolsRes.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflows.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (id: string, fn: () => Promise<unknown>, successMessage: string) => {
    setBusyId(id);
    try {
      await fn();
      notify(successMessage, "success");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Workflow className="w-5 h-5" /> Workflows
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Bounded, deterministic sequences of governed tool calls — no autonomous planning or unbounded loops.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)} disabled={tools.length === 0}>
            <Plus className="w-4 h-4" /> New workflow
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : workflows.length === 0 ? (
        <Card>
          <EmptyState title="No workflows yet" description="Create one to chain governed tool calls together." />
        </Card>
      ) : (
        <Card className="divide-y" style={{ borderColor: "var(--border)" }}>
          {workflows.map((wf) => (
            <div key={wf.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  {wf.name}
                  <Badge tone={STATUS_TONE[wf.status]}>{wf.status}</Badge>
                  <Badge tone="neutral">{wf.steps.length} step{wf.steps.length === 1 ? "" : "s"}</Badge>
                </p>
                <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                  {wf.key} · {wf.steps.map((s) => s.toolCode).join(" → ")}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {canPublish && wf.status === "DRAFT" && (
                  <Button variant="secondary" disabled={busyId === wf.id} onClick={() => void runAction(wf.id, () => aiWorkflowsApi.publish(wf.id), "Workflow published.")}>
                    Publish
                  </Button>
                )}
                {canExecute && wf.status === "ACTIVE" && (
                  <Button variant="primary" disabled={busyId === wf.id} onClick={() => void runAction(wf.id, () => aiWorkflowsApi.execute(wf.id), "Workflow execution started.")}>
                    <Play className="w-3.5 h-3.5" /> Run
                  </Button>
                )}
                {canDelete && wf.status !== "ARCHIVED" && (
                  <Button variant="danger" disabled={busyId === wf.id} onClick={() => void runAction(wf.id, () => aiWorkflowsApi.archive(wf.id), "Workflow archived.")}>
                    Archive
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="px-4 py-2">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        </Card>
      )}

      <WorkflowFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => void load()} tools={tools} />
    </div>
  );
};
