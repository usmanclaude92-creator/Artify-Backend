/** Phase 12 — AI prompt templates: versioned, immutable-once-created (docs/AI_ARCHITECTURE.md §14/§15). */
import React, { useCallback, useEffect, useState } from "react";
import { MessageSquareText, Plus } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { aiPromptsApi, type AiPromptTemplate } from "../../../lib/aiApi";
import { ApiClientError } from "../../../lib/apiClient";
import { Card, Button, Input, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field } from "../../ui/ui";
import { hasPermission } from "../../../lib/permissions";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { DRAFT: "neutral", ACTIVE: "success", ARCHIVED: "danger" };

const textareaClass = "w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 font-mono";
const textareaStyle = { background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" } as const;

const PromptFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void }> = ({ open, onClose, onSaved }) => {
  const { notify } = useToast();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [systemInstructions, setSystemInstructions] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setKey("");
      setName("");
      setPurpose("");
      setSystemInstructions("");
      setUserTemplate("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await aiPromptsApi.create({ key, name, purpose: purpose || undefined, systemInstructions, userTemplate });
      notify("Prompt template created.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create prompt template.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New prompt template">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Key" hint="A stable, URL-safe identifier (e.g. lead-triage).">
          <Input required value={key} onChange={(e) => setKey(e.target.value.trim())} />
        </Field>
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Purpose (optional)">
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <Field label="System instructions">
          <textarea required rows={4} className={textareaClass} style={textareaStyle} value={systemInstructions} onChange={(e) => setSystemInstructions(e.target.value)} />
        </Field>
        <Field label="User template" hint="Use {{variable}} placeholders for values filled in at execution time.">
          <textarea required rows={4} className={textareaClass} style={textareaStyle} value={userTemplate} onChange={(e) => setUserTemplate(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Create template
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const VersionFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; template: AiPromptTemplate }> = ({ open, onClose, onSaved, template }) => {
  const { notify } = useToast();
  const [systemInstructions, setSystemInstructions] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSystemInstructions(template.currentVersion?.systemInstructions ?? "");
      setUserTemplate(template.currentVersion?.userTemplate ?? "");
      setError(null);
    }
  }, [open, template]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const version = await aiPromptsApi.createVersion(template.id, { systemInstructions, userTemplate });
      await aiPromptsApi.publish(template.id, version.version.id);
      notify(`Version ${version.version.version} created and published.`, "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create version.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`New version — ${template.name}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Versions are immutable once created — this creates and immediately publishes a new one.
        </p>
        <Field label="System instructions">
          <textarea required rows={4} className={textareaClass} style={textareaStyle} value={systemInstructions} onChange={(e) => setSystemInstructions(e.target.value)} />
        </Field>
        <Field label="User template">
          <textarea required rows={4} className={textareaClass} style={textareaStyle} value={userTemplate} onChange={(e) => setUserTemplate(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Create & publish
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const AiPromptsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "ai.prompts.create");
  const canUpdate = hasPermission(user?.role.permissions, "ai.prompts.update");
  const canDelete = hasPermission(user?.role.permissions, "ai.prompts.delete");

  const [page, setPage] = useState(1);
  const [templates, setTemplates] = useState<AiPromptTemplate[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [versionTarget, setVersionTarget] = useState<AiPromptTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await aiPromptsApi.list({ page, limit: 20 });
      setTemplates(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompt templates.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const archive = async (template: AiPromptTemplate) => {
    try {
      await aiPromptsApi.archive(template.id);
      notify("Template archived.", "success");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive template.", "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <MessageSquareText className="w-5 h-5" /> Prompt Templates
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Versioned system/user instruction pairs. Versions are immutable — publishing moves which one is current.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New template
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : templates.length === 0 ? (
        <Card>
          <EmptyState title="No prompt templates yet" description="Create one to start versioning AI instructions." />
        </Card>
      ) : (
        <Card className="divide-y" style={{ borderColor: "var(--border)" }}>
          {templates.map((template) => (
            <div key={template.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  {template.name}
                  <Badge tone={STATUS_TONE[template.status]}>{template.status}</Badge>
                  {template.currentVersion && <Badge tone="info">v{template.currentVersion.version}</Badge>}
                </p>
                <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                  {template.key} {template.purpose ? `· ${template.purpose}` : ""}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {canUpdate && template.status !== "ARCHIVED" && (
                  <Button variant="secondary" onClick={() => setVersionTarget(template)}>
                    New version
                  </Button>
                )}
                {canDelete && template.status !== "ARCHIVED" && (
                  <Button variant="danger" onClick={() => void archive(template)}>
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

      <PromptFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => void load()} />
      {versionTarget && (
        <VersionFormModal open template={versionTarget} onClose={() => setVersionTarget(null)} onSaved={() => void load()} />
      )}
    </div>
  );
};
