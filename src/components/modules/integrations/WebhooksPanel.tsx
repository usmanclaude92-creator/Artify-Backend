import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { webhookEndpointsApi, type WebhookDelivery, type WebhookEndpoint } from "../../../lib/api";
import { ApiClientError } from "../../../lib/apiClient";
import { hasPermission } from "../../../lib/permissions";
import { Card, Badge, Button, Input, Field, Modal, ConfirmDialog, LoadingState, ErrorState, EmptyState, Pagination, DataTable, type DataTableColumn } from "../../ui/ui";
import { SecretRevealModal } from "./SecretRevealModal";

const DELIVERY_TONE = { SUCCEEDED: "success", PENDING: "warning", FAILED: "danger" } as const;
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

const EndpointModal: React.FC<{ open: boolean; endpoint?: WebhookEndpoint; onClose: () => void; onSaved: (secret?: string) => void }> = ({ open, endpoint, onClose, onSaved }) => {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<{ eventType: string; description: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(endpoint?.name ?? "");
    setUrl(endpoint?.url ?? "");
    setEvents(endpoint?.events ?? []);
    setError(null);
    webhookEndpointsApi.events().then((r) => setCatalog(r.events)).catch(() => setCatalog([]));
  }, [open, endpoint]);

  const all = events.includes("*");
  const toggle = (t: string) => setEvents((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur.filter((x) => x !== "*"), t]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (endpoint) {
        await webhookEndpointsApi.update(endpoint.id, { name, url, events });
        notify("Webhook updated.", "success");
        onSaved();
      } else {
        const res = await webhookEndpointsApi.create({ name, url, events });
        onSaved(res.secret);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save webhook.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={endpoint ? "Edit webhook endpoint" : "Add webhook endpoint"}>
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Endpoint URL" hint="Must be a public HTTPS URL. Private and internal addresses are rejected."><Input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/artify" /></Field>
        <Field label="Events">
          <label className="flex items-center gap-2 text-xs mb-1.5"><input type="checkbox" checked={all} onChange={(e) => setEvents(e.target.checked ? ["*"] : [])} /> All events</label>
          {!all && (
            <div className="max-h-40 overflow-y-auto border rounded-lg p-2 space-y-1" style={{ borderColor: "var(--border)" }}>
              {catalog.map((ev) => (
                <label key={ev.eventType} className="flex items-start gap-2 text-xs" title={ev.description}>
                  <input type="checkbox" checked={events.includes(ev.eventType)} onChange={() => toggle(ev.eventType)} />
                  <span><span className="font-mono">{ev.eventType}</span></span>
                </label>
              ))}
            </div>
          )}
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || events.length === 0}>{endpoint ? "Save changes" : "Create endpoint"}</Button>
        </div>
      </form>
    </Modal>
  );
};

const DeliveriesModal: React.FC<{ endpoint: WebhookEndpoint | null; canManage: boolean; onClose: () => void }> = ({ endpoint, canManage, onClose }) => {
  const { notify } = useToast();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<WebhookDelivery[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!endpoint) return;
    setLoading(true);
    try {
      const r = await webhookEndpointsApi.deliveries(endpoint.id, { page, limit: 10 });
      setRows(r.items);
      setTotalPages(r.totalPages);
    } finally {
      setLoading(false);
    }
  }, [endpoint, page]);
  useEffect(() => { setPage(1); }, [endpoint]);
  useEffect(() => { void load(); }, [load]);

  const retry = async (d: WebhookDelivery) => {
    try {
      await webhookEndpointsApi.retry(d.id);
      notify("Retry attempted.", "success");
    } catch (e) {
      notify(e instanceof ApiClientError ? e.message : "Retry failed.", "error");
    }
    void load();
  };

  const columns: DataTableColumn<WebhookDelivery>[] = [
    { key: "when", header: "When", cellClassName: "whitespace-nowrap", cellStyle: { color: "var(--text-muted)" }, render: (d) => new Date(d.createdAt).toLocaleString() },
    { key: "event", header: "Event", cellClassName: "font-mono", render: (d) => d.eventType },
    { key: "status", header: "Status", render: (d) => <Badge tone={DELIVERY_TONE[d.status]}>{d.status}</Badge> },
    { key: "att", header: "Attempts", render: (d) => d.attempts },
    { key: "resp", header: "Response", cellStyle: { color: "var(--text-muted)" }, render: (d) => d.responseStatus ?? "—" },
    { key: "err", header: "Detail", cellStyle: { color: "var(--text-muted)" }, render: (d) => d.error ?? (d.nextRetryAt ? `Retry at ${new Date(d.nextRetryAt).toLocaleTimeString()}` : "") },
    { key: "act", header: "", align: "right", render: (d) => (canManage && d.status !== "SUCCEEDED" ? <Button variant="secondary" onClick={() => void retry(d)}>Retry now</Button> : null) },
  ];
  return (
    <Modal open={!!endpoint} onClose={onClose} title={`Deliveries — ${endpoint?.name ?? ""}`}>
      {loading ? <LoadingState /> : rows.length === 0 ? <EmptyState title="No deliveries yet" description="Send a test delivery to see it here." /> : <DataTable columns={columns} rows={rows} keyOf={(d) => d.id} />}
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </Modal>
  );
};

