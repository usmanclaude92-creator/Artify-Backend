/**
 * Phase 8 (Advanced SEO Control Center) — shared SEO metadata editor + live
 * preview, used by both PostsPage and PagesPage. Every field here maps
 * 1:1 to server/schemas/contentSchemas.ts's seoMetadataSchema — this
 * component adds no field the backend can't already store, and the
 * preview reflects the same fallback chain the public site actually uses
 * (explicit value -> content title/excerpt -> nothing), never a fabricated
 * example.
 */
import React from "react";
import { Field, Input, Select } from "../ui/ui";

export interface SeoFieldsValue {
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  focusKeywords: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterImage: string;
  ogType: string;
  twitterCard: string;
  robotsDirective: string;
  schemaType: string;
}

export const EMPTY_SEO_FIELDS: SeoFieldsValue = {
  metaTitle: "",
  metaDescription: "",
  canonicalUrl: "",
  focusKeywords: "",
  ogTitle: "",
  ogDescription: "",
  ogImage: "",
  twitterImage: "",
  ogType: "",
  twitterCard: "",
  robotsDirective: "",
  schemaType: "",
};

type StoredMetadata = Partial<{
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  focusKeywords: string[];
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterImage: string;
  ogType: string;
  twitterCard: string;
  robotsDirective: string;
  schemaType: string;
}>;

export function seoFieldsFromMetadata(metadata: unknown): SeoFieldsValue {
  const m = (metadata ?? {}) as StoredMetadata;
  return {
    metaTitle: m.metaTitle ?? "",
    metaDescription: m.metaDescription ?? "",
    canonicalUrl: m.canonicalUrl ?? "",
    focusKeywords: (m.focusKeywords ?? []).join(", "),
    ogTitle: m.ogTitle ?? "",
    ogDescription: m.ogDescription ?? "",
    ogImage: m.ogImage ?? "",
    twitterImage: m.twitterImage ?? "",
    ogType: m.ogType ?? "",
    twitterCard: m.twitterCard ?? "",
    robotsDirective: m.robotsDirective ?? "",
    schemaType: m.schemaType ?? "",
  };
}

/** Inverse of seoFieldsFromMetadata — drops any field left blank so the server's own optional-field defaults (none of this is required) still apply. */
export function seoFieldsToMetadata(value: SeoFieldsValue): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (value.metaTitle.trim()) out.metaTitle = value.metaTitle.trim();
  if (value.metaDescription.trim()) out.metaDescription = value.metaDescription.trim();
  if (value.canonicalUrl.trim()) out.canonicalUrl = value.canonicalUrl.trim();
  const keywords = value.focusKeywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keywords.length) out.focusKeywords = keywords.slice(0, 10);
  if (value.ogTitle.trim()) out.ogTitle = value.ogTitle.trim();
  if (value.ogDescription.trim()) out.ogDescription = value.ogDescription.trim();
  if (value.ogImage.trim()) out.ogImage = value.ogImage.trim();
  if (value.twitterImage.trim()) out.twitterImage = value.twitterImage.trim();
  if (value.ogType) out.ogType = value.ogType;
  if (value.twitterCard) out.twitterCard = value.twitterCard;
  if (value.robotsDirective) out.robotsDirective = value.robotsDirective;
  if (value.schemaType) out.schemaType = value.schemaType;
  return out;
}

const CharCount: React.FC<{ value: string; max: number }> = ({ value, max }) => (
  <span style={{ color: value.length > max ? "var(--danger)" : "var(--text-muted)" }}>
    {value.length}/{max}
  </span>
);

