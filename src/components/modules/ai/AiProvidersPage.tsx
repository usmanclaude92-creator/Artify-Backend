/** Phase 12 — AI provider/model catalog (docs/AI_ARCHITECTURE.md). Platform-level, admin-managed metadata — credentials themselves live in server env config, never here. */
import React, { useCallback, useEffect, useState } from "react";
import { Cpu, Plus } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { aiProvidersApi, type AiProvider } from "../../../lib/aiApi";
import { ApiClientError } from "../../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Modal, Field } from "../../ui/ui";
import { hasPermission } from "../../../lib/permissions";

const ProviderFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void }> = ({ open, onClose, onSaved }) => {
  const { notify } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("INACTIVE");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCode("");
      setName("");
      setStatus("INACTIVE");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await aiProvidersApi.create({ code, name, status });
      notify("Provider created.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create provider.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New AI provider">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Code" hint="A short, stable identifier (e.g. gemini, openai).">
          <Input required value={code} onChange={(e) => setCode(e.target.value.trim())} />
        </Field>
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "INACTIVE")}>
            <option value="INACTIVE">Inactive</option>
            <option value="ACTIVE">Active</option>
          </Select>
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Create provider
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ModelFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; providerId: string }> = ({ open, onClose, onSaved, providerId }) => {
  const { notify } = useToast();
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setModelId("");
      setDisplayName("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await aiProvidersApi.createModel({ providerId, modelId, displayName });
      notify("Model added.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add model.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add model">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Model ID" hint="The provider's own model identifier (e.g. gemini-3.7-flash).">
          <Input required value={modelId} onChange={(e) => setModelId(e.target.value.trim())} />
        </Field>
        <Field label="Display name">
          <Input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Add model
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const AiProvidersPage: React.FC = () => {
  const { user } = useAuth();
  const canManageProviders = hasPermission(user?.role.permissions, "ai.providers.manage");
  const canManageModels = hasPermission(user?.role.permissions, "ai.models.manage");

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createProviderOpen, setCreateProviderOpen] = useState(false);
  const [addModelProviderId, setAddModelProviderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await aiProvidersApi.list();
      setProviders(res.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Cpu className="w-5 h-5" /> Providers & Models
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            The platform-level AI provider/model catalog. Credentials stay in server configuration — this is display/administration metadata only.
          </p>
        </div>
        {canManageProviders && (
          <Button variant="primary" onClick={() => setCreateProviderOpen(true)}>
            <Plus className="w-4 h-4" /> New provider
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : providers.length === 0 ? (
        <Card>
          <EmptyState title="No AI providers configured" description="Create one to start cataloguing models." />
        </Card>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <Card key={provider.id}>
              <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                    {provider.name}
                    <Badge tone={provider.status === "ACTIVE" ? "success" : "neutral"}>{provider.status}</Badge>
                    {provider.isDefault && <Badge tone="info">Default</Badge>}
                  </h2>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {provider.code}
                  </p>
                </div>
                {canManageModels && (
                  <Button variant="secondary" onClick={() => setAddModelProviderId(provider.id)}>
                    <Plus className="w-3.5 h-3.5" /> Add model
                  </Button>
                )}
              </div>
              {!provider.models || provider.models.length === 0 ? (
                <div className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                  No models cataloged for this provider yet.
                </div>
              ) : (
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {provider.models.map((model) => (
                    <li key={model.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                          {model.displayName}
                        </p>
                        <p style={{ color: "var(--text-muted)" }}>{model.modelId}</p>
                      </div>
                      <div className="flex gap-1.5">
                        {model.isDefault && <Badge tone="info">Default</Badge>}
                        <Badge tone={model.isActive ? "success" : "neutral"}>{model.isActive ? "Active" : "Inactive"}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      <ProviderFormModal open={createProviderOpen} onClose={() => setCreateProviderOpen(false)} onSaved={() => void load()} />
      {addModelProviderId && (
        <ModelFormModal open providerId={addModelProviderId} onClose={() => setAddModelProviderId(null)} onSaved={() => void load()} />
      )}
    </div>
  );
};
