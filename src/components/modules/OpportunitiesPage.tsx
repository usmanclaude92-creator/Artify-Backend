/** Phase 7/12 — CRM pipeline: Kanban board (native HTML5 drag/drop, persisted server-side via PATCH + requirePermission), lead-first deals, product/source/probability attribution, activity timeline. */
import React, { useEffect, useState } from "react";
import { TrendingUp, Plus, Search, CheckCircle2, XCircle, History, Link2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  opportunitiesApi,
  clientsApi,
  leadsApi,
  productsApi,
  type Opportunity,
  type OpportunityStageValue,
  type NonTerminalOpportunityStage,
  type CrmClient,
  type Lead,
  type CatalogProduct,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";
import { ActivityTimelineModal } from "./ActivityTimelineModal";

const NON_TERMINAL_STAGES: NonTerminalOpportunityStage[] = ["PROSPECTING", "QUALIFICATION", "PROPOSAL", "NEGOTIATION"];
const ALL_STAGES: OpportunityStageValue[] = [...NON_TERMINAL_STAGES, "CLOSED_WON", "CLOSED_LOST"];
export const STAGE_LABEL: Record<OpportunityStageValue, string> = {
  PROSPECTING: "Prospecting",
  QUALIFICATION: "Qualification",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  CLOSED_WON: "Won",
  CLOSED_LOST: "Lost",
};
export const STAGE_TONE: Record<OpportunityStageValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PROSPECTING: "neutral",
  QUALIFICATION: "info",
  PROPOSAL: "info",
  NEGOTIATION: "warning",
  CLOSED_WON: "success",
  CLOSED_LOST: "danger",
};

export function formatMoney(value: string, currency: string): string {
  const n = Number(value);
  return `${Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : value} ${currency}`;
}

const OpportunityFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  opportunity?: Opportunity;
  clients: CrmClient[];
  leads: Lead[];
  products: CatalogProduct[];
}> = ({ open, onClose, onSaved, opportunity, clients, leads, products }) => {
  const { notify } = useToast();
  const [clientId, setClientId] = useState(opportunity?.clientId ?? "");
  const [leadId, setLeadId] = useState(opportunity?.leadId ?? "");
  const [productId, setProductId] = useState(opportunity?.productId ?? "");
  const [source, setSource] = useState(opportunity?.source ?? "");
  const [probability, setProbability] = useState(opportunity?.probability != null ? String(opportunity.probability) : "");
  const [name, setName] = useState(opportunity?.name ?? "");
  const [value, setValue] = useState(opportunity?.value ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(opportunity?.expectedCloseDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(opportunity?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setClientId(opportunity?.clientId ?? "");
      setLeadId(opportunity?.leadId ?? "");
      setProductId(opportunity?.productId ?? "");
      setSource(opportunity?.source ?? "");
      setProbability(opportunity?.probability != null ? String(opportunity.probability) : "");
      setName(opportunity?.name ?? "");
      setValue(opportunity?.value ?? "");
      setExpectedCloseDate(opportunity?.expectedCloseDate?.slice(0, 10) ?? "");
      setNotes(opportunity?.notes ?? "");
      setError(null);
    }
  }, [open, opportunity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!opportunity && !clientId && !leadId) {
      setError("Either a client or an originating lead must be selected.");
      return;
    }
    setSubmitting(true);
    try {
      if (opportunity) {
        await opportunitiesApi.update(opportunity.id, {
          name,
          value: Number(value),
          productId: productId || null,
          source: source || null,
          probability: probability === "" ? null : Number(probability),
          expectedCloseDate: expectedCloseDate || null,
          notes: notes || null,
        });
        notify("Opportunity updated.", "success");
      } else {
        await opportunitiesApi.create({
          clientId: clientId || undefined,
          leadId: leadId || undefined,
          productId: productId || undefined,
          source: source || undefined,
          probability: probability === "" ? undefined : Number(probability),
          name,
          value: Number(value),
          expectedCloseDate: expectedCloseDate || undefined,
          notes: notes || undefined,
        });
        notify("Opportunity created.", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save opportunity.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={opportunity ? `Edit ${opportunity.name}` : "New opportunity"}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Deal name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Platform renewal — Q3" />
        </Field>
        {!opportunity && (
          <Field label="Client" hint="Optional if an originating lead is selected below — deals can open directly against a lead before conversion.">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">None yet (lead-first deal)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.clientCode})
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!opportunity && leads.length > 0 && (
          <Field label="Originating lead" hint={clientId ? "Optional — for attribution only." : "Required when no client is selected."}>
            <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">None</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.companyName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product / service / solution" hint="Optional — links this deal to a catalog item.">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">None</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source">
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Outbound, Referral" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Value">
            <Input required type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Probability %" hint="Optional.">
            <Input type="number" min="0" max="100" value={probability} onChange={(e) => setProbability(e.target.value)} />
          </Field>
          <Field label="Expected close">
            <Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const LoseOpportunityModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; opportunity?: Opportunity }> = ({
  open,
  onClose,
  onSaved,
  opportunity,
}) => {
  const { notify } = useToast();
  const [lostReason, setLostReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setLostReason("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opportunity) return;
    setError(null);
    setSubmitting(true);
    try {
      await opportunitiesApi.lose(opportunity.id, lostReason || undefined);
      notify("Opportunity marked as lost.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not close opportunity.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Mark "${opportunity?.name ?? ""}" as lost`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Reason (optional)">
          <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. Went with a competitor" />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Mark as lost
          </Button>
        </div>
      </form>
    </Modal>
  );
};

/** Phase 12 — links an existing Client to a deal that was opened directly against a Lead (no client yet). Required before winOpportunity will accept it. */
const LinkClientModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; opportunity?: Opportunity; clients: CrmClient[] }> = ({
  open,
  onClose,
  onSaved,
  opportunity,
  clients,
}) => {
  const { notify } = useToast();
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setClientId("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opportunity || !clientId) return;
    setError(null);
    setSubmitting(true);
    try {
      await opportunitiesApi.linkClient(opportunity.id, clientId);
      notify("Client linked to opportunity.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not link client.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Link a client to "${opportunity?.name ?? ""}"`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Client" hint="This deal was opened directly against a lead — link the converted client before it can be marked won.">
          <Select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="" disabled>
              Select a client…
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.clientCode})
              </option>
            ))}
          </Select>
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Link client
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const KANBAN_COLUMNS: OpportunityStageValue[] = ALL_STAGES;

export const OpportunitiesPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "opportunities.create");
  const canUpdate = hasPermission(user?.role.permissions, "opportunities.update");
  const canDelete = hasPermission(user?.role.permissions, "opportunities.delete");
  const canClose = hasPermission(user?.role.permissions, "opportunities.close");
  const canSeeProducts = hasPermission(user?.role.permissions, "products.read");

  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [modal, setModal] = useState<{ open: boolean; opportunity?: Opportunity }>({ open: false });
  const [loseTarget, setLoseTarget] = useState<Opportunity | null>(null);
  const [winTarget, setWinTarget] = useState<Opportunity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Opportunity | null>(null);
  const [linkClientTarget, setLinkClientTarget] = useState<Opportunity | null>(null);
  const [activityTarget, setActivityTarget] = useState<Opportunity | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (consumeNewFlag()) setModal({ open: true });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!canCreate) return;
    void clientsApi.list({ limit: 100 }).then((res) => setClients(res.items));
    void leadsApi.list({ limit: 100 }).then((res) => setLeads(res.items));
  }, [canCreate]);

  useEffect(() => {
    if (!canSeeProducts) return;
    void productsApi.list({ limit: 100, status: "ACTIVE" }).then((res) => setProducts(res.items));
  }, [canSeeProducts]);

  // Load every stage at once (capped at 100/stage) so the board can render
  // all columns without per-column pagination — the pipeline is expected
  // to stay small enough for this; search still narrows server-side.
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await opportunitiesApi.list({ limit: 100, search: debouncedSearch || undefined, sort: "updatedAt", order: "desc" });
      setOpportunities(res.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load opportunities.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleWin = async () => {
    if (!winTarget) return;
    try {
      await opportunitiesApi.win(winTarget.id);
      notify("Opportunity marked as won.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not close opportunity.", "error");
    } finally {
      setWinTarget(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await opportunitiesApi.remove(deleteTarget.id);
      notify("Opportunity deleted.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete opportunity.", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleDrop = async (stage: OpportunityStageValue) => {
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const opp = opportunities.find((o) => o.id === id);
    if (!opp || opp.stage === stage) return;
    const isTerminal = (s: OpportunityStageValue) => s === "CLOSED_WON" || s === "CLOSED_LOST";
    if (isTerminal(opp.stage)) {
      notify("A closed opportunity cannot be moved — it has already been won or lost.", "error");
      return;
    }
    // Drag-and-drop only reorders between non-terminal stages; dropping on
    // a closed column should use the explicit Win/Lose actions instead,
    // since those enforce the clientId-required and reason-capture rules.
    if (isTerminal(stage)) {
      if (stage === "CLOSED_WON") setWinTarget(opp);
      else setLoseTarget(opp);
      return;
    }
    // Optimistic move, reverted on failure — the PATCH is the real
    // persistence; this just avoids a visible snap-back on the happy path.
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, stage } : o)));
    try {
      await opportunitiesApi.update(id, { stage: stage as NonTerminalOpportunityStage });
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not move opportunity.", "error");
      void load();
    }
  };

  const columnTotal = (stage: OpportunityStageValue) =>
    opportunities
      .filter((o) => o.stage === stage)
      .reduce((sum, o) => sum + Number(o.value), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <TrendingUp className="w-5 h-5" /> Opportunities
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Sales pipeline — drag a card between columns to change its stage.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setModal({ open: true })}>
            <Plus className="w-3.5 h-3.5" /> New opportunity
          </Button>
        )}
      </div>

      <Card className="p-3">
        <div className="relative max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search deals…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </Card>

      {loading ? (
        <Card>
          <LoadingState />
        </Card>
      ) : error ? (
        <Card>
          <ErrorState message={error} />
        </Card>
      ) : opportunities.length === 0 ? (
        <Card>
          <EmptyState title="No opportunities yet" description="Deals opened against a client or lead will show up here." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {KANBAN_COLUMNS.map((stage) => {
            const cards = opportunities.filter((o) => o.stage === stage);
            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleDrop(stage);
                }}
                className="rounded-xl flex flex-col min-h-[120px]"
                style={{ background: "var(--bg-surface-alt)", border: "1px solid var(--border)" }}
              >
                <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {cards.length}
                    </span>
                  </div>
                </div>
                <div className="px-3 py-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  {cards.length > 0 ? formatMoney(String(columnTotal(stage)), cards[0]!.currency) : "—"}
                </div>
                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {cards.map((o) => {
                    const isTerminal = o.stage === "CLOSED_WON" || o.stage === "CLOSED_LOST";
                    return (
                      <div
                        key={o.id}
                        draggable={canUpdate && !isTerminal}
                        onDragStart={() => setDraggingId(o.id)}
                        onDragEnd={() => setDraggingId(null)}
                        className="rounded-lg p-2.5 text-xs space-y-1 cursor-pointer"
                        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", opacity: draggingId === o.id ? 0.5 : 1 }}
                        onClick={() => (canUpdate && !isTerminal ? setModal({ open: true, opportunity: o }) : undefined)}
                      >
                        <p className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                          {o.name}
                        </p>
                        <p style={{ color: "var(--text-muted)" }}>{o.client ? o.client.name : o.lead ? `Lead: ${o.lead.companyName}` : "—"}</p>
                        <p className="font-medium" style={{ color: "var(--text-secondary)" }}>
                          {formatMoney(o.value, o.currency)}
                          {o.probability != null && ` · ${o.probability}%`}
                        </p>
                        {o.product && <p style={{ color: "var(--text-muted)" }}>{o.product.name}</p>}
                        {o.expectedCloseDate && <p style={{ color: "var(--text-muted)" }}>Closes {o.expectedCloseDate.slice(0, 10)}</p>}
                        {o.lostReason && <p style={{ color: "var(--text-muted)" }}>{o.lostReason}</p>}
                        <div className="flex items-center gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" onClick={() => setActivityTarget(o)} aria-label="View activity">
                            <History className="w-3.5 h-3.5" />
                          </Button>
                          {canUpdate && !o.clientId && !isTerminal && (
                            <Button variant="ghost" onClick={() => setLinkClientTarget(o)} aria-label="Link client">
                              <Link2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canClose && !isTerminal && (
                            <>
                              <Button variant="ghost" onClick={() => setWinTarget(o)} aria-label="Mark won">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              </Button>
                              <Button variant="ghost" onClick={() => setLoseTarget(o)} aria-label="Mark lost">
                                <XCircle className="w-3.5 h-3.5 text-rose-500" />
                              </Button>
                            </>
                          )}
                          {canDelete && (
                            <Button variant="ghost" onClick={() => setDeleteTarget(o)} aria-label="Delete opportunity">
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <OpportunityFormModal
        open={modal.open}
        onClose={() => setModal({ open: false })}
        onSaved={load}
        opportunity={modal.opportunity}
        clients={clients}
        leads={leads}
        products={products}
      />
      <LoseOpportunityModal open={!!loseTarget} onClose={() => setLoseTarget(null)} onSaved={load} opportunity={loseTarget ?? undefined} />
      <LinkClientModal open={!!linkClientTarget} onClose={() => setLinkClientTarget(null)} onSaved={load} opportunity={linkClientTarget ?? undefined} clients={clients} />
      <ActivityTimelineModal
        open={!!activityTarget}
        onClose={() => setActivityTarget(null)}
        title={`Activity — ${activityTarget?.name ?? ""}`}
        load={() => opportunitiesApi.activity(activityTarget!.id)}
      />
      <ConfirmDialog
        open={!!winTarget}
        title="Mark opportunity as won"
        message={
          winTarget && !winTarget.clientId
            ? `"${winTarget.name}" has no linked client yet — link a client first, then mark it won.`
            : `Mark "${winTarget?.name}" as won? This is final and cannot be undone.`
        }
        confirmLabel="Mark as won"
        onConfirm={handleWin}
        onCancel={() => setWinTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete opportunity"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
