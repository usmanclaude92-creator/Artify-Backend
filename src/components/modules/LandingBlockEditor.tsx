/** Spec-driven editor for one landing page block (Step 12). Plain text inputs only: there is no HTML or script field anywhere. */
import React, { useState } from "react";
import { Plus, Trash2, ImageIcon } from "lucide-react";
import { Button, Input, Select, Field } from "../ui/ui";
import { MediaPickerModal } from "../common/MediaPickerModal";
import { FORM_FIELD_TYPES, type FieldSpec } from "../../lib/landingBlocks";
import type { CmsMedia } from "../../lib/api";

type Obj = Record<string, any>;

const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    rows={3}
    className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2"
    style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
    {...props}
  />
);

const ImageField: React.FC<{ label: string; value?: { mediaId: string; alt: string }; onChange: (v: { mediaId: string; alt: string } | undefined) => void }> = ({ label, value, onChange }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{label}</span>
      {value ? (
        <div className="space-y-2">
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Media library image selected ({value.mediaId.slice(0, 8)}…)</p>
          <Field label="Alt text (required: describe the image for people who cannot see it)">
            <Input value={value.alt} maxLength={200} onChange={(e) => onChange({ ...value, alt: e.target.value })} aria-invalid={!value.alt.trim()} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" onClick={() => setOpen(true)}><ImageIcon className="w-3.5 h-3.5" /> Replace</Button>
            <Button type="button" variant="ghost" onClick={() => onChange(undefined)}>Remove image</Button>
          </div>
        </div>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}><ImageIcon className="w-3.5 h-3.5" /> Choose from Media library</Button>
      )}
      <MediaPickerModal open={open} onClose={() => setOpen(false)} onSelect={(m: CmsMedia) => { onChange({ mediaId: m.id, alt: value?.alt || m.altText || "" }); setOpen(false); }} />
    </div>
  );
};

const FormFieldsEditor: React.FC<{ value: Obj[]; onChange: (v: Obj[]) => void }> = ({ value, onChange }) => (
  <div className="space-y-2">
    {value.map((f, i) => (
      <div key={i} className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3"><Field label="Key"><Input value={f.key ?? ""} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase() } : x)))} /></Field></div>
        <div className="col-span-3"><Field label="Label"><Input value={f.label ?? ""} maxLength={60} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></Field></div>
        <div className="col-span-3">
          <Field label="Type">
            <Select className="w-full" value={f.type} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
              {FORM_FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
        </div>
        <label className="col-span-2 flex items-center gap-1 text-xs pb-2" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={!!f.required} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /> Required
        </label>
        <Button type="button" variant="ghost" aria-label={`Remove field ${f.label || i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
        {f.type === "select" && (
          <div className="col-span-12">
            <Field label="Options (one per line)"><TextArea value={(f.options ?? []).map((o: Obj) => o.label).join("\n")} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).map((s) => ({ value: s, label: s })) } : x)))} /></Field>
          </div>
        )}
      </div>
    ))}
    {value.length < 8 && <Button type="button" onClick={() => onChange([...value, { key: "", label: "", type: "text", required: false }])}><Plus className="w-3.5 h-3.5" /> Add field</Button>}
    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>The form needs an email or a phone field. Keys: lowercase letters, numbers and _ (website, consent, utm and touch are reserved).</p>
  </div>
);

const FieldEditor: React.FC<{ spec: FieldSpec; value: any; onChange: (v: any) => void; id: string }> = ({ spec, value, onChange, id }) => {
  const label = spec.optional ? `${spec.label} (optional)` : spec.label;
  switch (spec.kind) {
    case "text":
      return <Field label={label}><Input id={id} value={value ?? ""} maxLength={spec.max} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "textarea":
      return <Field label={label}><TextArea id={id} value={value ?? ""} maxLength={spec.max} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "bool":
      return (
        <label className="flex items-start gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" className="mt-0.5" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {spec.label}
        </label>
      );
    case "cta": {
      const v = value ?? { label: "", href: "" };
      return (
        <div className="space-y-1">
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{label}</span>
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label={`${spec.label} text`} placeholder="Button text" maxLength={40} value={v.label} onChange={(e) => onChange({ ...v, label: e.target.value })} />
            <Input aria-label={`${spec.label} link`} placeholder="https://… or #contact or /path" value={v.href} onChange={(e) => onChange({ ...v, href: e.target.value })} />
          </div>
          {spec.optional && value && <Button type="button" variant="ghost" onClick={() => onChange(undefined)}>Remove</Button>}
        </div>
      );
    }
    case "image":
      return <ImageField label={label} value={value} onChange={onChange} />;
    case "strings":
      return <Field label={label}><TextArea value={(value ?? []).join("\n")} onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, spec.maxItems ?? 10))} /></Field>;
    case "formFields":
      return <FormFieldsEditor value={value ?? []} onChange={onChange} />;
    case "consent": {
      const v = value ?? { enabled: false, text: "", privacyUrl: "" };
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={!!v.enabled} onChange={(e) => onChange({ ...v, enabled: e.target.checked })} /> Require a consent checkbox
          </label>
          {v.enabled && (
            <>
              <Field label="Consent text (required)"><TextArea value={v.text ?? ""} maxLength={300} onChange={(e) => onChange({ ...v, text: e.target.value })} /></Field>
              <Field label="Privacy policy link (required: https://… or /privacy)"><Input value={v.privacyUrl ?? ""} onChange={(e) => onChange({ ...v, privacyUrl: e.target.value })} /></Field>
            </>
          )}
        </div>
      );
    }
    case "list": {
      const items: Obj[] = value ?? [];
      const blank = () => Object.fromEntries((spec.itemFields ?? []).map((f) => [f.key, f.kind === "strings" ? [] : f.kind === "cta" ? { label: "", href: "" } : f.kind === "bool" ? false : ""]));
      return (
        <div className="space-y-3">
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{label}</span>
          {items.map((item, i) => (
            <div key={i} className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
              {(spec.itemFields ?? []).map((f) => (
                <FieldEditor key={f.key} id={`${id}-${i}-${f.key}`} spec={f} value={item[f.key]} onChange={(v) => onChange(items.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)))} />
              ))}
              {items.length > (spec.minItems ?? 0) && (
                <Button type="button" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /> Remove</Button>
              )}
            </div>
          ))}
          {items.length < (spec.maxItems ?? 20) && <Button type="button" onClick={() => onChange([...items, blank()])}><Plus className="w-3.5 h-3.5" /> Add</Button>}
        </div>
      );
    }
  }
};

export const LandingBlockEditor: React.FC<{ fields: FieldSpec[]; props: Obj; blockId: string; onChange: (props: Obj) => void }> = ({ fields, props, blockId, onChange }) => (
  <div className="space-y-3">
    {fields.map((f) => (
      <FieldEditor key={f.key} id={`${blockId}-${f.key}`} spec={f} value={props[f.key]} onChange={(v) => onChange({ ...props, [f.key]: v })} />
    ))}
  </div>
);
