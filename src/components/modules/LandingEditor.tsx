/** Landing page editor (Step 12): ordered blocks, SEO, publish checklist, preview, approval, versions and performance. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUp, ArrowDown, Trash2, Plus, Save, Eye, Send, Undo2, EyeOff, Archive, History, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { landingApi, type LandingBlock, type LandingPageView, type LandingRevisionRow, type LandingStats } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useToast } from "../../context/ToastContext";
import { Card, Button, Input, Badge, LoadingState, ErrorState, Field, ConfirmDialog } from "../ui/ui";
import { LandingBlockEditor } from "./LandingBlockEditor";
import { BLOCK_SPECS, SPEC_BY_TYPE, cleanProps, newBlockId } from "../../lib/landingBlocks";
import { MediaPickerModal } from "../common/MediaPickerModal";

export const LANDING_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral", IN_REVIEW: "info", PUBLISHED: "success", UNPUBLISHED: "warning", ARCHIVED: "danger",
};
export const LANDING_STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", IN_REVIEW: "Pending approval", PUBLISHED: "Published", UNPUBLISHED: "Unpublished", ARCHIVED: "Archived" };

type Tab = "content" | "settings" | "versions" | "performance";

const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea rows={3} className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2" style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }} {...props} />
);

const errMsg = (e: unknown, fallback: string) => {
  if (e instanceof ApiClientError) {
    const issues = (e.details as { issues?: Array<{ message: string }> } | undefined)?.issues;
    return issues?.length ? `${e.message} ${issues.map((i) => i.message).join(" ")}` : e.message;
  }
  return fallback;
};

export const LandingEditor: React.FC<{ id: string; canEdit: boolean; canPublish: boolean; onBack: () => void }> = ({ id, canEdit, canPublish, onBack }) => {
  const { notify } = useToast();
  const [page, setPage] = useState<LandingPageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<LandingBlock[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [seo, setSeo] = useState({ metaTitle: "", metaDescription: "", noindex: false, ogImageMediaId: null as string | null });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("content");
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "unpublish" | "archive">(null);
  const [preview, setPreview] = useState<{ url: string | null; path: string; expiresAt: string } | null>(null);
  const [revisions, setRevisions] = useState<LandingRevisionRow[] | null>(null);
  const [stats, setStats] = useState<LandingStats | null>(null);
  const [days, setDays] = useState(30);
  const [ogPicker, setOgPicker] = useState(false);

  const load = useCallback((p: LandingPageView) => {
    setPage(p); setBlocks(p.document.blocks); setTitle(p.title); setSlug(p.slug);
    setSeo({ metaTitle: p.seo.metaTitle ?? "", metaDescription: p.seo.metaDescription ?? "", noindex: p.seo.noindex, ogImageMediaId: p.seo.ogImageMediaId });
    setDirty(false);
  }, []);
  useEffect(() => { landingApi.get(id).then((r) => load(r.page)).catch((e) => setError(errMsg(e, "Could not load the page."))); }, [id, load]);
  useEffect(() => { if (tab === "versions") landingApi.revisions(id).then((r) => setRevisions(r.revisions)).catch(() => setRevisions([])); }, [tab, id, page?.version, page?.updatedAt]);
  useEffect(() => { if (tab === "performance") landingApi.stats(id, days).then((r) => setStats(r.stats)).catch(() => setStats(null)); }, [tab, id, days]);

  const locked = !canEdit || page?.status === "ARCHIVED" || !!page?.pendingApproval;
  const run = async (fn: () => Promise<{ page: LandingPageView } | void>, ok?: string) => {
    setBusy(true);
    try { const r = await fn(); if (r && "page" in r) load(r.page); if (ok) notify(ok, "success"); return true; } catch (e) { notify(errMsg(e, "That did not work."), "error"); return false; } finally { setBusy(false); }
  };

  const save = () => run(async () => landingApi.update(id, {
    title, ...(slug !== page?.slug ? { slug } : {}),
    document: { version: 1, blocks: blocks.map((b) => ({ ...b, props: cleanProps(b.props) as Record<string, any> })) },
    seo: { metaTitle: seo.metaTitle, metaDescription: seo.metaDescription, noindex: seo.noindex, ogImageMediaId: seo.ogImageMediaId },
    expectedUpdatedAt: page?.updatedAt,
  }), "Saved");

  const mutate = (fn: (b: LandingBlock[]) => LandingBlock[]) => { setBlocks(fn); setDirty(true); };
  const move = (i: number, d: -1 | 1) => mutate((b) => { const j = i + d; if (j < 1 && b[i]?.type === "lp_hero") return b; if (j < 0 || j >= b.length) return b; const c = [...b]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
  const addBlock = (type: string) => {
    const spec = SPEC_BY_TYPE[type]!;
    const block: LandingBlock = { id: newBlockId(type), type, props: spec.blank() };
    mutate((b) => {
      const footer = b.findIndex((x) => x.type === "lp_footer");
      if (type === "lp_footer") return [...b, block];
      if (type === "lp_hero") return [block, ...b];
      return footer === -1 ? [...b, block] : [...b.slice(0, footer), block, ...b.slice(footer)];
    });
    setOpenBlock(block.id);
  };

  const issues = useMemo(() => page?.publishIssues ?? [], [page]);
  if (error) return <ErrorState message={error} />;
  if (!page) return <LoadingState />;
  const available = BLOCK_SPECS.filter((s) => !s.unique || !blocks.some((b) => b.type === s.type));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onBack} aria-label="Back to landing pages"><ArrowLeft className="w-4 h-4" /> Landing pages</Button>
        <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{page.title}</h2>
        <Badge tone={LANDING_STATUS_TONE[page.status]}>{LANDING_STATUS_LABEL[page.status]}</Badge>
        {page.hasUnpublishedChanges && <Badge tone="warning">Unpublished changes</Badge>}
        {page.status === "PUBLISHED" && page.publicUrl && (
          <a href={page.publicUrl} target="_blank" rel="noreferrer" className="text-xs underline inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>{page.path} <ExternalLink className="w-3 h-3" /></a>
        )}
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        {canEdit && <Button variant="primary" disabled={busy || locked || !dirty} onClick={() => void save()}><Save className="w-3.5 h-3.5" /> {dirty ? "Save changes" : "Saved"}</Button>}
        {canEdit && (
          <Button disabled={busy || dirty} title={dirty ? "Save first: the preview shows the saved draft" : undefined} onClick={() => void run(async () => { const r = await landingApi.preview(id); setPreview(r.preview); })}>
            <Eye className="w-3.5 h-3.5" /> Private preview link
          </Button>
        )}
        {canEdit && !page.pendingApproval && page.status !== "ARCHIVED" && (
          <Button disabled={busy || dirty || !page.canPublishNow || (!!page.live && !page.hasUnpublishedChanges)} title={!page.canPublishNow ? "Fix the items in the publish checklist first" : undefined} onClick={() => void run(async () => landingApi.submitForApproval(id), "Sent for approval")}>
            <Send className="w-3.5 h-3.5" /> {page.live ? "Send update for approval" : "Submit for approval"}
          </Button>
        )}
        {canEdit && page.pendingApproval && <Button disabled={busy} onClick={() => void run(async () => landingApi.withdraw(id), "Request withdrawn")}><Undo2 className="w-3.5 h-3.5" /> Withdraw request</Button>}
        {canPublish && page.live && <Button variant="danger" disabled={busy} onClick={() => setConfirm("unpublish")}><EyeOff className="w-3.5 h-3.5" /> Unpublish</Button>}
        {canEdit && page.status !== "ARCHIVED" && <Button disabled={busy || (!!page.live && !canPublish)} onClick={() => setConfirm("archive")}><Archive className="w-3.5 h-3.5" /> Archive</Button>}
        {canEdit && page.status === "ARCHIVED" && <Button disabled={busy} onClick={() => void run(async () => landingApi.unarchive(id), "Restored to draft")}>Restore from archive</Button>}
        {page.pendingApproval && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Waiting in the Approvals center. Publishing needs an admin.</span>}
      </Card>

      {preview && (
        <Card className="p-3 text-xs space-y-1" role="status">
          <p style={{ color: "var(--text-primary)" }}>Private preview of the saved draft (exact public rendering, not indexed). Anyone with this link can view it until {new Date(preview.expiresAt).toLocaleString()}. It is shown only once.</p>
          <div className="flex gap-2 items-center">
            <Input readOnly aria-label="Preview link" value={preview.url ?? preview.path} onFocus={(e) => e.currentTarget.select()} />
            {preview.url && <a className="underline whitespace-nowrap" style={{ color: "var(--accent)" }} href={preview.url} target="_blank" rel="noreferrer">Open</a>}
            <Button onClick={() => void run(async () => { await landingApi.revokePreviews(id); setPreview(null); }, "Preview links revoked")}>Revoke all</Button>
          </div>
          {!preview.url && <p style={{ color: "var(--text-muted)" }}>PUBLIC_SITE_BASE_URL is not set on the server, so only the path can be shown. Open it on the public site.</p>}
        </Card>
      )}

      <Card className="p-3 space-y-1" aria-label="Publish checklist">
        <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>Publish checklist</p>
        {issues.length === 0 ? (
          <p className="text-xs flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> Ready to send for approval.</p>
        ) : (
          <ul className="space-y-1">
            {issues.map((i, n) => (
              <li key={n} className="text-xs flex items-start gap-1" style={{ color: "var(--text-secondary)" }}>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-px" />
                {i.blockId ? <button type="button" className="text-left underline" onClick={() => { setTab("content"); setOpenBlock(i.blockId!); }}>{i.message}</button> : i.message}
              </li>
            ))}
          </ul>
        )}
        {dirty && <p className="text-xs text-amber-600">You have unsaved changes; the checklist reflects the last saved version.</p>}
      </Card>

      <div role="tablist" className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {(["content", "settings", "versions", "performance"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="px-3 py-2 text-xs font-semibold capitalize border-b-2" style={{ borderColor: tab === t ? "var(--accent)" : "transparent", color: tab === t ? "var(--accent)" : "var(--text-secondary)" }}>{t}</button>
        ))}
      </div>

      {tab === "content" && (
        <div className="space-y-3">
          {blocks.map((b, i) => {
            const spec = SPEC_BY_TYPE[b.type];
            const open = openBlock === b.id;
            if (!spec) return null;
            return (
              <Card key={b.id} className="p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <button type="button" className="flex-1 text-left text-sm font-bold" aria-expanded={open} onClick={() => setOpenBlock(open ? null : b.id)} style={{ color: "var(--text-primary)" }}>
                    {i + 1}. {spec.label}
                    {b.placeholder && <span className="ml-2"><Badge tone="warning">Placeholder content</Badge></span>}
                  </button>
                  {!locked && (
                    <>
                      <Button variant="ghost" aria-label={`Move ${spec.label} up`} disabled={i === 0 || b.type === "lp_hero"} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" aria-label={`Move ${spec.label} down`} disabled={i === blocks.length - 1 || b.type === "lp_footer"} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></Button>
                      {b.type !== "lp_hero" && <Button variant="ghost" aria-label={`Delete ${spec.label}`} onClick={() => mutate((x) => x.filter((y) => y.id !== b.id))}><Trash2 className="w-3.5 h-3.5" /></Button>}
                    </>
                  )}
                </div>
                {open && (
                  <fieldset disabled={locked} className="space-y-3">
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{spec.description} Text is plain text; HTML is never rendered.</p>
                    {b.placeholder && (
                      <div className="rounded-lg border p-2 text-xs space-y-2" style={{ borderColor: "var(--border)" }}>
                        <p>This block holds example wording in [[Replace: …]] brackets. Replace it with real content, then confirm. Publishing stays blocked until you do.</p>
                        <Button type="button" onClick={() => mutate((x) => x.map((y) => (y.id === b.id ? { ...y, placeholder: false } : y)))}>I replaced the placeholder content</Button>
                      </div>
                    )}
                    <LandingBlockEditor fields={spec.fields} props={b.props} blockId={b.id} onChange={(props) => mutate((x) => x.map((y) => (y.id === b.id ? { ...y, props } : y)))} />
                  </fieldset>
                )}
              </Card>
            );
          })}
          {!locked && available.length > 0 && (
            <Card className="p-3">
              <p className="text-xs font-bold mb-2" style={{ color: "var(--text-primary)" }}>Add a block</p>
              <div className="flex flex-wrap gap-2">
                {available.map((s) => <Button key={s.type} type="button" onClick={() => addBlock(s.type)} title={s.description}><Plus className="w-3.5 h-3.5" /> {s.label}</Button>)}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "settings" && (
        <Card className="p-4 space-y-3">
          <fieldset disabled={locked} className="space-y-3">
            <Field label="Page title (internal name and default browser title)"><Input value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></Field>
            <Field label="Address" hint={page.live ? "Changing the address of a live page needs publish permission and leaves a redirect from the old address." : "Lowercase letters, numbers and single hyphens."}>
              <div className="flex items-center gap-1"><span className="text-sm" style={{ color: "var(--text-muted)" }}>/lp/</span><Input value={slug} onChange={(e) => { setSlug(e.target.value.toLowerCase()); setDirty(true); }} /></div>
            </Field>
            <Field label="SEO title (optional, max 70)"><Input value={seo.metaTitle} maxLength={70} onChange={(e) => { setSeo({ ...seo, metaTitle: e.target.value }); setDirty(true); }} /></Field>
            <Field label="Meta description (required to publish)"><TextArea value={seo.metaDescription} maxLength={320} onChange={(e) => { setSeo({ ...seo, metaDescription: e.target.value }); setDirty(true); }} /></Field>
            <div className="space-y-1">
              <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>Social share image</span>
              <div className="flex gap-2 items-center">
                <Button type="button" onClick={() => setOgPicker(true)}>{seo.ogImageMediaId ? "Replace image" : "Choose from Media library"}</Button>
                {seo.ogImageMediaId && <Button type="button" variant="ghost" onClick={() => { setSeo({ ...seo, ogImageMediaId: null }); setDirty(true); }}>Remove</Button>}
              </div>
              <MediaPickerModal open={ogPicker} onClose={() => setOgPicker(false)} onSelect={(m) => { setSeo({ ...seo, ogImageMediaId: m.id }); setDirty(true); setOgPicker(false); }} />
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={seo.noindex} onChange={(e) => { setSeo({ ...seo, noindex: e.target.checked }); setDirty(true); }} /> Ask search engines not to index this page (also keeps it out of the sitemap)
            </label>
          </fieldset>
        </Card>
      )}

      {tab === "versions" && (
        <Card className="p-4 space-y-2">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Restoring creates a new draft from an earlier version. It goes live only after approval.</p>
          {!revisions ? <LoadingState /> : revisions.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-xs border-b py-2" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
              <History className="w-3.5 h-3.5" />
              <span className="font-bold" style={{ color: "var(--text-primary)" }}>Version {r.version}</span>
              <span>{new Date(r.createdAt).toLocaleString()}</span>
              <span>{r.createdBy ?? "—"}</span>
              <span>{r.blocks} blocks</span>
              {r.isLive && <Badge tone="success">Live</Badge>}
              {r.isCurrent && <Badge tone="info">Current draft</Badge>}
              {canEdit && !locked && !r.isCurrent && <Button className="ml-auto" disabled={busy || dirty} onClick={() => void run(async () => landingApi.restore(id, r.id), `Version ${r.version} restored as a new draft`)}>Restore</Button>}
            </div>
          ))}
        </Card>
      )}

      {tab === "performance" && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="lp-days" style={{ color: "var(--text-secondary)" }}>Period</label>
            <select id="lp-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-2 py-1 rounded-lg" style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
              {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
          </div>
          {!stats ? <LoadingState /> : !stats.hasData ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>No visits or form submissions recorded for this page in the selected period. {page.status !== "PUBLISHED" ? "The page is not live." : "Numbers appear after the first visit."}</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[["Page views", String(stats.views)], ["Unique sessions", String(stats.uniqueSessions)], ["Form submissions", String(stats.submissions)], ["Conversion rate", stats.conversionRate === null ? "n/a" : `${stats.conversionRate}%`]].map(([k, v]) => (
                  <div key={k} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}><dt className="text-[11px]" style={{ color: "var(--text-muted)" }}>{k}</dt><dd className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{v}</dd></div>
                ))}
              </dl>
              {stats.topSources.length > 0 && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Top sources: {stats.topSources.map((s) => `${s.source} (${s.views})`).join(", ")}</p>}
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{stats.note}</p>
            </>
          )}
        </Card>
      )}

      <ConfirmDialog open={confirm === "unpublish"} title="Unpublish this page?" message="The public address will stop working at once (visitors and search engines get a 'gone' response) and the page leaves the sitemap. Your draft is kept; going live again needs approval." confirmLabel="Unpublish" destructive onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void run(async () => landingApi.unpublish(id), "Unpublished"); }} />
      <ConfirmDialog open={confirm === "archive"} title="Archive this page?" message={page.live ? "This page is live. Archiving takes it offline (the address then answers 'gone')." : "The page moves to the archive. You can restore it later."} confirmLabel="Archive" destructive={!!page.live} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void run(async () => landingApi.archive(id), "Archived"); }} />
    </div>
  );
};
