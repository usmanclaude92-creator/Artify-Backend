/** Phase 9 — Marketing forms: field-definition CRUD (full field-type set, options, conditional visibility, notify recipients) + a submissions viewer/export per form. */
import React, { useEffect, useState } from "react";
import { ClipboardList, Plus, Trash2, Pencil, Search, X, Eye, Archive, RotateCcw, Download } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { formsApi, usersApi, type MarketingForm, type FormFieldDef, type FormFieldTypeValue, type FormFieldOption, type FormSubmission, type FormStatusValue, type SanitizedUser } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";

const FIELD_TYPES: FormFieldTypeValue[] = ["text", "email", "tel", "number", "select", "multiselect", "checkbox", "radio", "date", "textarea", "hidden"];
const OPTION_TYPES = new Set<FormFieldTypeValue>(["select", "multiselect", "radio"]);
const STATUS_TONE: Record<FormStatusValue, "success" | "neutral"> = { ACTIVE: "success", ARCHIVED: "neutral" };

/** "value|label" per line, the simplest editable shape for a plain textarea — matches formFieldOptionSchema's {value,label} shape. */
function optionsToText(options: FormFieldOption[] | undefined): string {
  return (options ?? []).map((o) => (o.value === o.label ? o.value : `${o.value}|${o.label}`)).join("\n");
}
function textToOptions(text: string): FormFieldOption[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, label] = line.split("|").map((s) => s.trim());
      return { value: value!, label: label || value! };
    });
}

let fieldRowSeq = 0;
interface FieldRow extends FormFieldDef {
  _rowId: number;
}
const toRows = (fields: FormFieldDef[]): FieldRow[] => fields.map((f) => ({ ...f, _rowId: ++fieldRowSeq }));

