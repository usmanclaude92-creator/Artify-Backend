import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { integrationsApi, type ConfigurableIntegration, type IntegrationCatalogEntry, type SystemIntegration } from "../../../lib/api";
import { ApiClientError } from "../../../lib/apiClient";
import { hasPermission } from "../../../lib/permissions";
import { Card, Badge, Button, Input, Field, Modal, ConfirmDialog, LoadingState, ErrorState } from "../../ui/ui";

const STATUS_TONE = { NOT_CONFIGURED: "neutral", CONFIGURED: "warning", VERIFIED: "success", FAILING: "danger" } as const;
const STATUS_LABEL = { NOT_CONFIGURED: "Not configured", CONFIGURED: "Configured — not verified", VERIFIED: "Verified", FAILING: "Failing" } as const;
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

const ConfigureModal: React.FC<{ entry: IntegrationCatalogEntry | null; onClose: () => void; onSaved: () => void }> = ({ entry, onClose, onSaved }) => {
  const { notify } = useToast();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (entry) {
      setConfig({ ...(entry.integration?.config ?? {}) });
      setSecret("");
      setError(null);
    }
  }, [entry]);

  if (!entry) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await integrationsApi.save(entry.provider, { config, ...(secret ? { secret } : {}) });
      notify("Integration saved. Run a connection test to verify it.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save integration.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Configure ${entry.label}`}>
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        {entry.configFields.map((f) => (
          <Field key={f.key} label={f.label + (f.required ? "" : " (optional)")}>
            <Input required={f.required} placeholder={f.placeholder} value={config[f.key] ?? ""} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
          </Field>
        ))}
        <Field label={entry.secretLabel} hint={entry.integration?.hasSecret ? `A credential ending in ••••${entry.integration.secretLast4} is stored. Enter a new value only to replace it.` : "Stored encrypted. It is never shown again."}>
          <Input type="password" autoComplete="off" required={!entry.integration?.hasSecret} minLength={8} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={entry.integration?.hasSecret ? "•••••••• (unchanged)" : ""} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>Save</Button>
        </div>
      </form>
    </Modal>
  );
};

export const IntegrationsPanel: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "integrations.manage");
  const [system, setSystem] = useState<SystemIntegration[]>([]);
  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[]>([]);
  const [keySource, setKeySource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<IntegrationCatalogEntry | null>(null);
  const [removing, setRemoving] = useState<IntegrationCatalogEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await integrationsApi.overview();
      setSystem(r.system);
      setCatalog(r.configurable);
      setKeySource(r.encryption.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load integrations.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (provider: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(provider);
    try {
      await fn();
      notify(success, "success");
    } catch (e) {
      notify(e instanceof ApiClientError ? e.message : "Action failed.", "error");
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Connect external services</h2>
        {catalog.map((entry) => {
          const i: ConfigurableIntegration | null = entry.integration;
          const status = i?.status ?? "NOT_CONFIGURED";
          return (
            <Card key={entry.provider} className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{entry.label}</p>
                  <p className="text-xs max-w-xl" style={{ color: "var(--text-muted)" }}>{entry.description}</p>
                </div>
                <div className="flex gap-1.5">
                  <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                  <Badge tone={i?.enabled ? "success" : "neutral"}>{i?.enabled ? "Enabled" : "Disabled"}</Badge>
                </div>
              </div>
              {i && (
                <dl className="grid sm:grid-cols-4 gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <div><dt className="font-bold uppercase text-[10px]">Credential</dt><dd>{i.hasSecret ? `••••${i.secretLast4}` : "None"}</dd></div>
                  <div><dt className="font-bold uppercase text-[10px]">Last success</dt><dd>{when(i.lastSuccessAt)}</dd></div>
                  <div><dt className="font-bold uppercase text-[10px]">Last failure</dt><dd>{when(i.lastFailureAt)}</dd></div>
                  <div><dt className="font-bold uppercase text-[10px]">Last error</dt><dd>{i.lastError ?? "—"}</dd></div>
                </dl>
              )}
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => setConfiguring(entry)}>{i ? "Edit configuration" : "Configure"}</Button>
                  {i && status !== "NOT_CONFIGURED" && (
                    <>
                      <Button variant="secondary" disabled={busy === entry.provider} onClick={() => void act(entry.provider, () => integrationsApi.test(entry.provider), "Connection test finished.")}>Test connection</Button>
                      <Button variant="secondary" disabled={busy === entry.provider} onClick={() => void act(entry.provider, () => integrationsApi.save(entry.provider, { enabled: !i.enabled }), i.enabled ? "Integration disabled." : "Integration enabled.")}>{i.enabled ? "Disable" : "Enable"}</Button>
                      <Button variant="danger" onClick={() => setRemoving(entry)}>Remove credential</Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Platform services</h2>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Configured through deployment environment variables. “Configured” means the settings are present — it is not a live connection test. Secret values are never shown.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {system.map((s) => (
            <Card key={s.key} className="p-4 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{s.name}</p>
                <Badge tone={s.status === "configured" ? "success" : "warning"}>{s.status === "configured" ? "Configured" : "Not configured"}</Badge>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{s.detail}</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Last success: {when(s.lastSuccessAt)} · Last failure: {when(s.lastFailureAt)}
              </p>
              {s.status === "not_configured" && s.requires.length > 0 && (
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Requires: <span className="font-mono">{s.requires.join(", ")}</span></p>
              )}
            </Card>
          ))}
        </div>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Credential encryption key: {keySource === "dedicated" ? "dedicated INTEGRATIONS_ENCRYPTION_KEY" : "derived from the session secret — set INTEGRATIONS_ENCRYPTION_KEY to manage it independently"}.
        </p>
      </section>

      <ConfigureModal entry={configuring} onClose={() => setConfiguring(null)} onSaved={() => void load()} />
      <ConfirmDialog
        open={!!removing}
        title="Remove credential"
        message={`Delete the stored credential for ${removing?.label}? The integration will be disabled and must be reconfigured to be used again.`}
        confirmLabel="Remove credential"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => { const p = removing!.provider; setRemoving(null); void act(p, () => integrationsApi.clearSecret(p), "Credential removed."); }}
      />
    </div>
  );
};
