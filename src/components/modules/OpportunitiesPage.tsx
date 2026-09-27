/** Phase 7 — CRM pipeline: opportunity search/filter/pagination/CRUD, stage lifecycle, win/lose. */
import React, { useEffect, useState } from "react";
import { TrendingUp, Plus, Search, CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { opportunitiesApi, clientsApi, leadsApi, type Opportunity, type OpportunityStageValue, type NonTerminalOpportunityStage, type CrmClient, type Lead } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";

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
}> = ({ open, onClose, onSaved, opportunity, clients, leads }) => {
  const { notify } = useToast();
  const [clientId, setClientId] = useState(opportunity?.clientId ?? "");
  const [leadId, setLeadId] = useState(opportunity?.leadId ?? "");
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
    setSubmitting(true);
    try {
      if (opportunity) {
        await opportunitiesApi.update(opportunity.id, {
          name,
          value: Number(value),
          expectedCloseDate: expectedCloseDate || null,
          notes: notes || null,
        });
        notify("Opportunity updated.", "success");
      } else {
        await opportunitiesApi.create({
          clientId,
          leadId: leadId || undefined,
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
          <Field label="Client">
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
        )}
        {!opportunity && leads.length > 0 && (
          <Field label="Originating lead" hint="Optional — for attribution only.">
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
          <Field label="Value">
            <Input required type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Expected close date">
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

export const OpportunitiesPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "opportunities.create");
  const canUpdate = hasPermission(user?.role.permissions, "opportunities.update");
  const canDelete = hasPermission(user?.role.permissions, "opportunities.delete");
  const canClose = hasPermission(user?.role.permissions, "opportunities.close");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [stage, setStage] = useState<OpportunityStageValue | "">("");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [modal, setModal] = useState<{ open: boolean; opportunity?: Opportunity }>({ open: false });
  const [loseTarget, setLoseTarget] = useState<Opportunity | null>(null);
  const [winTarget, setWinTarget] = useState<Opportunity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Opportunity | null>(null);

  useEffect(() => {
    if (consumeNewFlag()) setModal({ open: true });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, stage]);

  useEffect(() => {
    if (!canCreate) return;
    void clientsApi.list({ limit: 100 }).then((res) => setClients(res.items));
    void leadsApi.list({ limit: 100 }).then((res) => setLeads(res.items));
  }, [canCreate]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await opportunitiesApi.list({ page, limit: 20, search: debouncedSearch || undefined, stage: stage || undefined });
      setOpportunities(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load opportunities.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, stage]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <TrendingUp className="w-5 h-5" /> Opportunities
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Sales pipeline — deals in progress against your clients.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setModal({ open: true })}>
            <Plus className="w-3.5 h-3.5" /> New opportunity
          </Button>
        )}
      </div>

      <Card>
        <div className="p-3 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: "var(--border)" }}>
          <div className="relative max-w-xs flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <Input placeholder="Search deals…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={stage} onChange={(e) => setStage(e.target.value as OpportunityStageValue | "")}>
            <option value="">All stages</option>
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : opportunities.length === 0 ? (
          <EmptyState title="No opportunities yet" description="Deals you open against a client will show up here." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {opportunities.map((o) => {
              const isTerminal = o.stage === "CLOSED_WON" || o.stage === "CLOSED_LOST";
              return (
                <li key={o.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => (canUpdate && !isTerminal ? setModal({ open: true, opportunity: o }) : undefined)}
                        className={`font-semibold truncate ${canUpdate && !isTerminal ? "hover:underline" : ""}`}
                        style={{ color: "var(--text-primary)" }}
                      >
                        {o.name}
                      </button>
                      <Badge tone={STAGE_TONE[o.stage]}>{STAGE_LABEL[o.stage]}</Badge>
                    </div>
                    <p style={{ color: "var(--text-muted)" }}>
                      {o.client.name} · {formatMoney(o.value, o.currency)}
                      {o.expectedCloseDate && ` · closes ${o.expectedCloseDate.slice(0, 10)}`}
                      {o.lostReason && ` · ${o.lostReason}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
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
                </li>
              );
            })}
          </ul>
        )}

        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>

      <OpportunityFormModal open={modal.open} onClose={() => setModal({ open: false })} onSaved={load} opportunity={modal.opportunity} clients={clients} leads={leads} />
      <LoseOpportunityModal open={!!loseTarget} onClose={() => setLoseTarget(null)} onSaved={load} opportunity={loseTarget ?? undefined} />
      <ConfirmDialog
        open={!!winTarget}
        title="Mark opportunity as won"
        message={`Mark "${winTarget?.name}" as won? This is final and cannot be undone.`}
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
