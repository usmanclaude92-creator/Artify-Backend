/**
 * Phase 10 (Products + Services + Solutions) — manages the two small,
 * platform-global reference tables a catalog item can be tagged with:
 * Product Categories and Industries. Deliberately a single lightweight
 * page (two tabs sharing one list/create/delete pattern) rather than two
 * separate modules — neither table has an independent lifecycle beyond
 * name/slug/description/order.
 */
import React, { useEffect, useState } from "react";
import { FolderTree, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { productCategoriesApi, industriesApi, type ProductCategory, type Industry } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, LoadingState, EmptyState, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

type Row = ProductCategory | Industry;

function TaxonomyTab<T extends Row>({
  label,
  canManage,
  list,
  create,
  remove,
}: {
  label: string;
  canManage: boolean;
  list: () => Promise<T[]>;
  create: (payload: { name: string; description?: string }) => Promise<T>;
  remove: (id: string) => Promise<void>;
}) {
  const { notify } = useToast();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    void list()
      .then(setRows)
      .finally(() => setLoading(false));
  }, [list]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await create({ name, description: description || undefined });
      notify(`${label} created.`, "success");
      setCreateOpen(false);
      setName("");
      setDescription("");
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : `Could not create ${label.toLowerCase()}.`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      notify(`${label} deleted.`, "success");
      load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : `Could not delete this ${label.toLowerCase()}.`, "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {label}
        </h3>
        {canManage && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> New {label.toLowerCase()}
          </Button>
        )}
      </div>
      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${label.toLowerCase()} yet`} description="" />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {r.name}
                </p>
                <p style={{ color: "var(--text-muted)" }}>
                  /{r.slug}
                  {r.description ? ` · ${r.description}` : ""}
                </p>
              </div>
              {canManage && (
                <Button variant="ghost" onClick={() => setDeleteTarget(r)} aria-label={`Delete ${r.name}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={`New ${label.toLowerCase()}`}>
        <form onSubmit={handleCreate} className="space-y-3">
          {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
          <Field label="Name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${label.toLowerCase()}`}
        message={`Delete "${deleteTarget?.name}"? This only succeeds if no product currently references it.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}

export const ProductTaxonomyPage: React.FC = () => {
  const { user } = useAuth();
  const canManageCategories = hasPermission(user?.role.permissions, "product_categories.manage");
  const canManageIndustries = hasPermission(user?.role.permissions, "industries.manage");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <FolderTree className="w-5 h-5" /> Categories & Industries
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Platform-wide taxonomy used to organize Products, Services, and Solutions.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <TaxonomyTab
          label="Category"
          canManage={canManageCategories}
          list={async () => (await productCategoriesApi.list()).categories}
          create={async (payload) => (await productCategoriesApi.create(payload)).category}
          remove={async (id) => void (await productCategoriesApi.delete(id))}
        />
        <TaxonomyTab
          label="Industry"
          canManage={canManageIndustries}
          list={async () => (await industriesApi.list()).industries}
          create={async (payload) => (await industriesApi.create(payload)).industry}
          remove={async (id) => void (await industriesApi.delete(id))}
        />
      </div>
    </div>
  );
};
