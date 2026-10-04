/** Phase 14 — Campaigns: searchable/paginated list + master-detail with lifecycle actions (docs/MARKETING_ARCHITECTURE.md). */
import React, { useEffect, useState } from "react";
import { Megaphone, Plus, Search, Copy, ExternalLink, History } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  campaignsApi,
  pagesApi,
  formsApi,
  usersApi,
  productsApi,
  type Campaign,
  type CampaignStatusValue,
  type CampaignChannelValue,
  type CampaignInput,
  type CmsPage,
  type MarketingForm,
  type CatalogProduct,
} from "../../lib/api";
import type { SanitizedUser } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { ActivityTimelineModal } from "./ActivityTimelineModal";

const STATUS_OPTIONS: CampaignStatusValue[] = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"];
const CHANNEL_OPTIONS: CampaignChannelValue[] = ["EMAIL", "SOCIAL", "PAID_SEARCH", "PAID_SOCIAL", "CONTENT", "EVENT", "REFERRAL", "DIRECT", "OTHER"];
const STATUS_TONE: Record<CampaignStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  PAUSED: "warning",
  ARCHIVED: "danger",
};

function formatPersonName(u: { firstName: string; lastName: string } | null | undefined): string {
  return u ? `${u.firstName} ${u.lastName}` : "—";
}

const CampaignFormFields: React.FC<{
  value: CampaignInput;
  onChange: (patch: Partial<CampaignInput>) => void;
  pages: CmsPage[];
  forms: MarketingForm[];
  users: SanitizedUser[];
  products: CatalogProduct[];
  selectedProductIds: string[];
  onToggleProduct: (id: string) => void;
}> = ({ value, onChange, pages, forms, users, products, selectedProductIds, onToggleProduct }) => (
  <div className="space-y-3">
    <Field label="Name">
      <Input required value={value.name} onChange={(e) => onChange({ name: e.target.value })} />
    </Field>
    <Field label="Description">
      <Input value={value.description ?? ""} onChange={(e) => onChange({ description: e.target.value })} />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Channel">
        <Select value={value.channel ?? "OTHER"} onChange={(e) => onChange({ channel: e.target.value as CampaignChannelValue })}>
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Owner">
        <Select value={value.ownerId ?? ""} onChange={(e) => onChange({ ownerId: e.target.value || undefined })}>
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {formatPersonName(u)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Start date">
        <Input type="date" value={value.startDate?.slice(0, 10) ?? ""} onChange={(e) => onChange({ startDate: e.target.value || undefined })} />
      </Field>
      <Field label="End date">
        <Input type="date" value={value.endDate?.slice(0, 10) ?? ""} onChange={(e) => onChange({ endDate: e.target.value || undefined })} />
      </Field>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Budget">
        <Input inputMode="decimal" placeholder="0.000" value={value.budget ?? ""} onChange={(e) => onChange({ budget: e.target.value === "" ? undefined : Number(e.target.value) })} />
      </Field>
      <Field label="Currency">
        <Input maxLength={3} value={value.currency ?? ""} onChange={(e) => onChange({ currency: e.target.value.toUpperCase() || undefined })} />
      </Field>
    </div>
    <Field label="Landing page" hint="Connects this campaign's UTM parameters to a real Phase 9 landing page.">
      <Select value={value.landingPageId ?? ""} onChange={(e) => onChange({ landingPageId: e.target.value || undefined })}>
        <option value="">None</option>
        {pages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title} (/{p.slug})
          </option>
        ))}
      </Select>
    </Field>
    <Field label="Form">
      <Select value={value.formId ?? ""} onChange={(e) => onChange({ formId: e.target.value || undefined })}>
        <option value="">None</option>
        {forms.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </Select>
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="UTM source">
        <Input value={value.utmSource ?? ""} onChange={(e) => onChange({ utmSource: e.target.value || undefined })} />
      </Field>
      <Field label="UTM medium">
        <Input value={value.utmMedium ?? ""} onChange={(e) => onChange({ utmMedium: e.target.value || undefined })} />
      </Field>
    </div>
    <div className="grid grid-cols-3 gap-3">
      <Field label="UTM campaign" hint="Matched case-insensitively against incoming visitor traffic for real attribution.">
        <Input value={value.utmCampaign ?? ""} onChange={(e) => onChange({ utmCampaign: e.target.value || undefined })} />
      </Field>
      <Field label="UTM term">
        <Input value={value.utmTerm ?? ""} onChange={(e) => onChange({ utmTerm: e.target.value || undefined })} />
      </Field>
      <Field label="UTM content">
        <Input value={value.utmContent ?? ""} onChange={(e) => onChange({ utmContent: e.target.value || undefined })} />
      </Field>
    </div>
    <Field label="Target audience">
      <Input value={value.targetAudience ?? ""} onChange={(e) => onChange({ targetAudience: e.target.value || undefined })} />
    </Field>
    <Field label="Notes">
      <Input value={value.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value || undefined })} />
    </Field>
    {products.length > 0 && (
      <Field label="Products / services / solutions">
        <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
          {products.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border cursor-pointer"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => onToggleProduct(p.id)} />
              {p.name}
            </label>
          ))}
        </div>
      </Field>
    )}
  </div>
);