export const SeoFieldsPanel: React.FC<{
  value: SeoFieldsValue;
  onChange: (next: SeoFieldsValue) => void;
  /** Real fallback values this content would actually render with if a field is left blank — never fabricated. */
  fallbackTitle: string;
  fallbackDescription: string;
  fallbackImageUrl?: string;
  /** Site-relative path this content is reachable at, e.g. /blog/my-post or /about — used only for the preview's displayed URL. */
  previewPath: string;
}> = ({ value, onChange, fallbackTitle, fallbackDescription, fallbackImageUrl, previewPath }) => {
  const set = (patch: Partial<SeoFieldsValue>) => onChange({ ...value, ...patch });

  const previewTitle = value.metaTitle.trim() || fallbackTitle;
  const previewDescription = value.metaDescription.trim() || fallbackDescription;
  const socialTitle = value.ogTitle.trim() || previewTitle;
  const socialDescription = value.ogDescription.trim() || previewDescription;
  const socialImage = value.ogImage.trim() || fallbackImageUrl;

  return (
    <div className="space-y-3">
      <Field label="Meta title" hint="Shown in search results and social previews. Falls back to the content title if left blank.">
        <Input value={value.metaTitle} onChange={(e) => set({ metaTitle: e.target.value })} maxLength={70} />
        <div className="text-[10px] mt-1 text-right">
          <CharCount value={value.metaTitle} max={60} />
        </div>
      </Field>
      <Field label="Meta description" hint="Falls back to an auto-generated excerpt if left blank.">
        <textarea
          className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
          style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          rows={2}
          maxLength={320}
          value={value.metaDescription}
          onChange={(e) => set({ metaDescription: e.target.value })}
        />
        <div className="text-[10px] mt-1 text-right">
          <CharCount value={value.metaDescription} max={160} />
        </div>
      </Field>

      <div className="rounded-xl border p-3 space-y-1" style={{ borderColor: "var(--border)", background: "var(--bg-app)" }}>
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Google result preview
        </p>
        <p className="text-sm truncate" style={{ color: "#4b5563" }}>
          artifysols.com{previewPath}
        </p>
        <p className="text-base leading-tight truncate" style={{ color: "#1a0dab" }}>
          {previewTitle || "(no title set)"}
        </p>
        <p className="text-xs line-clamp-2" style={{ color: "var(--text-secondary)" }}>
          {previewDescription || "(no description available — search engines will generate one from the page content)"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Canonical URL" hint="Leave blank unless this content duplicates another URL you want search engines to prefer instead.">
          <Input value={value.canonicalUrl} onChange={(e) => set({ canonicalUrl: e.target.value })} placeholder="https://..." />
        </Field>
        <Field label="Robots directive" hint="Controls whether/how search engines index this content.">
          <Select value={value.robotsDirective} onChange={(e) => set({ robotsDirective: e.target.value })}>
            <option value="">Default (index, follow)</option>
            <option value="index, follow">index, follow</option>
            <option value="noindex, follow">noindex, follow</option>
            <option value="noindex, nofollow">noindex, nofollow</option>
          </Select>
        </Field>
      </div>

      <Field label="Focus keyphrase(s)" hint="Comma-separated. Internal targeting notes only — never injected into the page.">
        <Input value={value.focusKeywords} onChange={(e) => set({ focusKeywords: e.target.value })} placeholder="e.g. headless cms, content api" />
      </Field>

      <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Social sharing (Open Graph / Twitter)
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="OG title" hint="Falls back to the meta title above if left blank.">
            <Input value={value.ogTitle} onChange={(e) => set({ ogTitle: e.target.value })} maxLength={95} />
          </Field>
          <Field label="OG type">
            <Select value={value.ogType} onChange={(e) => set({ ogType: e.target.value })}>
              <option value="">Default</option>
              <option value="article">article</option>
              <option value="website">website</option>
              <option value="news">news</option>
            </Select>
          </Field>
        </div>
        <Field label="OG description" hint="Falls back to the meta description above if left blank.">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={2}
            maxLength={320}
            value={value.ogDescription}
            onChange={(e) => set({ ogDescription: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Open Graph image URL" hint="Falls back to the featured image (Media Library) if left blank.">
            <Input value={value.ogImage} onChange={(e) => set({ ogImage: e.target.value })} placeholder="https://..." />
          </Field>
          <Field label="Twitter card image URL" hint="Falls back to the Open Graph image if left blank.">
            <Input value={value.twitterImage} onChange={(e) => set({ twitterImage: e.target.value })} placeholder="https://..." />
          </Field>
        </div>
        <Field label="Twitter card type">
          <Select value={value.twitterCard} onChange={(e) => set({ twitterCard: e.target.value })}>
            <option value="">Default (summary_large_image)</option>
            <option value="summary_large_image">summary_large_image</option>
            <option value="summary">summary</option>
          </Select>
        </Field>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          {socialImage && (
            <div className="w-full aspect-[1.91/1] overflow-hidden" style={{ background: "var(--bg-app)" }}>
              <img src={socialImage} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="p-2.5 space-y-0.5" style={{ background: "var(--bg-app)" }}>
            <p className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>
              artifysols.com
            </p>
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {socialTitle || "(no title set)"}
            </p>
            <p className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>
              {socialDescription || "(no description set)"}
            </p>
          </div>
        </div>
      </div>

      <Field label="Structured data (JSON-LD) article type" hint="Used to describe this content to search engines. Leave blank to use the site default for this content type.">
        <Select value={value.schemaType} onChange={(e) => set({ schemaType: e.target.value })}>
          <option value="">Default</option>
          <option value="BlogPosting">BlogPosting</option>
          <option value="TechArticle">TechArticle</option>
          <option value="NewsArticle">NewsArticle</option>
          <option value="Report">Report</option>
        </Select>
      </Field>
    </div>
  );
};