const FieldsEditor: React.FC<{ rows: FieldRow[]; onChange: (rows: FieldRow[]) => void }> = ({ rows, onChange }) => {
  const update = (rowId: number, patch: Partial<FormFieldDef>) => onChange(rows.map((r) => (r._rowId === rowId ? { ...r, ...patch } : r)));
  const remove = (rowId: number) => onChange(rows.filter((r) => r._rowId !== rowId));
  const add = () => onChange([...rows, { _rowId: ++fieldRowSeq, key: "", label: "", type: "text", required: false }]);

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const otherKeys = rows.filter((r) => r._rowId !== row._rowId && r.key.trim()).map((r) => r.key);
        return (
          <div key={row._rowId} className="p-2 rounded-lg border space-y-1.5" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="key (e.g. email)"
                className="w-28 shrink-0"
                value={row.key}
                onChange={(e) => update(row._rowId, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
              />
              <Input placeholder="Label shown to visitors" className="flex-1" value={row.label} onChange={(e) => update(row._rowId, { label: e.target.value })} />
              <Select className="w-28 shrink-0" value={row.type} onChange={(e) => update(row._rowId, { type: e.target.value as FormFieldTypeValue })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={row.required} onChange={(e) => update(row._rowId, { required: e.target.checked })} />
                Required
              </label>
              <Button type="button" variant="ghost" onClick={() => remove(row._rowId)} aria-label="Remove field">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            {row.type !== "hidden" && row.type !== "checkbox" && (
              <Input
                placeholder="Placeholder text (optional)"
                value={row.placeholder ?? ""}
                onChange={(e) => update(row._rowId, { placeholder: e.target.value || undefined })}
              />
            )}
            {OPTION_TYPES.has(row.type) && (
              <div>
                <textarea
                  className="w-full px-2 py-1.5 rounded-lg text-xs focus:outline-none"
                  style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  rows={3}
                  placeholder={"One option per line: value|Label shown to visitors\n(or just a value, used as the label too)"}
                  value={optionsToText(row.options)}
                  onChange={(e) => update(row._rowId, { options: textToOptions(e.target.value) })}
                />
              </div>
            )}
            {row.type === "number" && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  placeholder="Min (optional)"
                  value={row.min ?? ""}
                  onChange={(e) => update(row._rowId, { min: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
                <Input
                  type="number"
                  placeholder="Max (optional)"
                  value={row.max ?? ""}
                  onChange={(e) => update(row._rowId, { max: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </div>
            )}
            {otherKeys.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span className="shrink-0">Show only when</span>
                <Select
                  className="flex-1"
                  value={row.visibleWhen?.fieldKey ?? ""}
                  onChange={(e) => update(row._rowId, { visibleWhen: e.target.value ? { fieldKey: e.target.value, equals: row.visibleWhen?.equals ?? "" } : undefined })}
                >
                  <option value="">(always visible)</option>
                  {otherKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
                {row.visibleWhen && (
                  <>
                    <span className="shrink-0">equals</span>
                    <Input
                      className="flex-1"
                      value={row.visibleWhen.equals}
                      onChange={(e) => update(row._rowId, { visibleWhen: { fieldKey: row.visibleWhen!.fieldKey, equals: e.target.value } })}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      <Button type="button" variant="secondary" onClick={add}>
        <Plus className="w-3.5 h-3.5" /> Add field
      </Button>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        At least one field must use key "name" or "email" — a submission needs an identity to become a CRM Lead. A
        checkbox field keyed "consent" is tracked separately on each submission.
      </p>
    </div>
  );
};

const NotifyRecipientsPicker: React.FC<{ selected: string[]; onChange: (ids: string[]) => void }> = ({ selected, onChange }) => {
  const [users, setUsers] = useState<SanitizedUser[]>([]);
  useEffect(() => {
    void usersApi.list({ limit: 100 }).then((res) => setUsers(res.items));
  }, []);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  if (users.length === 0) return <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>No teammates to notify yet.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {users.map((u) => (
        <label
          key={u.id}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border cursor-pointer"
          style={selected.includes(u.id) ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" } : { color: "var(--text-secondary)", borderColor: "var(--border)" }}
        >
          <input type="checkbox" className="sr-only" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
          {u.displayName || `${u.firstName} ${u.lastName}`}
        </label>
      ))}
    </div>
  );
};

const FormFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; form?: MarketingForm }> = ({ open, onClose, onSaved, form }) => {
  const [name, setName] = useState(form?.name ?? "");
  const [slug, setSlug] = useState(form?.slug ?? "");
  const [successMessage, setSuccessMessage] = useState(form?.successMessage ?? "");
  const [rows, setRows] = useState<FieldRow[]>(() => toRows(form?.fields ?? [{ key: "name", label: "Full name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }]));
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>(form?.notifyUserIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(form?.name ?? "");
      setSlug(form?.slug ?? "");
      setSuccessMessage(form?.successMessage ?? "");
      setRows(toRows(form?.fields ?? [{ key: "name", label: "Full name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }]));
      setNotifyUserIds(form?.notifyUserIds ?? []);
      setError(null);
    }
  }, [open, form]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fields: FormFieldDef[] = rows.map(({ _rowId, ...f }) => f);
    try {
      if (form) {
        await formsApi.update(form.id, { name, fields, successMessage: successMessage || null, notifyUserIds });
      } else {
        await formsApi.create({ name, slug: slug || undefined, fields, successMessage: successMessage || undefined, notifyUserIds });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save form.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={form ? `Edit ${form.name}` : "New form"}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!form && (
          <Field label="Slug" hint="Leave blank to auto-generate. Used in the public submit URL and can't be changed here after creation.">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated" />
          </Field>
        )}
        <Field label="Fields">
          <FieldsEditor rows={rows} onChange={setRows} />
        </Field>
        <Field label="Success message" hint="Shown to a visitor after they submit. Falls back to a generic thank-you if left blank.">
          <Input value={successMessage} onChange={(e) => setSuccessMessage(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Notify" hint="In-app notification only — this platform has no email transport. Shows in each teammate's notification bell when a real submission lands.">
          <NotifyRecipientsPicker selected={notifyUserIds} onChange={setNotifyUserIds} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {form ? "Save changes" : "Create form"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const SubmissionsModal: React.FC<{ open: boolean; onClose: () => void; form?: MarketingForm }> = ({ open, onClose, form }) => {
  const [page, setPage] = useState(1);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !form) return;
    setPage(1);
  }, [open, form]);

  useEffect(() => {
    if (!open || !form) return;
    setLoading(true);
    void formsApi
      .listSubmissions(form.id, { page, limit: 10 })
      .then((res) => {
        setSubmissions(res.items);
        setTotalPages(res.totalPages);
      })
      .finally(() => setLoading(false));
  }, [open, form, page]);

  const handleExport = async () => {
    if (!form) return;
    await formsApi.downloadSubmissionsExport(form.id, `${form.slug}-submissions.csv`);
  };

  return (
    <Modal open={open} onClose={onClose} title={form ? `Submissions — ${form.name}` : "Submissions"}>
      {form && !loading && submissions.length > 0 && (
        <div className="flex justify-end mb-2">
          <Button type="button" variant="secondary" onClick={() => void handleExport()}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      )}
      {loading ? (
        <LoadingState />
      ) : submissions.length === 0 ? (
        <EmptyState title="No submissions yet" description="Submissions to this form's public endpoint will appear here." />
      ) : (
        <div className="space-y-2">
          {submissions.map((s) => (
            <div key={s.id} className="p-2.5 rounded-lg border text-xs" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-1">
                <span style={{ color: "var(--text-muted)" }}>{new Date(s.createdAt).toLocaleString()}</span>
                <div className="flex items-center gap-1.5">
                  {s.consentGiven !== null && <Badge tone={s.consentGiven ? "success" : "warning"}>{s.consentGiven ? "Consent given" : "Consent declined"}</Badge>}
                  {s.leadId ? <Badge tone="success">Lead created</Badge> : <Badge tone="neutral">No lead</Badge>}
                </div>
              </div>
              {Object.entries(s.data).map(([key, value]) => (
                <p key={key} style={{ color: "var(--text-secondary)" }}>
                  <span className="font-semibold">{key}:</span> {Array.isArray(value) ? value.join(", ") : value}
                </p>
              ))}
              {(s.utmSource || s.utmMedium || s.utmCampaign) && (
                <p className="mt-1" style={{ color: "var(--text-muted)" }}>
                  UTM: {[s.utmSource, s.utmMedium, s.utmCampaign].filter(Boolean).join(" / ")}
                </p>
              )}
              {s.landingPagePath && (
                <p style={{ color: "var(--text-muted)" }}>
                  Landing page: <span className="font-mono">{s.landingPagePath}</span>
                </p>
              )}
              {s.referrer && <p style={{ color: "var(--text-muted)" }}>Referrer: {s.referrer}</p>}
            </div>
          ))}
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </Modal>
  );
};

export const FormsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "forms.create");
  const canUpdate = hasPermission(user?.role.permissions, "forms.update");
  const canDelete = hasPermission(user?.role.permissions, "forms.delete");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [forms, setForms] = useState<MarketingForm[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; form?: MarketingForm }>({ open: false });
  const [submissionsFor, setSubmissionsFor] = useState<MarketingForm | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<MarketingForm | null>(null);

  useEffect(() => {
    if (consumeNewFlag()) setModal({ open: true });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await formsApi.list({ page, limit: 20, search: debouncedSearch || undefined });
      setForms(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load forms.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleStatus = async (form: MarketingForm) => {
    try {
      await formsApi.update(form.id, { status: form.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" });
      notify(form.status === "ACTIVE" ? "Form archived." : "Form restored.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update form.", "error");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await formsApi.remove(deleteTarget.id);
      notify("Form deleted.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete form.", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <ClipboardList className="w-5 h-5" /> Forms
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            A submission creates a real CRM Lead — POST /api/v1/public/forms/&lt;slug&gt;/submit.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setModal({ open: true })}>
            <Plus className="w-3.5 h-3.5" /> New form
          </Button>
        )}
      </div>

      <Card>
        <div className="p-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="relative max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <Input placeholder="Search forms…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : forms.length === 0 ? (
          <EmptyState title="No forms yet" description="Create a form to start capturing submissions as CRM Leads." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {forms.map((f) => (
              <li key={f.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                    {f.name}
                    <Badge tone={STATUS_TONE[f.status]}>{f.status}</Badge>
                  </p>
                  <p className="font-mono truncate" style={{ color: "var(--text-muted)" }}>
                    /{f.slug} · {f.fields.length} field{f.fields.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="ghost" onClick={() => setSubmissionsFor(f)} aria-label="View submissions">
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                  {canUpdate && (
                    <Button variant="ghost" onClick={() => setModal({ open: true, form: f })} aria-label="Edit form">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {canUpdate && (
                    <Button variant="ghost" onClick={() => void handleToggleStatus(f)} aria-label={f.status === "ACTIVE" ? "Archive form" : "Restore form"}>
                      {f.status === "ACTIVE" ? <Archive className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" onClick={() => setDeleteTarget(f)} aria-label="Delete form">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>

      <FormFormModal open={modal.open} onClose={() => setModal({ open: false })} onSaved={load} form={modal.form} />
      <SubmissionsModal open={!!submissionsFor} onClose={() => setSubmissionsFor(undefined)} form={submissionsFor} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete form"
        message={`Delete "${deleteTarget?.name}"? Its submission history will no longer be reachable from the Control Center.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
