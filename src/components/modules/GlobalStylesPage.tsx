/**
 * Phase 3 (Global Styles) — centralized design tokens (colors, typography,
 * layout, effects, buttons, forms, responsive overrides) for
 * artifysols.com, backed by the existing SystemSetting store
 * (server/services/siteSettingsService.ts). Draft/publish/revert mirrors
 * SiteIdentityPage.tsx/SiteEditorPage.tsx's own workflow.
 *
 * These tokens map 1:1 onto artifysolscom's existing CSS custom
 * properties (src/index.css there — `--color-primary` etc.) — publishing
 * here overrides those variables at the root, it does not introduce a
 * second design-token system.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Palette, Save, Rocket, RotateCcw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { siteSettingsApi, type GlobalStyles, type FontWeightValue } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, LoadingState, ErrorState, Field, ConfirmDialog, Badge } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

function docsEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const FONT_WEIGHT_OPTIONS: FontWeightValue[] = [300, 400, 500, 600, 700, 800, "normal", "bold"];

const SECTIONS = ["Colors", "Typography", "Layout", "Effects", "Buttons", "Forms", "Responsive"] as const;
type Section = (typeof SECTIONS)[number];

const ColorField: React.FC<{ label: string; value: string; disabled?: boolean; onChange: (v: string) => void }> = ({ label, value, disabled, onChange }) => {
  const swatch = /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : "#ffffff";
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={swatch}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-9 h-9 rounded-md border cursor-pointer shrink-0"
          style={{ borderColor: "var(--border)" }}
          aria-label={`${label} swatch`}
        />
        <Input disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      </div>
    </Field>
  );
};

const LengthField: React.FC<{ label: string; value: string; hint?: string; disabled?: boolean; onChange: (v: string) => void }> = ({
  label,
  value,
  hint,
  disabled,
  onChange,
}) => (
  <Field label={label} hint={hint}>
    <Input disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. 1rem" />
  </Field>
);

const WeightField: React.FC<{ label: string; value: FontWeightValue; disabled?: boolean; onChange: (v: FontWeightValue) => void }> = ({
  label,
  value,
  disabled,
  onChange,
}) => (
  <Field label={label}>
    <Select
      disabled={disabled}
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "normal" || raw === "bold" ? raw : Number(raw));
      }}
    >
      {FONT_WEIGHT_OPTIONS.map((w) => (
        <option key={String(w)} value={String(w)}>
          {w}
        </option>
      ))}
    </Select>
  </Field>
);

const SectionNav: React.FC<{ active: Section; onChange: (s: Section) => void }> = ({ active, onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {SECTIONS.map((s) => (
      <button
        key={s}
        type="button"
        onClick={() => onChange(s)}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
        style={active === s ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)", border: "1px solid var(--border)" }}
      >
        {s}
      </button>
    ))}
  </div>
);

const LivePreview: React.FC<{ styles: GlobalStyles }> = ({ styles }) => (
  <Card className="p-4 space-y-3">
    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
      Live preview
    </p>
    <div
      className="rounded-xl p-5 space-y-3"
      style={{
        background: styles.colors.background,
        border: `${styles.effects.borderWidth} solid ${styles.effects.borderColor}`,
        borderRadius: styles.layout.borderRadius.lg,
        boxShadow: styles.effects.shadowMd,
        fontFamily: styles.typography.fontFamilyBase,
        fontSize: styles.typography.fontSizeBase,
        lineHeight: styles.typography.lineHeightBase,
        color: styles.colors.textPrimary,
      }}
    >
      <h3
        style={{
          fontFamily: styles.typography.fontFamilyHeading,
          fontSize: styles.typography.headingScale.h3,
          fontWeight: styles.typography.fontWeightHeading,
          lineHeight: styles.typography.lineHeightHeading,
          margin: 0,
        }}
      >
        Sample heading
      </h3>
      <p style={{ color: styles.colors.textSecondary, margin: 0 }}>
        Body text in the base font, with a{" "}
        <a href="#" onClick={(e) => e.preventDefault()} style={{ color: styles.colors.link }}>
          sample link
        </a>
        .
      </p>
      <div
        className="rounded-lg p-3"
        style={{ background: styles.colors.surface, border: `1px solid ${styles.colors.border}`, borderRadius: styles.layout.borderRadius.md }}
      >
        Card surface
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          style={{
            background: styles.buttons.primaryBg,
            color: styles.buttons.primaryText,
            borderRadius: styles.buttons.radius,
            padding: `${styles.buttons.paddingY} ${styles.buttons.paddingX}`,
            fontWeight: styles.buttons.fontWeight,
            border: "none",
          }}
        >
          Primary
        </button>
        <button
          type="button"
          style={{
            background: styles.buttons.secondaryBg,
            color: styles.buttons.secondaryText,
            borderRadius: styles.buttons.radius,
            padding: `${styles.buttons.paddingY} ${styles.buttons.paddingX}`,
            fontWeight: styles.buttons.fontWeight,
            border: `1px solid ${styles.buttons.secondaryBorder}`,
          }}
        >
          Secondary
        </button>
      </div>
      <input
        placeholder="Form input"
        readOnly
        style={{
          width: "100%",
          background: styles.forms.background,
          color: styles.forms.text,
          border: `1px solid ${styles.forms.borderColor}`,
          borderRadius: styles.forms.radius,
          padding: "0.5rem 0.75rem",
          fontSize: styles.typography.fontSizeBase,
        }}
      />
    </div>
  </Card>
);

export const GlobalStylesPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "settings.manage");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<GlobalStyles | null>(null);
  const [formState, setFormState] = useState<GlobalStyles | null>(null);
  const [serverIsDirty, setServerIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [section, setSection] = useState<Section>("Colors");

  const dirty = !!formState && !!savedDraft && !docsEqual(formState, savedDraft);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await siteSettingsApi.getGlobalStyles();
      setSavedDraft(res.draft);
      setFormState(res.draft);
      setServerIsDirty(res.isDirty);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load global styles.");
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

  const setPath = <G extends keyof GlobalStyles, K extends keyof GlobalStyles[G]>(group: G, key: K, value: GlobalStyles[G][K]) => {
    setFormState((prev) => (prev ? { ...prev, [group]: { ...prev[group], [key]: value } } : prev));
  };
  const setNestedPath = <G extends keyof GlobalStyles, S extends keyof GlobalStyles[G], K extends keyof GlobalStyles[G][S]>(
    group: G,
    sub: S,
    key: K,
    value: GlobalStyles[G][S][K]
  ) => {
    setFormState((prev) => (prev ? { ...prev, [group]: { ...prev[group], [sub]: { ...prev[group][sub], [key]: value } } } : prev));
  };

  const save = async (): Promise<boolean> => {
    if (!formState) return false;
    setSaving(true);
    try {
      const res = await siteSettingsApi.saveGlobalStylesDraft(formState);
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
      await siteSettingsApi.publishGlobalStyles();
      setServerIsDirty(false);
      notify("Global styles published.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not publish.", "error");
    } finally {
      setPublishing(false);
    }
  };

  const handleRevert = async () => {
    setRevertOpen(false);
    try {
      const res = await siteSettingsApi.revertGlobalStyles();
      setSavedDraft(res.draft);
      setFormState(res.draft);
      setServerIsDirty(false);
      notify("Draft reverted to the published version.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not revert.", "error");
    }
  };

  if (loading) return <LoadingState label="Loading global styles…" />;
  if (error || !formState) return <ErrorState message={error ?? "Global styles unavailable."} />;

  const s = formState;

  return (
    <div className="space-y-4">
      <Card className="p-3 flex items-center justify-between gap-3 flex-wrap sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Palette className="w-5 h-5" /> Global Styles
          </h1>
          <p className="text-xs flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            Design tokens applied across artifysols.com.
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

      <div className="grid lg:grid-cols-[1fr_340px] gap-4 items-start">
        <Card className="p-4 space-y-4">
          <SectionNav active={section} onChange={setSection} />

          {section === "Colors" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <ColorField label="Primary" value={s.colors.primary} disabled={!canManage} onChange={(v) => setPath("colors", "primary", v)} />
              <ColorField label="Primary (hover)" value={s.colors.primaryHover} disabled={!canManage} onChange={(v) => setPath("colors", "primaryHover", v)} />
              <ColorField
                label="Primary text (on primary bg)"
                value={s.colors.primaryForeground}
                disabled={!canManage}
                onChange={(v) => setPath("colors", "primaryForeground", v)}
              />
              <ColorField label="Secondary" value={s.colors.secondary} disabled={!canManage} onChange={(v) => setPath("colors", "secondary", v)} />
              <ColorField
                label="Secondary text"
                value={s.colors.secondaryForeground}
                disabled={!canManage}
                onChange={(v) => setPath("colors", "secondaryForeground", v)}
              />
              <ColorField label="Background" value={s.colors.background} disabled={!canManage} onChange={(v) => setPath("colors", "background", v)} />
              <ColorField label="Surface" value={s.colors.surface} disabled={!canManage} onChange={(v) => setPath("colors", "surface", v)} />
              <ColorField label="Text (primary)" value={s.colors.textPrimary} disabled={!canManage} onChange={(v) => setPath("colors", "textPrimary", v)} />
              <ColorField label="Text (secondary)" value={s.colors.textSecondary} disabled={!canManage} onChange={(v) => setPath("colors", "textSecondary", v)} />
              <ColorField label="Link" value={s.colors.link} disabled={!canManage} onChange={(v) => setPath("colors", "link", v)} />
              <ColorField label="Link (hover)" value={s.colors.linkHover} disabled={!canManage} onChange={(v) => setPath("colors", "linkHover", v)} />
              <ColorField label="Border" value={s.colors.border} disabled={!canManage} onChange={(v) => setPath("colors", "border", v)} />
            </div>
          )}

          {section === "Typography" && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Base font family">
                  <Input disabled={!canManage} value={s.typography.fontFamilyBase} onChange={(e) => setPath("typography", "fontFamilyBase", e.target.value)} />
                </Field>
                <Field label="Heading font family">
                  <Input
                    disabled={!canManage}
                    value={s.typography.fontFamilyHeading}
                    onChange={(e) => setPath("typography", "fontFamilyHeading", e.target.value)}
                  />
                </Field>
                <LengthField label="Base font size" value={s.typography.fontSizeBase} disabled={!canManage} onChange={(v) => setPath("typography", "fontSizeBase", v)} />
                <WeightField label="Base font weight" value={s.typography.fontWeightBase} disabled={!canManage} onChange={(v) => setPath("typography", "fontWeightBase", v)} />
                <WeightField
                  label="Heading font weight"
                  value={s.typography.fontWeightHeading}
                  disabled={!canManage}
                  onChange={(v) => setPath("typography", "fontWeightHeading", v)}
                />
                <WeightField label="Bold weight" value={s.typography.fontWeightBold} disabled={!canManage} onChange={(v) => setPath("typography", "fontWeightBold", v)} />
                <Field label="Base line height">
                  <Input
                    type="number"
                    step="0.1"
                    min={0.5}
                    max={3}
                    disabled={!canManage}
                    value={s.typography.lineHeightBase}
                    onChange={(e) => setPath("typography", "lineHeightBase", Number(e.target.value))}
                  />
                </Field>
                <Field label="Heading line height">
                  <Input
                    type="number"
                    step="0.1"
                    min={0.5}
                    max={3}
                    disabled={!canManage}
                    value={s.typography.lineHeightHeading}
                    onChange={(e) => setPath("typography", "lineHeightHeading", Number(e.target.value))}
                  />
                </Field>
              </div>
              <p className="text-xs font-bold uppercase tracking-wide pt-2 border-t" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
                Heading scale
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                {(["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((h) => (
                  <LengthField
                    key={h}
                    label={h.toUpperCase()}
                    value={s.typography.headingScale[h]}
                    disabled={!canManage}
                    onChange={(v) => setNestedPath("typography", "headingScale", h, v)}
                  />
                ))}
              </div>
            </div>
          )}

          {section === "Layout" && (
            <div className="space-y-4">
              <LengthField
                label="Container max width"
                value={s.layout.containerMaxWidth}
                disabled={!canManage}
                onChange={(v) => setPath("layout", "containerMaxWidth", v)}
              />
              <p className="text-xs font-bold uppercase tracking-wide pt-2 border-t" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
                Spacing scale
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                {(["xs", "sm", "md", "lg", "xl"] as const).map((k) => (
                  <LengthField
                    key={k}
                    label={k.toUpperCase()}
                    value={s.layout.spacingScale[k]}
                    disabled={!canManage}
                    onChange={(v) => setNestedPath("layout", "spacingScale", k, v)}
                  />
                ))}
              </div>
              <p className="text-xs font-bold uppercase tracking-wide pt-2 border-t" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
                Border radius
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                <LengthField label="Small" value={s.layout.borderRadius.sm} disabled={!canManage} onChange={(v) => setNestedPath("layout", "borderRadius", "sm", v)} />
                <LengthField label="Medium" value={s.layout.borderRadius.md} disabled={!canManage} onChange={(v) => setNestedPath("layout", "borderRadius", "md", v)} />
                <LengthField label="Large" value={s.layout.borderRadius.lg} disabled={!canManage} onChange={(v) => setNestedPath("layout", "borderRadius", "lg", v)} />
              </div>
            </div>
          )}

          {section === "Effects" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <ColorField label="Border color" value={s.effects.borderColor} disabled={!canManage} onChange={(v) => setPath("effects", "borderColor", v)} />
              <LengthField label="Border width" value={s.effects.borderWidth} disabled={!canManage} onChange={(v) => setPath("effects", "borderWidth", v)} />
              <Field label="Shadow (small)">
                <Input disabled={!canManage} value={s.effects.shadowSm} onChange={(e) => setPath("effects", "shadowSm", e.target.value)} />
              </Field>
              <Field label="Shadow (medium)">
                <Input disabled={!canManage} value={s.effects.shadowMd} onChange={(e) => setPath("effects", "shadowMd", e.target.value)} />
              </Field>
              <Field label="Shadow (large)">
                <Input disabled={!canManage} value={s.effects.shadowLg} onChange={(e) => setPath("effects", "shadowLg", e.target.value)} />
              </Field>
            </div>
          )}

          {section === "Buttons" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <LengthField label="Radius" value={s.buttons.radius} disabled={!canManage} onChange={(v) => setPath("buttons", "radius", v)} />
              <WeightField label="Font weight" value={s.buttons.fontWeight} disabled={!canManage} onChange={(v) => setPath("buttons", "fontWeight", v)} />
              <LengthField label="Padding X" value={s.buttons.paddingX} disabled={!canManage} onChange={(v) => setPath("buttons", "paddingX", v)} />
              <LengthField label="Padding Y" value={s.buttons.paddingY} disabled={!canManage} onChange={(v) => setPath("buttons", "paddingY", v)} />
              <ColorField label="Primary background" value={s.buttons.primaryBg} disabled={!canManage} onChange={(v) => setPath("buttons", "primaryBg", v)} />
              <ColorField label="Primary text" value={s.buttons.primaryText} disabled={!canManage} onChange={(v) => setPath("buttons", "primaryText", v)} />
              <ColorField
                label="Primary background (hover)"
                value={s.buttons.primaryHoverBg}
                disabled={!canManage}
                onChange={(v) => setPath("buttons", "primaryHoverBg", v)}
              />
              <ColorField label="Secondary background" value={s.buttons.secondaryBg} disabled={!canManage} onChange={(v) => setPath("buttons", "secondaryBg", v)} />
              <ColorField label="Secondary text" value={s.buttons.secondaryText} disabled={!canManage} onChange={(v) => setPath("buttons", "secondaryText", v)} />
              <ColorField label="Secondary border" value={s.buttons.secondaryBorder} disabled={!canManage} onChange={(v) => setPath("buttons", "secondaryBorder", v)} />
            </div>
          )}

          {section === "Forms" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <LengthField label="Radius" value={s.forms.radius} disabled={!canManage} onChange={(v) => setPath("forms", "radius", v)} />
              <ColorField label="Border color" value={s.forms.borderColor} disabled={!canManage} onChange={(v) => setPath("forms", "borderColor", v)} />
              <ColorField label="Focus color" value={s.forms.focusColor} disabled={!canManage} onChange={(v) => setPath("forms", "focusColor", v)} />
              <ColorField label="Background" value={s.forms.background} disabled={!canManage} onChange={(v) => setPath("forms", "background", v)} />
              <ColorField label="Text" value={s.forms.text} disabled={!canManage} onChange={(v) => setPath("forms", "text", v)} />
            </div>
          )}

          {section === "Responsive" && (
            <div className="space-y-4">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Optional overrides applied at tablet/mobile breakpoints. Leave blank to inherit the desktop values above.
              </p>
              {(["tablet", "mobile"] as const).map((bp) => (
                <div key={bp} className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    {bp}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Container max width">
                      <Input
                        disabled={!canManage}
                        value={s.responsive[bp].containerMaxWidth ?? ""}
                        onChange={(e) => setPath("responsive", bp, { ...s.responsive[bp], containerMaxWidth: e.target.value || undefined })}
                        placeholder={s.layout.containerMaxWidth}
                      />
                    </Field>
                    <Field label="Base font size">
                      <Input
                        disabled={!canManage}
                        value={s.responsive[bp].fontSizeBase ?? ""}
                        onChange={(e) => setPath("responsive", bp, { ...s.responsive[bp], fontSizeBase: e.target.value || undefined })}
                        placeholder={s.typography.fontSizeBase}
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="lg:sticky lg:top-16">
          <LivePreview styles={s} />
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
