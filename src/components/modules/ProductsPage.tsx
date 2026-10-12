/**
 * Phase 7 §31-36 — Product catalog: searchable/filterable/paginated list +
 * master-detail with embedded module management.
 *
 * Phase 10 (Products + Services + Solutions) extends this same component
 * (not a second system) to also serve the "Services" and "Solutions" nav
 * entries: `lockedType` fixes the catalog `type` filter and hides the type
 * selector when this page is reached via /services or /solutions, exactly
 * the same technique /products/modules already uses for `focusModules`.
 * Adds: featured media, category, benefits/features/business problem/CTA
 * form content (revisioned — history + rollback), related products,
 * industries (SOLUTION), duplicate, and bulk archive.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Package,
  Plus,
  Search,
  Star,
  ArrowUp,
  ArrowDown,
  Archive,
  Image as ImageIcon,
  X,
  History,
  RotateCcw,
  Copy,
  CheckSquare,
  Square,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import {
  productsApi,
  productModulesApi,
  productCategoriesApi,
  industriesApi,
  formsApi,
  mediaApi,
  contentAiApi,
  type CatalogProduct,
  type ProductModule,
  type ProductTypeValue,
  type ProductStatusValue,
  type ProductCategory,
  type Industry,
  type ProductRevision,
  type ProductContentValue,
  type MarketingForm,
  type CmsMedia,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery } from "../../lib/deepLink";
import { MediaPickerModal } from "../common/MediaPickerModal";
import { AiWriterPanel, type AiWriterOptions } from "../common/AiWriterPanel";
import { createFeatureImage } from "../../lib/featureImage";
import { SeoFieldsPanel, EMPTY_SEO_FIELDS, seoFieldsFromMetadata, seoFieldsToMetadata } from "../common/SeoFieldsPanel";

const TYPE_OPTIONS: ProductTypeValue[] = ["PRODUCT", "SERVICE", "SOLUTION"];
const STATUS_OPTIONS: ProductStatusValue[] = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"];
const STATUS_TONE: Record<ProductStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  INACTIVE: "warning",
  ARCHIVED: "danger",
};
const MODULE_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  INACTIVE: "warning",
};
const TYPE_LABEL: Record<ProductTypeValue, string> = { PRODUCT: "Product", SERVICE: "Service", SOLUTION: "Solution" };

function StringListEditor({ label, hint, values, onChange }: { label: string; hint?: string; values: string[]; onChange: (next: string[]) => void }) {
  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={v}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <Button type="button" variant="ghost" onClick={() => onChange(values.filter((_, idx) => idx !== i))} aria-label={`Remove ${label} item`}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => onChange([...values, ""])}>
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>
    </Field>
  );
}

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
      <MediaPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(m: CmsMedia) => {
        onChange(m.id);
        setPickerOpen(false);
      }} />
    </Field>
  );
};

/** Full-page editor for a product, service or solution (replaces the old pop-up). `onClose` returns to the list. */
const ProductFormPage: React.FC<{
  onClose: () => void;
  onSaved: (product?: CatalogProduct) => void;
  mode: "create" | "edit";
  product?: CatalogProduct;
  lockedType?: ProductTypeValue;
  categories: ProductCategory[];
  industries: Industry[];
  forms: MarketingForm[];
  allProducts: CatalogProduct[];
}> = ({ onClose, onSaved, mode, product, lockedType, categories, industries, forms, allProducts }) => {
  const { notify } = useToast();
  const [code, setCode] = useState(product?.code ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [type, setType] = useState<ProductTypeValue>(lockedType ?? product?.type ?? "PRODUCT");
  const [shortDescription, setShortDescription] = useState(product?.shortDescription ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [status, setStatus] = useState<ProductStatusValue>(product?.status ?? "DRAFT");
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [featuredMediaId, setFeaturedMediaId] = useState<string | undefined>(product?.featuredMediaId ?? undefined);
  const [categoryId, setCategoryId] = useState<string>(product?.categoryId ?? "");
  const [benefits, setBenefits] = useState<string[]>(product?.currentRevision?.content.benefits ?? []);
  const [features, setFeatures] = useState<string[]>(product?.currentRevision?.content.features ?? []);
  const [businessProblem, setBusinessProblem] = useState(product?.currentRevision?.content.businessProblem ?? "");
  const [ctaFormId, setCtaFormId] = useState(product?.currentRevision?.content.ctaFormId ?? "");
  const [seo, setSeo] = useState(seoFieldsFromMetadata(product?.currentRevision?.content.seo ?? {}));
  const [relatedProductIds, setRelatedProductIds] = useState<string[]>([
    ...(product?.relatedFrom ?? []).map((r) => r.toProductId),
    ...(product?.relatedTo ?? []).map((r) => r.fromProductId),
  ]);
  const [industryIds, setIndustryIds] = useState<string[]>((product?.industries ?? []).map((i) => i.industryId));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);


  const content: ProductContentValue = {
    benefits: benefits.map((b) => b.trim()).filter(Boolean),
    features: features.map((f) => f.trim()).filter(Boolean),
    businessProblem: businessProblem.trim() || undefined,
    ctaFormId: ctaFormId || undefined,
    seo: seoFieldsToMetadata(seo),
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await productsApi.create({
          code,
          name,
          slug: slug || undefined,
          type,
          shortDescription,
          description,
          status,
          isFeatured,
          featuredMediaId,
          categoryId: categoryId || undefined,
          content,
          relatedProductIds,
          industryIds,
        });
        notify(`${TYPE_LABEL[type]} created.`, "success");
        onSaved(res.product);
      } else if (product) {
        const res = await productsApi.update(product.id, {
          name,
          slug,
          type,
          shortDescription,
          description,
          status,
          isFeatured,
          featuredMediaId: featuredMediaId ?? null,
          categoryId: categoryId || null,
          content,
          relatedProductIds,
          industryIds,
        });
        notify(`${TYPE_LABEL[type]} updated.`, "success");
        onSaved(res.product);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  };

  const writeWithAi = async (o: AiWriterOptions) => {
    const draft = await contentAiApi.writeProduct({ brief: o.brief, tone: o.tone, name: name || undefined, itemType: lockedType ?? type, productId: product?.id });
    const before = { code, name, slug, shortDescription, description, benefits, features, businessProblem, seo, featuredMediaId };
    if (o.applyIdentity) {
      if (draft.name) setName(draft.name);
      if (draft.slug) setSlug(draft.slug);
      if (draft.code && mode === "create") setCode(draft.code);
    }
    setShortDescription(draft.shortDescription);
    setDescription(draft.description);
    setBenefits(draft.benefits);
    setFeatures(draft.features);
    if (draft.businessProblem) setBusinessProblem(draft.businessProblem);
    setSeo((cur) => ({ ...cur, metaTitle: draft.seoTitle, metaDescription: draft.seoDescription, focusKeywords: draft.focusKeywords.join(", "), ogTitle: draft.ogTitle, ogDescription: draft.ogDescription }));
    if (o.applyImage) {
      try {
        const shownName = o.applyIdentity && draft.name ? draft.name : name || draft.name;
        const media = await createFeatureImage({
          title: shownName,
          headline: draft.imageHeadline || shownName,
          subtitle: draft.imageSubtitle || draft.shortDescription,
          label: draft.imageLabel || TYPE_LABEL[lockedType ?? type],
          tagline: draft.imageTagline || shownName,
          screenshots: o.screenshots,
        });
        setFeaturedMediaId(media.id);
      } catch {
        notify("The text was written, but the feature image could not be created. Add one with Choose image.", "error");
      }
    }
    return () => {
      setFeaturedMediaId(before.featuredMediaId);
      setCode(before.code);
      setName(before.name);
      setSlug(before.slug);
      setShortDescription(before.shortDescription);
      setDescription(before.description);
      setBenefits(before.benefits);
      setFeatures(before.features);
      setBusinessProblem(before.businessProblem);
      setSeo(before.seo);
    };
  };

  const typeLabel = TYPE_LABEL[lockedType ?? type];

  // Unsaved-changes guard: compare the editable state with what the form opened with.
  const snapshot = JSON.stringify({ code, name, slug, type, shortDescription, description, status, isFeatured, featuredMediaId, categoryId, benefits, features, businessProblem, ctaFormId, seo, relatedProductIds, industryIds });
  const initialSnapshot = useRef(snapshot);
  const dirty = snapshot !== initialSnapshot.current;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const requestClose = () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  };

  const textarea = "w-full px-3 py-2 rounded-lg text-sm focus:outline-none";
  const textareaStyle = { background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" } as const;
  const chip = (active: boolean) => (active ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" } : { color: "var(--text-secondary)", borderColor: "var(--border)" });
  const sectionTitle = (text: string) => (
    <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{text}</h2>
  );

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 flex items-center gap-2 sm:gap-3 border-b backdrop-blur" style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}>
        <Button type="button" variant="ghost" onClick={requestClose} aria-label={`Back to ${typeLabel.toLowerCase()} list`}>
          <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{mode === "create" ? "New" : "Edit"} {typeLabel.toLowerCase()}</p>
          <h1 className="text-sm sm:text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>{mode === "create" ? name || `New ${typeLabel.toLowerCase()}` : product?.name}</h1>
        </div>
        {dirty && <span className="hidden sm:inline text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>Unsaved changes</span>}
        <Button type="button" variant="secondary" onClick={requestClose}>Cancel</Button>
        <Button type="submit" form="product-form" variant="primary" disabled={submitting}>
          {submitting ? "Saving…" : mode === "create" ? `Create` : "Save"}
        </Button>
      </div>

      {error && <div role="alert" className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}

      <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <Card className="p-4 space-y-3">
            {sectionTitle("Identity")}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Code">
                <Input required disabled={mode === "edit"} value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Field label="Slug" hint="Leave blank to auto-generate from the name.">
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated" />
              </Field>
              {!lockedType && (
                <Field label="Type">
                  <Select className="w-full" value={type} onChange={(e) => setType(e.target.value as ProductTypeValue)}>
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </Card>

          <AiWriterPanel
            kind="product"
            onGenerate={writeWithAi}
            hasContent={!!(shortDescription || description || benefits.length || features.length)}
            initialBrief={mode === "edit" ? [product?.name, shortDescription, description].filter(Boolean).join(". ").slice(0, 3900) : ""}
            identity={{
              label: mode === "create" ? "Also set the name, code and URL slug" : "Also update the name and URL slug",
              hint: mode === "create" ? "Writes an SEO-friendly name, the next free code (e.g. CAS-001) and a unique slug." : "Changes the public link of an item that already exists. The code never changes.",
              defaultChecked: mode === "create",
            }}
            image={{
              label: featuredMediaId ? "Replace the feature image" : "Also design a feature image",
              hint: "Designs a banner (logo, headline, summary, device mockups) from the product and saves it to the Media Library.",
              defaultChecked: !featuredMediaId,
            }}
          />

          <Card className="p-4 space-y-3">
            {sectionTitle("Content")}
            <Field label="Short description">
              <Input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} maxLength={300} />
            </Field>
            <Field label="Description">
              <textarea className={textarea} style={textareaStyle} rows={8} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            {type === "SOLUTION" && (
              <Field label="Business problem" hint="The real-world problem this solution addresses.">
                <textarea className={textarea} style={textareaStyle} rows={3} value={businessProblem} onChange={(e) => setBusinessProblem(e.target.value)} />
              </Field>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StringListEditor label="Benefits" values={benefits} onChange={setBenefits} />
              <StringListEditor label="Features" values={features} onChange={setFeatures} />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            {sectionTitle("SEO and social sharing")}
            <SeoFieldsPanel
              value={seo}
              onChange={setSeo}
              fallbackTitle={name || "Untitled"}
              fallbackDescription={shortDescription || description || ""}
              previewPath={`/${slug || "slug"}`}
            />
          </Card>
        </div>

        <div className="space-y-4 min-w-0 lg:sticky lg:top-32">
          <Card className="p-4 space-y-3">
            {sectionTitle("Publishing")}
            <Field label="Status">
              <Select className="w-full" value={status} onChange={(e) => setStatus(e.target.value as ProductStatusValue)}>
                {STATUS_OPTIONS.filter((s) => s !== "ARCHIVED").map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
              Featured
            </label>
            <Field label="Category">
              <Select className="w-full" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Conversion form (CTA)" hint="A real Form from the Marketing section, shown as this item's call-to-action on the public site.">
              <Select className="w-full" value={ctaFormId} onChange={(e) => setCtaFormId(e.target.value)}>
                <option value="">No form</option>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </Field>
          </Card>

          <Card className="p-4">
            <FeaturedImageField mediaId={featuredMediaId} onChange={setFeaturedMediaId} />
          </Card>

          {type === "SOLUTION" && (
            <Card className="p-4 space-y-2">
              {sectionTitle("Industries")}
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Which industries this solution is built for.</p>
              <div className="flex flex-wrap gap-1.5">
                {industries.map((ind) => {
                  const active = industryIds.includes(ind.id);
                  return (
                    <button key={ind.id} type="button" aria-pressed={active} onClick={() => setIndustryIds(active ? industryIds.filter((id) => id !== ind.id) : [...industryIds, ind.id])} className="px-2.5 py-1 rounded-full text-[11px] font-semibold border transition" style={chip(active)}>
                      {ind.name}
                    </button>
                  );
                })}
                {industries.length === 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>No industries defined yet.</p>}
              </div>
            </Card>
          )}

          <Card className="p-4 space-y-2">
            {sectionTitle("Related items")}
            <div className="flex flex-wrap gap-1.5">
              {allProducts.filter((p) => p.id !== product?.id).slice(0, 60).map((p) => {
                const active = relatedProductIds.includes(p.id);
                return (
                  <button key={p.id} type="button" aria-pressed={active} onClick={() => setRelatedProductIds(active ? relatedProductIds.filter((id) => id !== p.id) : [...relatedProductIds, p.id])} className="px-2.5 py-1 rounded-full text-[11px] font-semibold border transition" style={chip(active)}>
                    {p.name}
                  </button>
                );
              })}
              {allProducts.filter((p) => p.id !== product?.id).length === 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nothing to relate to yet.</p>}
            </div>
          </Card>
        </div>
      </form>
    </div>
  );
};

const ModuleFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; productId: string }> = ({
  open,
  onClose,
  onSaved,
  productId,
}) => {
  const { notify } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isCore, setIsCore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCode("");
      setName("");
      setDescription("");
      setIsCore(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await productsApi.addModule(productId, { code, name, description, isCore });
      notify("Module added.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add module.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add module">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <Input required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={isCore} onChange={(e) => setIsCore(e.target.checked)} />
          Core module
        </label>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Add module
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ProductDetail: React.FC<{
  product: CatalogProduct;
  onChanged: (p?: CatalogProduct) => void;
  onEdit: (p: CatalogProduct) => void;
  focusModules?: boolean;
  lockedType?: ProductTypeValue;
  categories: ProductCategory[];
  industries: Industry[];
  forms: MarketingForm[];
  allProducts: CatalogProduct[];
}> = ({ product, onChanged, onEdit, focusModules, lockedType, categories, industries, forms, allProducts }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "products.update");
  const canCreate = hasPermission(user?.role.permissions, "products.create");
  const canArchive = hasPermission(user?.role.permissions, "products.archive");
  const canCreateModule = hasPermission(user?.role.permissions, "product_modules.create");
  const canUpdateModule = hasPermission(user?.role.permissions, "product_modules.update");
  const canArchiveModule = hasPermission(user?.role.permissions, "product_modules.archive");
  const canReorderModules = hasPermission(user?.role.permissions, "product_modules.reorder");

  const [modules, setModules] = useState<ProductModule[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<ProductRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const modulesSectionRef = useRef<HTMLDivElement>(null);
  const typeLabel = TYPE_LABEL[product.type];

  const loadModules = React.useCallback(async () => {
    setModulesLoading(true);
    try {
      const res = await productsApi.modules(product.id, { limit: 100 });
      setModules(res.items);
    } catch {
      setModules([]);
    } finally {
      setModulesLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  useEffect(() => {
    if (focusModules && !modulesLoading) {
      modulesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Only on product change / once loaded — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusModules, product.id, modulesLoading]);

  const handleToggleModuleStatus = async (module_: ProductModule) => {
    try {
      await productModulesApi.update(module_.id, { status: module_.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      notify(module_.status === "ACTIVE" ? "Module deactivated." : "Module activated.", "success");
      void loadModules();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update module.", "error");
    }
  };

  const handleArchiveModule = async (module_: ProductModule) => {
    try {
      await productModulesApi.archive(module_.id);
      notify("Module archived.", "success");
      void loadModules();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive module.", "error");
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= modules.length) return;
    const reordered = [...modules];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    setReordering(true);
    try {
      await productsApi.reorderModules(
        product.id,
        reordered.map((m) => m.id)
      );
      setModules(reordered);
      notify("Modules reordered.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not reorder modules.", "error");
      void loadModules();
    } finally {
      setReordering(false);
    }
  };

  const handleArchive = async () => {
    try {
      await productsApi.archive(product.id);
      notify(`${typeLabel} archived.`, "success");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive.", "error");
    } finally {
      setArchiveOpen(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      const res = await productsApi.duplicate(product.id);
      notify(`${typeLabel} duplicated.`, "success");
      onChanged(res.product);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not duplicate.", "error");
    }
  };

  const loadRevisions = async () => {
    setRevisionsOpen(true);
    setRevisionsLoading(true);
    try {
      const res = await productsApi.listRevisions(product.id);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const handleRevert = async (revisionId: string) => {
    try {
      const res = await productsApi.revert(product.id, revisionId);
      notify("Reverted to prior revision.", "success");
      onChanged(res.product);
      setRevisionsOpen(false);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not revert.", "error");
    }
  };

  const content = product.currentRevision?.content ?? {};
  const relatedIds = [...(product.relatedFrom ?? []).map((r) => r.toProduct), ...(product.relatedTo ?? []).map((r) => r.fromProduct)].filter(Boolean);

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {product.name}
            <Badge tone={STATUS_TONE[product.status]}>{product.status}</Badge>
            {product.isFeatured && (
              <Badge tone="info">
                <Star className="w-2.5 h-2.5 inline mr-0.5" /> Featured
              </Badge>
            )}
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {product.code} · {TYPE_LABEL[product.type]} · /{product.slug}
            {product.category && <> · {product.category.name}</>}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" onClick={() => void loadRevisions()}>
            <History className="w-3.5 h-3.5" /> Revisions
          </Button>
          {canCreate && (
            <Button variant="secondary" onClick={() => void handleDuplicate()}>
              <Copy className="w-3.5 h-3.5" /> Duplicate
            </Button>
          )}
          {canUpdate && (
            <Button variant="secondary" onClick={() => onEdit(product)}>
              Edit
            </Button>
          )}
          {canArchive && product.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)}>
              <Archive className="w-3.5 h-3.5" /> Archive
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-2 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        {product.shortDescription && <p style={{ color: "var(--text-primary)" }}>{product.shortDescription}</p>}
        {product.description && (
          <p style={{ color: "var(--text-secondary)" }} className="whitespace-pre-wrap">
            {product.description}
          </p>
        )}
        {!product.shortDescription && !product.description && <p style={{ color: "var(--text-muted)" }}>No description yet.</p>}

        {content.businessProblem && (
          <div className="pt-2">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Business problem
            </p>
            <p style={{ color: "var(--text-secondary)" }}>{content.businessProblem}</p>
          </div>
        )}
        {!!content.benefits?.length && (
          <div className="pt-2">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Benefits
            </p>
            <ul className="list-disc list-inside" style={{ color: "var(--text-secondary)" }}>
              {content.benefits.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        {!!content.features?.length && (
          <div className="pt-2">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Features
            </p>
            <ul className="list-disc list-inside" style={{ color: "var(--text-secondary)" }}>
              {content.features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {!!product.industries?.length && (
          <div className="pt-2 flex flex-wrap gap-1.5">
            {product.industries.map((pi) => (
              <Badge key={pi.industryId} tone="neutral">
                {pi.industry.name}
              </Badge>
            ))}
          </div>
        )}
        {relatedIds.length > 0 && (
          <div className="pt-2">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Related
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {relatedIds.map((r) => (
                <Badge key={r!.slug} tone="info">
                  {r!.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {content.ctaFormId && !forms.find((f) => f.id === content.ctaFormId) && (
          <p className="text-amber-500">This item's CTA form reference no longer resolves — pick a new one in Edit.</p>
        )}
      </div>

      <div ref={modulesSectionRef} className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Modules
        </h3>
        {canCreateModule && product.status !== "ARCHIVED" && (
          <Button variant="primary" onClick={() => setAddModuleOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add module
          </Button>
        )}
      </div>

      {modulesLoading ? (
        <LoadingState />
      ) : modules.length === 0 ? (
        <EmptyState title="No modules configured" description="Add a module for this item." />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {modules.map((m, index) => (
            <li key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                  {m.name}
                  {m.isCore && <Badge tone="info">Core</Badge>}
                  <Badge tone={MODULE_STATUS_TONE[m.status]}>{m.status}</Badge>
                </p>
                <p style={{ color: "var(--text-muted)" }}>{m.code}</p>
              </div>
              <div className="flex gap-1.5 shrink-0 items-center">
                {canReorderModules && (
                  <>
                    <Button variant="ghost" disabled={reordering || index === 0} onClick={() => void handleMove(index, -1)} aria-label="Move up">
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={reordering || index === modules.length - 1}
                      onClick={() => void handleMove(index, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
                {canUpdateModule && m.status !== "INACTIVE" && (
                  <Button variant="secondary" onClick={() => void handleToggleModuleStatus(m)}>
                    {m.status === "ACTIVE" ? "Deactivate" : "Activate"}
                  </Button>
                )}
                {canUpdateModule && m.status === "INACTIVE" && (
                  <Button variant="secondary" onClick={() => void handleToggleModuleStatus(m)}>
                    Activate
                  </Button>
                )}
                {canArchiveModule && m.status !== "INACTIVE" && (
                  <Button variant="danger" onClick={() => void handleArchiveModule(m)}>
                    Archive
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ModuleFormModal open={addModuleOpen} onClose={() => setAddModuleOpen(false)} onSaved={loadModules} productId={product.id} />
      <ConfirmDialog
        open={archiveOpen}
        title={`Archive ${typeLabel.toLowerCase()}`}
        message={`Archive "${product.name}"? It will be preserved for historical/future commercial references but hidden from active use.`}
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
              <li key={r.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border text-xs" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    Version {r.version}
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                {r.id !== product.currentRevisionId && (
                  <Button variant="secondary" onClick={() => void handleRevert(r.id)} disabled={product.status === "ARCHIVED"}>
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

export const ProductsPage: React.FC<{ lockedType?: ProductTypeValue }> = ({ lockedType: propLockedType }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { path } = useRouter();
  const isModulesView = path === "/products/modules";
  const routeLockedType: ProductTypeValue | undefined = path === "/services" ? "SERVICE" : path === "/solutions" ? "SOLUTION" : undefined;
  const lockedType = propLockedType ?? routeLockedType;
  const canCreate = hasPermission(user?.role.permissions, "products.create");
  const canArchive = hasPermission(user?.role.permissions, "products.archive");
  const pageLabel = lockedType === "SERVICE" ? "Services" : lockedType === "SOLUTION" ? "Solutions" : "Products";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [typeFilter, setTypeFilter] = useState<ProductTypeValue | "">("");
  const [status, setStatus] = useState<ProductStatusValue | "">("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: "create" } | { mode: "edit"; product: CatalogProduct } | null>(null);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [forms, setForms] = useState<MarketingForm[]>([]);
  const [allProducts, setAllProducts] = useState<CatalogProduct[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [debouncedSearch, typeFilter, status, categoryFilter, featuredOnly, lockedType]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await productsApi.list({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        type: lockedType ?? (typeFilter || undefined),
        status: status || undefined,
        isFeatured: featuredOnly || undefined,
        categoryId: categoryFilter || undefined,
      });
      setProducts(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((p) => p.id === prev.id) ? res.items.find((p) => p.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, typeFilter, status, categoryFilter, featuredOnly, lockedType]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Best-effort lookups for form fields (category/industry/related-item
    // pickers, CTA form select) — a failure here degrades those optional
    // pickers to empty, never breaks the catalog list/detail itself.
    void productCategoriesApi.list().then((res) => setCategories(res.categories)).catch(() => undefined);
    void industriesApi.list().then((res) => setIndustries(res.industries)).catch(() => undefined);
    void formsApi.list({ limit: 100, status: "ACTIVE" }).then((res) => setForms(res.items)).catch(() => undefined);
    void productsApi.list({ limit: 100 }).then((res) => setAllProducts(res.items)).catch(() => undefined);
  }, []);

  // Refresh the selectable "related items"/"forms" pools after a save that changed the catalog.
  // The editor is a full page, but its state lives in the URL (?form=new / ?form=edit&id=…) so reload and the browser Back button work.
  const syncFromUrl = React.useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get("form");
    if (f === "new") { setForm({ mode: "create" }); return; }
    if (f === "edit" && params.get("id")) {
      try {
        const res = await productsApi.get(params.get("id")!);
        setForm({ mode: "edit", product: res.product });
      } catch {
        setForm(null);
        notify("That item could not be opened.", "error");
      }
      return;
    }
    setForm(null);
  }, [notify]);
  useEffect(() => {
    void syncFromUrl();
    const onPop = () => void syncFromUrl();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncFromUrl]);
  const pushForm = (query: string) => window.history.pushState({ productForm: true }, "", `${window.location.pathname}?${query}`);
  const openCreate = () => { pushForm("form=new"); setForm({ mode: "create" }); };
  const openEdit = (product: CatalogProduct) => { pushForm(`form=edit&id=${encodeURIComponent(product.id)}`); setForm({ mode: "edit", product }); };
  const closeForm = () => {
    if (window.history.state?.productForm) window.history.back();
    else { window.history.replaceState({}, "", window.location.pathname); setForm(null); }
  };

  const refreshLookups = () => {
    void productsApi.list({ limit: 100 }).then((res) => setAllProducts(res.items)).catch(() => undefined);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkArchive = async () => {
    try {
      const res = await productsApi.bulkArchive([...selectedIds]);
      notify(`${res.archived} archived${res.skipped.length ? `, ${res.skipped.length} skipped` : ""}.`, "success");
      setSelectedIds(new Set());
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not bulk-archive.", "error");
    } finally {
      setBulkArchiveOpen(false);
    }
  };

  if (form) {
    return (
      <ProductFormPage
        key={form.mode === "edit" ? form.product.id : "new"}
        onClose={closeForm}
        onSaved={(saved) => {
          refreshLookups();
          if (form.mode === "edit" && saved) setSelected(saved);
          void load();
        }}
        mode={form.mode}
        product={form.mode === "edit" ? form.product : undefined}
        lockedType={lockedType}
        categories={categories}
        industries={industries}
        forms={forms}
        allProducts={allProducts}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Package className="w-5 h-5" /> {isModulesView ? "Product Modules" : pageLabel}
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {isModulesView ? "Select a product to jump straight to its module configuration." : `The platform ${pageLabel.toLowerCase()} catalog.`}
          </p>
        </div>
        <div className="flex gap-2">
          {canArchive && selectedIds.size > 0 && (
            <Button variant="danger" onClick={() => setBulkArchiveOpen(true)}>
              <Archive className="w-3.5 h-3.5" /> Archive {selectedIds.size} selected
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" onClick={openCreate}>
              <Plus className="w-4 h-4" /> New {(lockedType ? TYPE_LABEL[lockedType] : "product").toLowerCase()}
            </Button>
          )}
        </div>
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder={`Search ${pageLabel.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        {!lockedType && (
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ProductTypeValue | "")}>
            <option value="">All types</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        )}
        <Select value={status} onChange={(e) => setStatus(e.target.value as ProductStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-xs px-2" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={featuredOnly} onChange={(e) => setFeaturedOnly(e.target.checked)} />
          Featured only
        </label>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : products.length === 0 ? (
        <Card>
          <EmptyState title={`No ${pageLabel.toLowerCase()} found`} description="Create one or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {products.map((p) => (
              <div key={p.id} className="flex items-center gap-1 mb-0.5">
                {canArchive && (
                  <button onClick={() => toggleSelect(p.id)} className="p-1" aria-label={`Select ${p.name}`}>
                    {selectedIds.has(p.id) ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />}
                  </button>
                )}
                <button
                  onClick={() => setSelected(p)}
                  className="flex-1 text-left px-2 py-2 rounded-lg text-xs font-semibold flex items-center justify-between gap-2"
                  style={selected?.id === p.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
                >
                  <span className="truncate flex items-center gap-1">
                    {p.isFeatured && <Star className="w-3 h-3 shrink-0" />}
                    {p.name}
                  </span>
                  <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                </button>
              </div>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selected && (
            <ProductDetail
              product={selected}
              onChanged={(updated) => {
                refreshLookups();
                if (updated) setSelected(updated);
                else void load();
              }}
              onEdit={openEdit}
              focusModules={isModulesView}
              lockedType={lockedType}
              categories={categories}
              industries={industries}
              forms={forms}
              allProducts={allProducts}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={bulkArchiveOpen}
        title="Archive selected items"
        message={`Archive ${selectedIds.size} selected item(s)? Already-archived items are skipped harmlessly.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleBulkArchive}
        onCancel={() => setBulkArchiveOpen(false)}
      />
    </div>
  );
};
