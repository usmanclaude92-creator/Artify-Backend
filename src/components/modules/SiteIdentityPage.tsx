/**
 * Phase 3 (Site Identity) — centralized site name/tagline/logo/favicon/
 * social image/default metadata/contact info, backed by the existing
 * SystemSetting store (server/services/siteSettingsService.ts). Draft/
 * publish/revert mirrors the Site Editor's own workflow (SiteEditorPage.tsx)
 * so editors learn one pattern once.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Globe, Save, Rocket, RotateCcw, Image as ImageIcon, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { siteSettingsApi, mediaApi, type SiteIdentity } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, LoadingState, ErrorState, Field, ConfirmDialog, Badge } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { MediaPickerModal } from "../common/MediaPickerModal";

function docsEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const MEDIA_FIELDS = [
  { key: "logoMediaId", label: "Logo", hint: "Shown in the header on a light background." },
  { key: "logoDarkMediaId", label: "Logo (dark mode)", hint: "Shown in the header when dark mode is active." },
  { key: "logoMobileMediaId", label: "Logo (mobile)", hint: "Optional compact mark for small screens. Falls back to the main logo." },
  { key: "faviconMediaId", label: "Favicon", hint: "Browser tab icon. A square PNG or SVG works best." },
  { key: "socialImageMediaId", label: "Default social share image", hint: "Used for og:image/Twitter cards when a page has no image of its own." },
] as const satisfies readonly { key: keyof SiteIdentity; label: string; hint: string }[];

const MediaThumb: React.FC<{ mediaId: string | null }> = ({ mediaId }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!mediaId) {
      setUrl(null);
      return;
    }
    void mediaApi.getReadUrl(mediaId).then((res) => {
      if (!cancelled) setUrl(res.url);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  if (url) return <img src={url} alt="" className="w-full h-full object-contain" />;
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
      <ImageIcon className="w-5 h-5" />
    </div>
  );
};

const MediaField: React.FC<{
  label: string;
  hint: string;
  mediaId: string | null;
  disabled?: boolean;
  onChange: (mediaId: string | null) => void;
}> = ({ label, hint, mediaId, disabled, onChange }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-lg border shrink-0 p-1.5" style={{ borderColor: "var(--border)", background: "var(--bg-app)" }}>
          <MediaThumb mediaId={mediaId} />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={disabled} onClick={() => setPickerOpen(true)}>
            {mediaId ? "Change" : "Choose image"}
          </Button>
          {mediaId && !disabled && (
            <Button type="button" variant="ghost" onClick={() => onChange(null)} aria-label={`Remove ${label}`}>
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m) => {
          onChange(m.id);
          setPickerOpen(false);
        }}
      />
    </Field>
  );
};

export const SiteIdentityPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "settings.manage");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<SiteIdentity | null>(null);
  const [savedDraft, setSavedDraft] = useState<SiteIdentity | null>(null);
  const [formState, setFormState] = useState<SiteIdentity | null>(null);
  const [serverIsDirty, setServerIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);

  const dirty = !!formState && !!savedDraft && !docsEqual(formState, savedDraft);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await siteSettingsApi.getIdentity();
      setPublished(res.published);
      setSavedDraft(res.draft);
      setFormState(res.draft);
      setServerIsDirty(res.isDirty);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load site identity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const set = <K extends keyof SiteIdentity>(key: K, value: SiteIdentity[K]) => {
    setFormState((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async (): Promise<boolean> => {
    if (!formState) return false;
    setSaving(true);
    try {
      const res = await siteSettingsApi.saveIdentityDraft(formState);
      setSavedDraft(res.draft);
      setFormState(res.draft);
      setServerIsDirty(true);
      return true;
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not save draft.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    if (await save()) notify("Draft saved.", "success");
  };

  const handlePublish = async () => {
    if (dirty && !(await save())) return;
    setPublishing(true);
    try {
      const res = await siteSettingsApi.publishIdentity();
      setPublished(res.published);
      setServerIsDirty(false);
      notify("Site identity published.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not publish.", "error");
    } finally {
      setPublishing(false);
    }
  };

  const handleRevert = async () => {
    setRevertOpen(false);
    try {
      const res = await siteSettingsApi.revertIdentity();
      setSavedDraft(res.draft);
      setFormState(res.draft);
      setServerIsDirty(false);
      notify("Draft reverted to the published version.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not revert.", "error");
    }
  };

  if (loading) return <LoadingState label="Loading site identity…" />;
  if (error || !formState) return <ErrorState message={error ?? "Site identity unavailable."} />;

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-center justify-between gap-3 flex-wrap sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Globe className="w-5 h-5" /> Site Identity
          </h1>
          <p className="text-xs flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            Name, logo, favicon, and default metadata used across artifysols.com.
            {dirty && <span className="text-amber-500">Unsaved changes</span>}
            {!dirty && serverIsDirty && <Badge tone="warning">Draft not yet published</Badge>}
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button variant="ghost" onClick={() => setRevertOpen(true)} disabled={!serverIsDirty && !dirty}>
              <RotateCcw className="w-3.5 h-3.5" /> Revert
            </Button>
            <Button variant="secondary" onClick={() => void handleSaveDraft()} disabled={saving || !dirty}>
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save draft"}
            </Button>
            <Button variant="primary" onClick={() => void handlePublish()} disabled={publishing || (!dirty && !serverIsDirty)}>
              <Rocket className="w-3.5 h-3.5" /> {publishing ? "Publishing…" : "Publish"}
            </Button>
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Identity
          </p>
          <Field label="Site name">
            <Input required disabled={!canManage} value={formState.siteName} onChange={(e) => set("siteName", e.target.value)} />
          </Field>
          <Field label="Tagline">
            <Input disabled={!canManage} value={formState.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea
              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
              style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              rows={3}
              disabled={!canManage}
              value={formState.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>

          <p className="text-xs font-bold uppercase tracking-wide pt-2 border-t" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
            Contact / Organization
          </p>
          <Field label="Contact email">
            <Input type="email" disabled={!canManage} value={formState.contactEmail ?? ""} onChange={(e) => set("contactEmail", e.target.value)} />
          </Field>
          <Field label="Contact phone">
            <Input disabled={!canManage} value={formState.contactPhone ?? ""} onChange={(e) => set("contactPhone", e.target.value)} />
          </Field>
          <Field label="Address">
            <Input disabled={!canManage} value={formState.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Legal / registered name">
            <Input disabled={!canManage} value={formState.organizationLegalName ?? ""} onChange={(e) => set("organizationLegalName", e.target.value)} />
          </Field>
        </Card>

        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Logos & Icons
            </p>
            {MEDIA_FIELDS.map((f) => (
              <MediaField
                key={f.key}
                label={f.label}
                hint={f.hint}
                disabled={!canManage}
                mediaId={(formState[f.key] as string | null) ?? null}
                onChange={(id) => set(f.key, id as SiteIdentity[typeof f.key])}
              />
            ))}
          </Card>

          <Card className="p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Default Metadata
            </p>
            <Field label="Default meta title" hint="Used when a page doesn't set its own.">
              <Input disabled={!canManage} maxLength={70} value={formState.defaultMetaTitle} onChange={(e) => set("defaultMetaTitle", e.target.value)} />
            </Field>
            <Field label="Default meta description">
              <textarea
                className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
                style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                rows={2}
                maxLength={200}
                disabled={!canManage}
                value={formState.defaultMetaDescription}
                onChange={(e) => set("defaultMetaDescription", e.target.value)}
              />
            </Field>
          </Card>

          {published && (
            <Card className="p-4">
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
                Currently live
              </p>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {published.siteName}
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {published.tagline}
              </p>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={revertOpen}
        title="Revert draft"
        message="Discard the current draft and reset it to the published version? Any unsaved or saved-but-unpublished changes will be lost."
        confirmLabel="Revert"
        destructive
        onConfirm={() => void handleRevert()}
        onCancel={() => setRevertOpen(false)}
      />
    </div>
  );
};
