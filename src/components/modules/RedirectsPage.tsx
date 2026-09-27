/** Phase 5 — SEO Control Center: redirect management (searchable/paginated CRUD). */
import React, { useEffect, useState } from "react";
import { ArrowRightLeft, Plus, Trash2, Pencil, Search } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { redirectsApi, type CmsRedirect } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";

const STATUS_CODES = [301, 302, 307, 308] as const;

const RedirectFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; redirect?: CmsRedirect }> = ({
  open,
  onClose,
  onSaved,
  redirect,
}) => {
  const [fromPath, setFromPath] = useState(redirect?.fromPath ?? "");
  const [toPath, setToPath] = useState(redirect?.toPath ?? "");
  const [statusCode, setStatusCode] = useState<number>(redirect?.statusCode ?? 301);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFromPath(redirect?.fromPath ?? "");
      setToPath(redirect?.toPath ?? "");
      setStatusCode(redirect?.statusCode ?? 301);
      setError(null);
    }
  }, [open, redirect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (redirect) {
        await redirectsApi.update(redirect.id, { toPath, statusCode: statusCode as 301 | 302 | 307 | 308 });
      } else {
        await redirectsApi.create({ fromPath, toPath, statusCode: statusCode as 301 | 302 | 307 | 308 });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save redirect.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={redirect ? `Edit redirect from ${redirect.fromPath}` : "New redirect"}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="From path" hint="The old, site-relative URL people (or search engines) might still visit, e.g. /blog/old-slug.">
          <Input required disabled={!!redirect} placeholder="/blog/old-slug" value={fromPath} onChange={(e) => setFromPath(e.target.value)} />
        </Field>
        <Field label="To path" hint="Where visitors land instead, e.g. /blog/new-slug.">
          <Input required placeholder="/blog/new-slug" value={toPath} onChange={(e) => setToPath(e.target.value)} />
        </Field>
        <Field label="Status code" hint="301 (permanent) is right for almost every renamed-content case.">
          <Select value={statusCode} onChange={(e) => setStatusCode(Number(e.target.value))}>
            {STATUS_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const RedirectsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "seo.redirects.create");
  const canUpdate = hasPermission(user?.role.permissions, "seo.redirects.update");
  const canDelete = hasPermission(user?.role.permissions, "seo.redirects.delete");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [redirects, setRedirects] = useState<CmsRedirect[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; redirect?: CmsRedirect }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<CmsRedirect | null>(null);

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
      const res = await redirectsApi.list({ page, limit: 20, search: debouncedSearch || undefined });
      setRedirects(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load redirects.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await redirectsApi.remove(deleteTarget.id);
      notify("Redirect deleted.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete redirect.", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            Redirects
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Renaming a published post's slug creates one of these automatically — add your own for vanity URLs or migrated content.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setModal({ open: true })}>
            <Plus className="w-3.5 h-3.5" /> New redirect
          </Button>
        )}
      </div>

      <Card>
        <div className="p-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="relative max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <Input placeholder="Search paths…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : redirects.length === 0 ? (
          <EmptyState title="No redirects yet" description="Redirects created automatically or manually will appear here." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {redirects.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
                  <div className="min-w-0">
                    <p className="font-semibold font-mono truncate" style={{ color: "var(--text-primary)" }}>
                      {r.fromPath} <span style={{ color: "var(--text-muted)" }}>&rarr;</span> {r.toPath}
                    </p>
                    <p style={{ color: "var(--text-muted)" }}>
                      {r.resourceType ? `Auto-created from a ${r.resourceType} slug change` : "Manually created"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone="neutral">{r.statusCode}</Badge>
                  {canUpdate && (
                    <Button variant="ghost" onClick={() => setModal({ open: true, redirect: r })} aria-label="Edit redirect">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" onClick={() => setDeleteTarget(r)} aria-label="Delete redirect">
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

      <RedirectFormModal open={modal.open} onClose={() => setModal({ open: false })} onSaved={load} redirect={modal.redirect} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete redirect"
        message={`Delete the redirect from "${deleteTarget?.fromPath}"? Visitors to that path will see a 404 again.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