export const WebhooksPanel: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "webhooks.manage");
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ endpoint?: WebhookEndpoint } | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookEndpoint | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpoint | null>(null);
  const [rotating, setRotating] = useState<WebhookEndpoint | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEndpoints((await webhookEndpointsApi.list()).endpoints);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load webhooks.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      notify(success, "success");
    } catch (e) {
      notify(e instanceof ApiClientError ? e.message : "Action failed.", "error");
    }
    void load();
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Signed HTTPS callbacks for platform events. Each request carries <span className="font-mono">X-Artify-Signature</span> (HMAC-SHA256 of <span className="font-mono">timestamp.body</span>). Failed deliveries are retried up to 5 times.
        </p>
        {canManage && <Button variant="primary" onClick={() => setEditing({})}>Add endpoint</Button>}
      </div>

      {endpoints.length === 0 ? (
        <Card><EmptyState title="No webhook endpoints" description="Add an endpoint to receive signed event notifications." /></Card>
      ) : (
        endpoints.map((e) => (
          <Card key={e.id} className="p-4 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{e.name}</p>
                <p className="text-xs font-mono break-all" style={{ color: "var(--text-muted)" }}>{e.url}</p>
              </div>
              <div className="flex gap-1.5">
                <Badge tone={e.enabled ? "success" : "neutral"}>{e.enabled ? "Enabled" : "Disabled"}</Badge>
                {(e.last24h?.failed ?? 0) > 0 && <Badge tone="danger">{e.last24h!.failed} failed (24h)</Badge>}
                {(e.last24h?.pending ?? 0) > 0 && <Badge tone="warning">{e.last24h!.pending} retrying</Badge>}
              </div>
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Events: {e.events.includes("*") ? "all" : e.events.join(", ")} · Secret ••••{e.secretLast4} · Last success {when(e.lastSuccessAt)} · Last failure {when(e.lastFailureAt)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDeliveriesFor(e)}>Deliveries</Button>
              {canManage && (
                <>
                  <Button variant="secondary" onClick={() => void run(() => webhookEndpointsApi.test(e.id), "Test delivery sent.")}>Send test</Button>
                  <Button variant="secondary" onClick={() => setEditing({ endpoint: e })}>Edit</Button>
                  <Button variant="secondary" onClick={() => void run(() => webhookEndpointsApi.update(e.id, { enabled: !e.enabled }), e.enabled ? "Endpoint disabled." : "Endpoint enabled.")}>{e.enabled ? "Disable" : "Enable"}</Button>
                  <Button variant="secondary" onClick={() => setRotating(e)}>Rotate secret</Button>
                  <Button variant="danger" onClick={() => setDeleting(e)}>Delete</Button>
                </>
              )}
            </div>
          </Card>
        ))
      )}

      <EndpointModal open={!!editing} endpoint={editing?.endpoint} onClose={() => setEditing(null)} onSaved={(s) => { if (s) setSecret(s); void load(); }} />
      <DeliveriesModal endpoint={deliveriesFor} canManage={canManage} onClose={() => { setDeliveriesFor(null); void load(); }} />
      <SecretRevealModal title="Webhook signing secret" label="signing secret" secret={secret} onClose={() => setSecret(null)} />
      <ConfirmDialog open={!!deleting} title="Delete webhook endpoint" message={`Stop sending events to “${deleting?.name}”? Delivery history for this endpoint will no longer be reachable.`} confirmLabel="Delete endpoint" destructive onCancel={() => setDeleting(null)} onConfirm={() => { const id = deleting!.id; setDeleting(null); void run(() => webhookEndpointsApi.remove(id), "Endpoint deleted."); }} />
      <ConfirmDialog open={!!rotating} title="Rotate signing secret" message={`Generate a new signing secret for “${rotating?.name}”? The old secret stops working immediately — update your receiver straight away.`} confirmLabel="Rotate secret" destructive onCancel={() => setRotating(null)} onConfirm={async () => { const id = rotating!.id; setRotating(null); try { const r = await webhookEndpointsApi.rotateSecret(id); setSecret(r.secret); void load(); } catch (e) { notify(e instanceof ApiClientError ? e.message : "Could not rotate secret.", "error"); } }} />
    </div>
  );
};