const EMPTY_INPUT: CampaignInput = { name: "" };

const CampaignFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; editing: Campaign | null }> = ({ open, onClose, onSaved, editing }) => {
  const { notify } = useToast();
  const [value, setValue] = useState<CampaignInput>(EMPTY_INPUT);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [forms, setForms] = useState<MarketingForm[]>([]);
  const [users, setUsers] = useState<SanitizedUser[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void pagesApi.list({ limit: 100 }).then((res) => setPages(res.items));
    void formsApi.list({ limit: 100, status: "ACTIVE" }).then((res) => setForms(res.items));
    void usersApi.list({ limit: 100 }).then((res) => setUsers(res.items));
    void productsApi.list({ limit: 100, status: "ACTIVE" }).then((res) => setProducts(res.items));
    if (editing) {
      setValue({
        name: editing.name,
        description: editing.description ?? undefined,
        channel: editing.channel,
        startDate: editing.startDate ?? undefined,
        endDate: editing.endDate ?? undefined,
        ownerId: editing.ownerId ?? undefined,
        budget: editing.budget ? Number(editing.budget) : undefined,
        currency: editing.currency ?? undefined,
        landingPageId: editing.landingPageId ?? undefined,
        formId: editing.formId ?? undefined,
        utmSource: editing.utmSource ?? undefined,
        utmMedium: editing.utmMedium ?? undefined,
        utmCampaign: editing.utmCampaign ?? undefined,
        utmTerm: editing.utmTerm ?? undefined,
        utmContent: editing.utmContent ?? undefined,
        targetAudience: editing.targetAudience ?? undefined,
        notes: editing.notes ?? undefined,
      });
      setProductIds((editing.products ?? []).map((p) => p.product.id));
    } else {
      setValue(EMPTY_INPUT);
      setProductIds([]);
    }
  }, [open, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editing) {
        await campaignsApi.update(editing.id, { ...value, productIds });
        notify("Campaign updated.", "success");
      } else {
        await campaignsApi.create({ ...value, productIds });
        notify("Campaign created.", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save campaign.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit campaign" : "New campaign"}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <CampaignFormFields
          value={value}
          onChange={(patch) => setValue((prev) => ({ ...prev, ...patch }))}
          pages={pages}
          forms={forms}
          users={users}
          products={products}
          selectedProductIds={productIds}
          onToggleProduct={(id) => setProductIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))}
        />
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting || !value.name.trim()}>
            {editing ? "Save changes" : "Create campaign"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const CampaignDetail: React.FC<{ campaign: Campaign; onChanged: () => void; onEdit: () => void }> = ({ campaign, onChanged, onEdit }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "campaigns.update");
  const canPublish = hasPermission(user?.role.permissions, "campaigns.publish");
  const canArchive = hasPermission(user?.role.permissions, "campaigns.archive");
  const canCreate = hasPermission(user?.role.permissions, "campaigns.create");

  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const runAction = async (fn: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await fn();
      notify(successMessage, "success");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = async () => {
    try {
      const res = await campaignsApi.preview(campaign.id);
      if (res.preview.landingPageUrl) {
        window.open(res.preview.landingPageUrl, "_blank", "noopener,noreferrer");
      } else if (!campaign.landingPageId) {
        notify("This campaign has no landing page attached.", "info");
      } else if (!res.preview.configured) {
        notify("Public site base URL isn't configured — set PUBLIC_SITE_BASE_URL to enable live previews.", "info");
      } else {
        notify(`Landing page status: ${res.preview.landingPageStatus}.`, "info");
      }
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not load preview.", "error");
    }
  };

  const isTerminal = campaign.status === "ARCHIVED";

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {campaign.name}
            <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
            <Badge tone="neutral">{campaign.channel.replace(/_/g, " ")}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Owner: {formatPersonName(campaign.owner)}
            {campaign.startDate && ` · starts ${campaign.startDate.slice(0, 10)}`}
            {campaign.endDate && ` · ends ${campaign.endDate.slice(0, 10)}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          <Button variant="secondary" onClick={() => void handlePreview()}>
            <ExternalLink className="w-3.5 h-3.5" /> Preview
          </Button>
          <Button variant="secondary" onClick={() => setActivityOpen(true)}>
            <History className="w-3.5 h-3.5" /> Activity
          </Button>
          {canCreate && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void runAction(() => campaignsApi.duplicate(campaign.id), "Campaign duplicated.")}
            >
              <Copy className="w-3.5 h-3.5" /> Duplicate
            </Button>
          )}
          {canUpdate && !isTerminal && (
            <Button variant="secondary" disabled={busy} onClick={onEdit}>
              Edit
            </Button>
          )}
          {canUpdate && !isTerminal && campaign.status !== "ACTIVE" && (
            <Button variant="secondary" disabled={busy} onClick={() => void runAction(() => campaignsApi.activate(campaign.id), "Campaign activated.")}>
              Activate
            </Button>
          )}
          {canUpdate && campaign.status === "ACTIVE" && (
            <Button variant="secondary" disabled={busy} onClick={() => void runAction(() => campaignsApi.pause(campaign.id), "Campaign paused.")}>
              Pause
            </Button>
          )}
          {canPublish && !isTerminal && campaign.status !== "ACTIVE" && (
            <Button variant="primary" disabled={busy} onClick={() => void runAction(() => campaignsApi.publish(campaign.id), "Campaign published.")}>
              Publish
            </Button>
          )}
          {canArchive && !isTerminal && (
            <Button variant="danger" disabled={busy} onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Leads</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {campaign._count?.leads ?? 0}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Form submissions</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {campaign._count?.formSubmissions ?? 0}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Opportunities</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {campaign._count?.opportunities ?? 0}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Clients won</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {campaign._count?.clients ?? 0}
          </p>
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Landing page</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {campaign.landingPage ? `${campaign.landingPage.title} (${campaign.landingPage.status})` : "—"}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Form</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {campaign.form?.name ?? "—"}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Budget</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {campaign.budget ? `${campaign.budget} ${campaign.currency ?? ""}` : "—"}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>UTM campaign</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {campaign.utmCampaign ?? "—"}
          </p>
        </div>
      </div>

      {(campaign.targetAudience || campaign.notes || campaign.description) && (
        <div className="p-4 space-y-2 text-xs">
          {campaign.description && <p style={{ color: "var(--text-secondary)" }}>{campaign.description}</p>}
          {campaign.targetAudience && (
            <p style={{ color: "var(--text-muted)" }}>
              <span className="font-semibold">Audience:</span> {campaign.targetAudience}
            </p>
          )}
          {campaign.notes && (
            <p style={{ color: "var(--text-muted)" }}>
              <span className="font-semibold">Notes:</span> {campaign.notes}
            </p>
          )}
        </div>
      )}

      {campaign.products && campaign.products.length > 0 && (
        <div className="px-4 pb-4 flex flex-wrap gap-1.5">
          {campaign.products.map((p) => (
            <Badge key={p.product.id} tone="neutral">
              {p.product.name}
            </Badge>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={archiveOpen}
        title="Archive campaign"
        message="Archiving is final — this campaign can no longer be edited or reactivated."
        confirmLabel="Archive campaign"
        onConfirm={() => {
          setArchiveOpen(false);
          void runAction(() => campaignsApi.archive(campaign.id), "Campaign archived.");
        }}
        onCancel={() => setArchiveOpen(false)}
      />

      <ActivityTimelineModal open={activityOpen} onClose={() => setActivityOpen(false)} title={`Activity — ${campaign.name}`} load={() => campaignsApi.activity(campaign.id)} />
    </Card>
  );
};

export const CampaignsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "campaigns.create");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<CampaignStatusValue | "">("");
  const [channel, setChannel] = useState<CampaignChannelValue | "">("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, status, channel]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await campaignsApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined, channel: channel || undefined });
      setCampaigns(res.items);
      setTotalPages(res.totalPages);
      setSelectedId((prev) => (prev && res.items.some((c) => c.id === prev) ? prev : (res.items[0]?.id ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status, channel]);

  useEffect(() => {
    void load();
  }, [load]);

  const [selectedDetail, setSelectedDetail] = useState<Campaign | null>(null);
  const loadDetail = React.useCallback(async (id: string | null) => {
    if (!id) {
      setSelectedDetail(null);
      return;
    }
    try {
      const res = await campaignsApi.get(id);
      setSelectedDetail(res.campaign);
    } catch {
      setSelectedDetail(null);
    }
  }, []);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Megaphone className="w-5 h-5" /> Campaigns
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Marketing campaigns, their attribution, and lifecycle.
          </p>
        </div>
        {canCreate && (
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="w-4 h-4" /> New campaign
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search campaigns…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as CampaignStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={channel} onChange={(e) => setChannel(e.target.value as CampaignChannelValue | "")}>
          <option value="">All channels</option>
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : campaigns.length === 0 ? (
        <Card>
          <EmptyState title="No campaigns found" description="Create a campaign or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {campaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selectedId === c.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{c.name}</span>
                <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selectedDetail && (
            <CampaignDetail
              campaign={selectedDetail}
              onChanged={() => {
                void load();
                void loadDetail(selectedId);
              }}
              onEdit={() => {
                setEditing(selectedDetail);
                setFormOpen(true);
              }}
            />
          )}
        </div>
      )}

      <CampaignFormModal
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          void load();
          void loadDetail(selectedId);
        }}
      />
    </div>
  );
};
