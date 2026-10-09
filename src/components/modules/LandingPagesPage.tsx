/** Marketing → Landing Pages (Step 12): list, create from template, and the editor. See docs/MARKETING_LANDING_PAGES.md. */
import React, { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Plus, Search } from "lucide-react";
import { landingApi, type LandingPageRow, type LandingStatus, type LandingTemplateInfo } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field } from "../ui/ui";
import { LandingEditor, LANDING_STATUS_LABEL, LANDING_STATUS_TONE } from "./LandingEditor";

const STATUSES: LandingStatus[] = ["DRAFT", "IN_REVIEW", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"];
const idFromUrl = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("id"));

export const LandingPagesPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const perms = user?.role.permissions;
  const canEdit = hasPermission(perms, "marketing.landing.edit");
  const canPublish = hasPermission(perms, "marketing.landing.publish");
  const [openId, setOpenId] = useState<string | null>(idFromUrl());
  const [rows, setRows] = useState<LandingPageRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LandingStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<LandingTemplateInfo[]>([]);
  const [form, setForm] = useState({ title: "", templateKey: "lead-gen" });
  const [saving, setSaving] = useState(false);

  const openPage = (id: string | null) => {
    setOpenId(id);
    window.history.replaceState({}, "", id ? `${window.location.pathname}?id=${id}` : window.location.pathname);
  };

  const load = useCallback(() => {
    setLoading(true);
    landingApi.list({ page, limit: 20, search: search || undefined, status: status || undefined })
      .then((r) => { setRows(r.items); setTotalPages(r.totalPages); setError(null); })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load landing pages."))
      .finally(() => setLoading(false));
  }, [page, search, status]);
  useEffect(() => { if (!openId) load(); }, [load, openId]);
  useEffect(() => { if (creating && templates.length === 0) landingApi.templates().then((r) => setTemplates(r.templates)).catch(() => undefined); }, [creating, templates.length]);

  if (openId) return <LandingEditor id={openId} canEdit={canEdit} canPublish={canPublish} onBack={() => openPage(null)} />;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { const r = await landingApi.create({ title: form.title.trim(), templateKey: form.templateKey }); setCreating(false); setForm({ title: "", templateKey: "lead-gen" }); openPage(r.page.id); }
    catch (err) { notify(err instanceof ApiClientError ? err.message : "Could not create the page.", "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><LayoutTemplate className="w-5 h-5" /> Landing pages</h2>
          <p className="text-xs max-w-xl" style={{ color: "var(--text-muted)" }}>Campaign pages on your website at /lp/&lt;address&gt;. Build from a template, preview privately, publish through the Approvals center.</p>
        </div>
        {canEdit && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" /> New landing page</Button>}
      </div>
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-3" style={{ color: "var(--text-muted)" }} />
          <Input aria-label="Search landing pages" className="pl-8" placeholder="Search by title or address" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as LandingStatus | ""); setPage(1); }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{LANDING_STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      <Card className="overflow-hidden">
        {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : rows.length === 0 ? (
          <EmptyState title="No landing pages yet" description={canEdit ? "Create one from a template to get started." : "Nothing here yet."} />
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.id} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                <button type="button" className="w-full text-left px-4 py-3 flex items-center gap-3 flex-wrap hover:opacity-90" onClick={() => openPage(r.id)}>
                  <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{r.title}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{r.path}</span>
                  <Badge tone={LANDING_STATUS_TONE[r.status]}>{LANDING_STATUS_LABEL[r.status]}</Badge>
                  {r.hasUnpublishedChanges && <Badge tone="warning">Unpublished changes</Badge>}
                  {r.pendingApproval && <Badge tone="info">Awaiting approval</Badge>}
                  {r.noindex && <Badge tone="neutral">noindex</Badge>}
                  <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>Updated {new Date(r.updatedAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      <Modal open={creating} onClose={() => setCreating(false)} title="New landing page">
        <form onSubmit={create} className="space-y-3">
          <Field label="Page name"><Input required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>Starting template</legend>
            {templates.map((t) => (
              <label key={t.key} className="flex items-start gap-2 rounded-xl border p-2 text-xs cursor-pointer" style={{ borderColor: form.templateKey === t.key ? "var(--accent)" : "var(--border)", color: "var(--text-secondary)" }}>
                <input type="radio" name="tpl" className="mt-0.5" checked={form.templateKey === t.key} onChange={() => setForm({ ...form, templateKey: t.key })} />
                <span><span className="font-bold" style={{ color: "var(--text-primary)" }}>{t.name}</span><br />{t.description}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Templates contain example wording in [[Replace: …]] brackets. No invented testimonials, numbers or logos: publishing is blocked until you replace them.</p>
          <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <Button type="button" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving || !form.title.trim()}>{saving ? "Creating…" : "Create"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
