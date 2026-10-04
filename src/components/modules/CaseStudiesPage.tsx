/**
 * Phase 11 — Case Studies: searchable/filterable/paginated list +
 * master-detail editor with workflow actions, revision history/revert,
 * and real content relationships (Product/Service/Solution, related
 * Pages, related Posts). Mirrors PagesPage.tsx/PostsPage.tsx's own
 * structure exactly — same list/detail/modal shape, same Trash +
 * bulk-action convention — with the addition of the relationship pickers
 * and the structured challenge/solution/implementation/results/
 * testimonial/technologies/CTA fields unique to a Case Study.
 */
import React, { useEffect, useState } from "react";
import {
  Briefcase,
  Plus,
  Search,
  Send,
  Rocket,
  CalendarClock,
  Archive,
  History,
  RotateCcw,
  Image as ImageIcon,
  X,
  Wand2,
  Trash2,
  Undo2,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import {
  caseStudiesApi,
  mediaApi,
  productsApi,
  pagesApi,
  postsApi,
  formsApi,
  industriesApi,
  type CmsCaseStudy,
  type CmsMedia,
  type ContentRevision,
  type ContentStatusValue,
  type CaseStudyContent,
  type CatalogProduct,
  type CmsPage,
  type CmsPost,
  type MarketingForm,
  type Industry,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";
import { MediaPickerModal } from "../common/MediaPickerModal";
import { RichTextEditor } from "../common/RichTextEditor";
import { SeoFieldsPanel, EMPTY_SEO_FIELDS, seoFieldsFromMetadata, seoFieldsToMetadata, type SeoFieldsValue } from "../common/SeoFieldsPanel";

const STATUS_OPTIONS: ContentStatusValue[] = ["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"];
const STATUS_TONE: Record<ContentStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  SCHEDULED: "warning",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

const FeaturedImageField: React.FC<{ mediaId: string | undefined; onChange: (mediaId: string | undefined) => void }> = ({ mediaId, onChange }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!mediaId) {
      setPreview(null);
      return;
    }
    void mediaApi.get(mediaId).then((res) => {
      if (cancelled) return;
      void mediaApi.getReadUrl(mediaId).then((urlRes) => {
        if (!cancelled) setPreview({ url: urlRes.url, label: res.media.displayName ?? res.media.originalFilename });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  return (
    <Field label="Featured image">
      <div className="flex items-center gap-3">
        {preview ? (
          <div className="w-16 h-16 rounded-lg overflow-hidden border shrink-0" style={{ borderColor: "var(--border)" }}>
            <img src={preview.url} alt={preview.label} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-16 h-16 rounded-lg border flex items-center justify-center shrink-0" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            <ImageIcon className="w-5 h-5" />
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
            {mediaId ? "Change" : "Choose image"}
          </Button>
          {mediaId && (
            <Button type="button" variant="ghost" onClick={() => onChange(undefined)} aria-label="Remove featured image">
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      <MediaPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(m: CmsMedia) => { onChange(m.id); setPickerOpen(false); }} />
    </Field>
  );
};

/** Multiple images (case study gallery) — same picker, append-only list with per-item remove. */
const GalleryField: React.FC<{ mediaIds: string[]; onChange: (mediaIds: string[]) => void }> = ({ mediaIds, onChange }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previews, setPreviews] = useState<Record<string, { url: string; label: string }>>({});

  useEffect(() => {
    mediaIds.forEach((id) => {
      if (previews[id]) return;
      void mediaApi.get(id).then((res) => {
        void mediaApi.getReadUrl(id).then((urlRes) => {
          setPreviews((prev) => ({ ...prev, [id]: { url: urlRes.url, label: res.media.displayName ?? res.media.originalFilename } }));
        });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaIds]);

  return (
    <Field label="Gallery" hint="Supporting screenshots/diagrams shown on the public case study.">
      <div className="flex flex-wrap gap-2 mb-2">
        {mediaIds.map((id) => (
          <div key={id} className="relative w-16 h-16 rounded-lg overflow-hidden border shrink-0 group" style={{ borderColor: "var(--border)" }}>
            {previews[id] ? (
              <img src={previews[id]!.url} alt={previews[id]!.label} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
                <ImageIcon className="w-4 h-4" />
              </div>
            )}
            <button
              type="button"
              onClick={() => onChange(mediaIds.filter((m) => m !== id))}
              aria-label="Remove from gallery"
              className="absolute top-0.5 right-0.5 rounded-full bg-black/60 text-white p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
        <Plus className="w-3.5 h-3.5" /> Add image
      </Button>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m: CmsMedia) => {
          if (!mediaIds.includes(m.id)) onChange([...mediaIds, m.id]);
          setPickerOpen(false);
        }}
      />
    </Field>
  );
};

/** Generic checkbox multi-select for the relationship pickers (Products/Pages/Posts) — deliberately simple: the catalogs here are small enough that search-as-you-filter isn't needed yet. */
const MultiSelectList: React.FC<{ label: string; hint?: string; options: { id: string; label: string; sublabel?: string }[]; selected: string[]; onChange: (ids: string[]) => void }> = ({
  label,
  hint,
  options,
  selected,
  onChange,
}) => (
  <Field label={label} hint={hint}>
    {options.length === 0 ? (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Nothing available yet.
      </p>
    ) : (
      <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1" style={{ borderColor: "var(--border)" }}>
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={() => onChange(selected.includes(o.id) ? selected.filter((id) => id !== o.id) : [...selected, o.id])}
            />
            <span className="truncate">
              {o.label}
              {o.sublabel && <span style={{ color: "var(--text-muted)" }}> · {o.sublabel}</span>}
            </span>
          </label>
        ))}
      </div>
    )}
  </Field>
);

interface RelationshipOptions {
  products: CatalogProduct[];
  pages: CmsPage[];
  posts: CmsPost[];
  forms: MarketingForm[];
  industries: Industry[];
}

const CaseStudyFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (caseStudy?: CmsCaseStudy) => void;
  mode: "create" | "edit";
  caseStudy?: CmsCaseStudy;
  options: RelationshipOptions;
}> = ({ open, onClose, onSaved, mode, caseStudy, options }) => {
  const [title, setTitle] = useState(caseStudy?.title ?? "");
  const [slug, setSlug] = useState(caseStudy?.slug ?? "");
  const [clientName, setClientName] = useState(caseStudy?.clientName ?? "");
  const [industryId, setIndustryId] = useState(caseStudy?.industryId ?? "");
  const [excerpt, setExcerpt] = useState(caseStudy?.currentRevision?.excerpt ?? "");
  const [body, setBody] = useState(caseStudy?.currentRevision?.body ?? "");
  const [featuredMediaId, setFeaturedMediaId] = useState<string | undefined>(caseStudy?.featuredMediaId ?? undefined);
  const [challenge, setChallenge] = useState("");
  const [solutionApproach, setSolutionApproach] = useState("");
  const [implementation, setImplementation] = useState("");
  const [results, setResults] = useState("");
  const [testimonialQuote, setTestimonialQuote] = useState("");
  const [testimonialAuthorName, setTestimonialAuthorName] = useState("");
  const [testimonialAuthorTitle, setTestimonialAuthorTitle] = useState("");
  const [technologiesText, setTechnologiesText] = useState("");
  const [galleryMediaIds, setGalleryMediaIds] = useState<string[]>([]);
  const [ctaFormId, setCtaFormId] = useState("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [relatedPageIds, setRelatedPageIds] = useState<string[]>([]);
  const [relatedPostIds, setRelatedPostIds] = useState<string[]>([]);
  const [seo, setSeo] = useState<SeoFieldsValue>(EMPTY_SEO_FIELDS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const content = (caseStudy?.currentRevision?.metadata ?? {}) as CaseStudyContent;
    setTitle(caseStudy?.title ?? "");
    setSlug(caseStudy?.slug ?? "");
    setClientName(caseStudy?.clientName ?? "");
    setIndustryId(caseStudy?.industryId ?? "");
    setExcerpt(caseStudy?.currentRevision?.excerpt ?? "");
    setBody(caseStudy?.currentRevision?.body ?? "");
    setFeaturedMediaId(caseStudy?.featuredMediaId ?? undefined);
    setChallenge(content.challenge ?? "");
    setSolutionApproach(content.solutionApproach ?? "");
    setImplementation(content.implementation ?? "");
    setResults(content.results ?? "");
    setTestimonialQuote(content.testimonialQuote ?? "");
    setTestimonialAuthorName(content.testimonialAuthorName ?? "");
    setTestimonialAuthorTitle(content.testimonialAuthorTitle ?? "");
    setTechnologiesText((content.technologies ?? []).join(", "));
    setGalleryMediaIds(content.galleryMediaIds ?? []);
    setCtaFormId(content.ctaFormId ?? "");
    setProductIds(caseStudy?.products.map((p) => p.productId) ?? []);
    setRelatedPageIds(caseStudy?.relatedPages.map((p) => p.pageId) ?? []);
    setRelatedPostIds(caseStudy?.relatedPosts.map((p) => p.postId) ?? []);
    setSeo(caseStudy ? seoFieldsFromMetadata(content) : EMPTY_SEO_FIELDS);
    setError(null);
  }, [open, caseStudy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const technologies = technologiesText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const content: CaseStudyContent = {
      ...seoFieldsToMetadata(seo),
      challenge: challenge.trim() || undefined,
      solutionApproach: solutionApproach.trim() || undefined,
      implementation: implementation.trim() || undefined,
      results: results.trim() || undefined,
      testimonialQuote: testimonialQuote.trim() || undefined,
      testimonialAuthorName: testimonialAuthorName.trim() || undefined,
      testimonialAuthorTitle: testimonialAuthorTitle.trim() || undefined,
      technologies: technologies.length > 0 ? technologies : undefined,
      galleryMediaIds: galleryMediaIds.length > 0 ? galleryMediaIds : undefined,
      ctaFormId: ctaFormId || undefined,
    };
    try {
      if (mode === "create") {
        const res = await caseStudiesApi.create({
          title,
          slug: slug || undefined,
          excerpt: excerpt.trim() || undefined,
          body,
          content,
          clientName: clientName.trim() || undefined,
          industryId: industryId || undefined,
          featuredMediaId,
          productIds,
          relatedPageIds,
          relatedPostIds,
        });
        onSaved(res.caseStudy);
      } else if (caseStudy) {
        const res = await caseStudiesApi.update(caseStudy.id, {
          title,
          slug,
          excerpt: excerpt.trim() || null,
          body,
          content,
          clientName: clientName.trim() || null,
          industryId: industryId || null,
          featuredMediaId: featuredMediaId ?? null,
          productIds,
          relatedPageIds,
          relatedPostIds,
          expectedUpdatedAt: caseStudy.updatedAt,
        });
        onSaved(res.caseStudy);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save case study.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New case study" : `Edit ${caseStudy?.title}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Slug" hint="Leave blank to auto-generate from the title.">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client / company">
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Acme Corp" />
          </Field>
          <Field label="Industry">
            <Select value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
              <option value="">— None —</option>
              {options.industries.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Excerpt" hint="A short summary for list views and archive cards.">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={2}
            maxLength={500}
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </Field>
        <FeaturedImageField mediaId={featuredMediaId} onChange={setFeaturedMediaId} />
        <Field label="Body">
          <RichTextEditor value={body} onChange={setBody} placeholder="Write the case study…" />
        </Field>

        <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Case study details
          </p>
          <Field label="Challenge">
            <textarea className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }} rows={3} maxLength={5000} value={challenge} onChange={(e) => setChallenge(e.target.value)} />
          </Field>
          <Field label="Solution">
            <textarea className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }} rows={3} maxLength={5000} value={solutionApproach} onChange={(e) => setSolutionApproach(e.target.value)} />
          </Field>
          <Field label="Implementation">
            <textarea className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }} rows={3} maxLength={5000} value={implementation} onChange={(e) => setImplementation(e.target.value)} />
          </Field>
          <Field label="Results">
            <textarea className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }} rows={3} maxLength={5000} value={results} onChange={(e) => setResults(e.target.value)} />
          </Field>
          <Field label="Technologies / products used" hint="Comma-separated free-text tags (e.g. names of internal tools) — separate from the Product/Service/Solution picker below.">
            <Input value={technologiesText} onChange={(e) => setTechnologiesText(e.target.value)} placeholder="React, PostgreSQL, Kubernetes" />
          </Field>
          <GalleryField mediaIds={galleryMediaIds} onChange={setGalleryMediaIds} />
        </div>

        <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Testimonial
          </p>
          <Field label="Quote">
            <textarea className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none" style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }} rows={2} maxLength={2000} value={testimonialQuote} onChange={(e) => setTestimonialQuote(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Author name">
              <Input value={testimonialAuthorName} onChange={(e) => setTestimonialAuthorName(e.target.value)} />
            </Field>
            <Field label="Author title">
              <Input value={testimonialAuthorTitle} onChange={(e) => setTestimonialAuthorTitle(e.target.value)} placeholder="VP Engineering, Acme Corp" />
            </Field>
          </div>
        </div>

        <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Content relationships
          </p>
          <MultiSelectList
            label="Products / Services / Solutions"
            options={options.products.map((p) => ({ id: p.id, label: p.name, sublabel: p.type }))}
            selected={productIds}
            onChange={setProductIds}
          />
          <MultiSelectList label="Related pages" options={options.pages.map((p) => ({ id: p.id, label: p.title, sublabel: p.status }))} selected={relatedPageIds} onChange={setRelatedPageIds} />
          <MultiSelectList label="Related posts" options={options.posts.map((p) => ({ id: p.id, label: p.title, sublabel: p.status }))} selected={relatedPostIds} onChange={setRelatedPostIds} />
          <Field label="CTA form" hint="Shown at the end of the public case study. Leave unset for no form.">
            <Select value={ctaFormId} onChange={(e) => setCtaFormId(e.target.value)}>
              <option value="">— None —</option>
              {options.forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            SEO
          </p>
          <SeoFieldsPanel value={seo} onChange={setSeo} fallbackTitle={title || "(untitled case study)"} fallbackDescription={excerpt} previewPath={`/case-studies/${slug || "your-case-study-slug"}`} />
        </div>

        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create case study" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ScheduleModal: React.FC<{ open: boolean; onClose: () => void; onSchedule: (scheduledAt: string) => void }> = ({ open, onClose, onSchedule }) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open) setValue("");
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Schedule publish">
      <div className="space-y-3">
        <Field label="Publish at">
          <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!value} onClick={() => value && onSchedule(new Date(value).toISOString())}>
            Schedule
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const CaseStudyDetail: React.FC<{ caseStudy: CmsCaseStudy; options: RelationshipOptions; onChanged: (c?: CmsCaseStudy) => void }> = ({ caseStudy, options, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const canUpdate = hasPermission(user?.role.permissions, "content.update");
  const canPublish = hasPermission(user?.role.permissions, "content.publish");
  const canDelete = hasPermission(user?.role.permissions, "content.delete");

  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRevisions = async () => {
    setRevisionsLoading(true);
    try {
      const res = await caseStudiesApi.revisions(caseStudy.id);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const run = async (action: () => Promise<{ caseStudy: CmsCaseStudy }>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await action();
      notify(successMsg, "success");
      onChanged(res.caseStudy);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreToDraft = () => run(() => caseStudiesApi.update(caseStudy.id, { status: "DRAFT" }), "Case study restored to draft.");
  const handleSubmitReview = () => run(() => caseStudiesApi.submitForReview(caseStudy.id), "Submitted for review.");
  const handlePublish = () => run(() => caseStudiesApi.publish(caseStudy.id), "Case study published.");
  const handleArchive = async () => {
    setArchiveOpen(false);
    await run(() => caseStudiesApi.archive(caseStudy.id), "Case study archived.");
  };
  const handleSchedule = async (scheduledAt: string) => {
    setScheduleOpen(false);
    await run(() => caseStudiesApi.schedule(caseStudy.id, scheduledAt), "Case study scheduled.");
  };
  const handleRevert = async (revisionId: string) => {
    await run(() => caseStudiesApi.revert(caseStudy.id, revisionId), "Reverted to prior revision.");
    void loadRevisions();
  };

  const linkedProducts = caseStudy.products.map((p) => options.products.find((o) => o.id === p.productId)).filter((p): p is CatalogProduct => !!p);
  const linkedPages = caseStudy.relatedPages.map((p) => options.pages.find((o) => o.id === p.pageId)).filter((p): p is CmsPage => !!p);
  const linkedPosts = caseStudy.relatedPosts.map((p) => options.posts.find((o) => o.id === p.postId)).filter((p): p is CmsPost => !!p);

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {caseStudy.title}
            <Badge tone={STATUS_TONE[caseStudy.status]}>{caseStudy.status}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            /case-studies/{caseStudy.slug} · v{caseStudy.currentRevision?.version ?? "—"}
            {caseStudy.clientName && <> · client: {caseStudy.clientName}</>}
            {caseStudy.industry && <> · industry: {caseStudy.industry.name}</>}
            {caseStudy.scheduledAt && caseStudy.status === "SCHEDULED" && <> · scheduled for {new Date(caseStudy.scheduledAt).toLocaleString()}</>}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end shrink-0">
          <Button
            variant="ghost"
            onClick={() => {
              setRevisionsOpen(true);
              void loadRevisions();
            }}
          >
            <History className="w-3.5 h-3.5" /> Revisions
          </Button>
          {canUpdate && caseStudy.status !== "ARCHIVED" && (
            <Button variant="secondary" onClick={() => navigate(`/website/site-editor?caseStudyId=${caseStudy.id}`)} disabled={busy}>
              <Wand2 className="w-3.5 h-3.5" /> Open Site Editor
            </Button>
          )}
          {canUpdate && (caseStudy.status === "DRAFT" || caseStudy.status === "IN_REVIEW" || caseStudy.status === "SCHEDULED") && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={busy}>
              Edit
            </Button>
          )}
          {canUpdate && caseStudy.status === "DRAFT" && (
            <Button variant="secondary" onClick={() => void handleSubmitReview()} disabled={busy}>
              <Send className="w-3.5 h-3.5" /> Submit for review
            </Button>
          )}
          {canPublish && caseStudy.status !== "PUBLISHED" && caseStudy.status !== "ARCHIVED" && (
            <Button variant="primary" onClick={() => void handlePublish()} disabled={busy}>
              <Rocket className="w-3.5 h-3.5" /> Publish
            </Button>
          )}
          {canPublish && caseStudy.status !== "PUBLISHED" && caseStudy.status !== "ARCHIVED" && (
            <Button variant="secondary" onClick={() => setScheduleOpen(true)} disabled={busy}>
              <CalendarClock className="w-3.5 h-3.5" /> Schedule
            </Button>
          )}
          {canUpdate && (caseStudy.status === "PUBLISHED" || caseStudy.status === "SCHEDULED" || caseStudy.status === "IN_REVIEW") && (
            <Button variant="secondary" onClick={() => void handleRestoreToDraft()} disabled={busy}>
              Move to draft
            </Button>
          )}
          {canUpdate && caseStudy.status === "ARCHIVED" && (
            <Button variant="secondary" onClick={() => void handleRestoreToDraft()} disabled={busy}>
              Restore
            </Button>
          )}
          {canDelete && caseStudy.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)} disabled={busy}>
              <Archive className="w-3.5 h-3.5" /> Archive
            </Button>
          )}
        </div>
      </div>

      {caseStudy.currentRevision?.body ? (
        <div className="p-4 cms-rendered-body" dangerouslySetInnerHTML={{ __html: caseStudy.currentRevision.body }} />
      ) : (
        <div className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No body content yet.
        </div>
      )}

      {(linkedProducts.length > 0 || linkedPages.length > 0 || linkedPosts.length > 0) && (
        <div className="px-4 py-3 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Content relationships
          </p>
          {linkedProducts.length > 0 && (
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              Products/Services/Solutions: {linkedProducts.map((p) => p.name).join(", ")}
            </p>
          )}
          {linkedPages.length > 0 && (
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              Related pages: {linkedPages.map((p) => p.title).join(", ")}
            </p>
          )}
          {linkedPosts.length > 0 && (
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              Related posts: {linkedPosts.map((p) => p.title).join(", ")}
            </p>
          )}
        </div>
      )}

      <CaseStudyFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={(updated) => onChanged(updated)} mode="edit" caseStudy={caseStudy} options={options} />
      <ScheduleModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} onSchedule={handleSchedule} />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive case study"
        message={`Archive "${caseStudy.title}"? It will be hidden from active use but preserved for history. Restore it later to edit again.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
      <Modal open={revisionsOpen} onClose={() => setRevisionsOpen(false)} title="Revision history">
        {revisionsLoading ? (
          <LoadingState />
        ) : revisions.length === 0 ? (
          <EmptyState title="No revisions yet" description="" />
        ) : (
          <ul className="space-y-2">
            {revisions.map((r) => (
              <li key={r.id} className="p-2.5 rounded-lg border text-xs flex items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                    v{r.version} <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                {canUpdate && r.id !== caseStudy.currentRevisionId && (
                  <Button variant="secondary" onClick={() => void handleRevert(r.id)} disabled={busy || caseStudy.status === "ARCHIVED"}>
                    <RotateCcw className="w-3.5 h-3.5" /> Revert to this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </Card>
  );
};

export const CaseStudiesPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "content.create");

  const [pageNum, setPageNum] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState<ContentStatusValue | "">("");
  const [caseStudies, setCaseStudies] = useState<CmsCaseStudy[]>([]);
  const [selected, setSelected] = useState<CmsCaseStudy | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [options, setOptions] = useState<RelationshipOptions>({ products: [], pages: [], posts: [], forms: [], industries: [] });

  const [view, setView] = useState<"active" | "trash">("active");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<"archive" | "trash" | null>(null);
  const { notify } = useToast();
  const canDeleteBulk = hasPermission(user?.role.permissions, "content.delete");

  useEffect(() => {
    if (consumeNewFlag()) setCreateOpen(true);
  }, []);

  // Relationship picker options — fetched once, not paginated with the main list.
  useEffect(() => {
    void productsApi.list({ limit: 100 }).then((res) => setOptions((o) => ({ ...o, products: res.items }))).catch(() => undefined);
    void pagesApi.list({ limit: 100 }).then((res) => setOptions((o) => ({ ...o, pages: res.items }))).catch(() => undefined);
    void postsApi.list({ limit: 100 }).then((res) => setOptions((o) => ({ ...o, posts: res.items }))).catch(() => undefined);
    void formsApi.list({ limit: 100 }).then((res) => setOptions((o) => ({ ...o, forms: res.items }))).catch(() => undefined);
    void industriesApi.list().then((res) => setOptions((o) => ({ ...o, industries: res.industries }))).catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPageNum(1);
    setCheckedIds(new Set());
  }, [debouncedSearch, status, view]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res =
        view === "trash"
          ? await caseStudiesApi.trash({ page: pageNum, limit: 20 })
          : await caseStudiesApi.list({ page: pageNum, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setCaseStudies(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((c) => c.id === prev.id) ? res.items.find((c) => c.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load case studies.");
    } finally {
      setLoading(false);
    }
  }, [pageNum, debouncedSearch, status, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleChecked = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (action: "archive" | "trash" | "restore") => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkConfirm(null);
    try {
      const res =
        action === "archive" ? await caseStudiesApi.bulkArchive(ids) : action === "trash" ? await caseStudiesApi.bulkTrash(ids) : await caseStudiesApi.bulkRestore(ids);
      const verb = action === "archive" ? "archived" : action === "trash" ? "moved to trash" : "restored";
      if (res.failed.length === 0) {
        notify(`${res.succeeded.length} case study(ies) ${verb}.`, "success");
      } else {
        notify(`${res.succeeded.length} ${verb}, ${res.failed.length} failed: ${res.failed[0]!.error}`, "error");
      }
      setCheckedIds(new Set());
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Bulk action failed.", "error");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Briefcase className="w-5 h-5" /> Case Studies
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Real customer case studies, with real Product/Service/Solution and content relationships.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }}>
            <button
              onClick={() => setView("active")}
              className="px-3 py-1 rounded-md text-xs font-semibold"
              style={view === "active" ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
            >
              Active
            </button>
            <button
              onClick={() => setView("trash")}
              className="px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1"
              style={view === "trash" ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
            >
              <Trash2 className="w-3 h-3" /> Trash
            </button>
          </div>
          {canCreate && view === "active" && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> New case study
            </Button>
          )}
        </div>
      </div>

      {view === "active" && (
        <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
            <Input placeholder="Search case studies…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ContentStatusValue | "")}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Card>
      )}

      {canDeleteBulk && checkedIds.size > 0 && (
        <Card className="p-2.5 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            {checkedIds.size} selected
          </span>
          <div className="flex gap-2">
            {view === "active" ? (
              <>
                <Button variant="secondary" disabled={bulkBusy} onClick={() => setBulkConfirm("archive")}>
                  <Archive className="w-3.5 h-3.5" /> Archive selected
                </Button>
                <Button variant="danger" disabled={bulkBusy} onClick={() => setBulkConfirm("trash")}>
                  <Trash2 className="w-3.5 h-3.5" /> Trash selected
                </Button>
              </>
            ) : (
              <Button variant="secondary" disabled={bulkBusy} onClick={() => void runBulk("restore")}>
                <Undo2 className="w-3.5 h-3.5" /> Restore selected
              </Button>
            )}
          </div>
        </Card>
      )}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : caseStudies.length === 0 ? (
        <Card>
          <EmptyState title={view === "trash" ? "Trash is empty" : "No case studies found"} description={view === "trash" ? "" : "Create a case study or adjust your filters."} />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {caseStudies.map((c) => (
              <div key={c.id} className="flex items-center gap-1.5 mb-0.5">
                {canDeleteBulk && <input type="checkbox" aria-label={`Select ${c.title}`} checked={checkedIds.has(c.id)} onChange={() => toggleChecked(c.id)} className="shrink-0" />}
                <button
                  onClick={() => setSelected(c)}
                  className="flex-1 text-left px-2 py-2 rounded-lg text-xs font-semibold flex items-center justify-between gap-2"
                  style={selected?.id === c.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
                >
                  <span className="truncate">{c.title}</span>
                  {view === "active" && <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>}
                </button>
                {view === "trash" && (
                  <Button variant="ghost" onClick={() => void caseStudiesApi.restore(c.id).then(() => load())} aria-label={`Restore ${c.title}`}>
                    <Undo2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Pagination page={pageNum} totalPages={totalPages} onChange={setPageNum} />
          </Card>

          {view === "active" && selected && <CaseStudyDetail caseStudy={selected} options={options} onChanged={(updated) => (updated ? setSelected(updated) : void load())} />}
        </div>
      )}

      <CaseStudyFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" options={options} />

      <ConfirmDialog
        open={bulkConfirm !== null}
        title={bulkConfirm === "archive" ? "Archive selected case studies" : "Move selected case studies to trash"}
        message={
          bulkConfirm === "archive"
            ? `Archive ${checkedIds.size} case study(ies)? They'll be hidden from active use but preserved for history.`
            : `Move ${checkedIds.size} case study(ies) to trash? You can restore them later from the Trash tab.`
        }
        confirmLabel={bulkConfirm === "archive" ? "Archive" : "Trash"}
        destructive
        onConfirm={() => void runBulk(bulkConfirm === "archive" ? "archive" : "trash")}
        onCancel={() => setBulkConfirm(null)}
      />
    </div>
  );
};
