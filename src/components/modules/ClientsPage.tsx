/** Phase 5 §24-26 — Clients: list/search/filter/pagination + master-detail with embedded contact management. */
import React, { useEffect, useState } from "react";
import { Building2, Plus, Search, UserPlus, Star, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { clientsApi, contactsApi, type CrmClient, type CrmContact, type ClientStatusValue } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: ClientStatusValue[] = ["PROSPECT", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"];
const STATUS_TONE: Record<ClientStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PROSPECT: "info",
  ACTIVE: "success",
  INACTIVE: "neutral",
  SUSPENDED: "warning",
  ARCHIVED: "danger",
};

const ClientFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (client?: CrmClient) => void;
  mode: "create" | "edit";
  client?: CrmClient;
}> = ({ open, onClose, onSaved, mode, client }) => {
  const { notify } = useToast();
  const [clientCode, setClientCode] = useState(client?.clientCode ?? "");
  const [name, setName] = useState(client?.name ?? "");
  const [legalName, setLegalName] = useState(client?.legalName ?? "");
  const [status, setStatus] = useState<ClientStatusValue>(client?.status ?? "PROSPECT");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [website, setWebsite] = useState(client?.website ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setClientCode(client?.clientCode ?? "");
      setName(client?.name ?? "");
      setLegalName(client?.legalName ?? "");
      setStatus(client?.status ?? "PROSPECT");
      setEmail(client?.email ?? "");
      setPhone(client?.phone ?? "");
      setWebsite(client?.website ?? "");
      setAddress(client?.address ?? "");
      setNotes(client?.notes ?? "");
      setError(null);
    }
  }, [open, client]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await clientsApi.create({ clientCode, name, legalName, status, email, phone, website, address, notes });
        notify("Client created.", "success");
        onSaved(res.client);
      } else if (client) {
        const res = await clientsApi.update(client.id, { name, legalName, status, email, phone, website, address, notes });
        notify("Client updated.", "success");
        onSaved(res.client);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save client.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New client" : `Edit ${client?.name}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client code">
            <Input required disabled={mode === "edit"} value={clientCode} onChange={(e) => setClientCode(e.target.value)} />
          </Field>
          <Field label="Display name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Legal / business name">
          <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Website">
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ClientStatusValue)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create client" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ContactFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; clientId: string }> = ({
  open,
  onClose,
  onSaved,
  clientId,
}) => {
  const { notify } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setJobTitle("");
      setIsPrimary(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await clientsApi.addContact(clientId, { firstName, lastName, email, phone, jobTitle, isPrimary });
      notify("Contact added.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add contact.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add contact">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <Input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Job title">
          <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
          Set as primary contact
        </label>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Add contact
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ClientDetail: React.FC<{ client: CrmClient; onChanged: (c?: CrmClient) => void }> = ({ client, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "clients.update");
  const canDelete = hasPermission(user?.role.permissions, "clients.delete");
  const canCreateContact = hasPermission(user?.role.permissions, "contacts.create");
  const canUpdateContact = hasPermission(user?.role.permissions, "contacts.update");
  const canDeleteContact = hasPermission(user?.role.permissions, "contacts.delete");

  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [removeContact, setRemoveContact] = useState<CrmContact | null>(null);

  const loadContacts = React.useCallback(async () => {
    setContactsLoading(true);
    try {
      const res = await clientsApi.contacts(client.id, { limit: 50 });
      setContacts(res.items);
    } catch {
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  }, [client.id]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const handleMakePrimary = async (contact: CrmContact) => {
    try {
      await contactsApi.update(contact.id, { isPrimary: true });
      notify("Primary contact updated.", "success");
      void loadContacts();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update contact.", "error");
    }
  };

  const handleRemoveContact = async () => {
    if (!removeContact) return;
    try {
      await contactsApi.remove(removeContact.id);
      notify("Contact removed.", "success");
      void loadContacts();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not remove contact.", "error");
    } finally {
      setRemoveContact(null);
    }
  };

  const handleArchive = async () => {
    try {
      await clientsApi.remove(client.id);
      notify("Client archived.", "success");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive client.", "error");
    } finally {
      setArchiveOpen(false);
    }
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {client.name}
            <Badge tone={STATUS_TONE[client.status]}>{client.status}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {client.clientCode} {client.legalName ? `· ${client.legalName}` : ""}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {canUpdate && (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {canDelete && client.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 grid sm:grid-cols-2 gap-3 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Email</p>
          <p style={{ color: "var(--text-primary)" }}>{client.email ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Phone</p>
          <p style={{ color: "var(--text-primary)" }}>{client.phone ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Website</p>
          <p style={{ color: "var(--text-primary)" }}>{client.website ?? "—"}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Address</p>
          <p style={{ color: "var(--text-primary)" }}>{client.address ?? "—"}</p>
        </div>
        {client.notes && (
          <div className="sm:col-span-2">
            <p style={{ color: "var(--text-muted)" }}>Notes</p>
            <p style={{ color: "var(--text-primary)" }}>{client.notes}</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Contacts
        </h3>
        {canCreateContact && (
          <Button variant="primary" onClick={() => setAddContactOpen(true)}>
            <UserPlus className="w-3.5 h-3.5" /> Add contact
          </Button>
        )}
      </div>

      {contactsLoading ? (
        <LoadingState />
      ) : contacts.length === 0 ? (
        <EmptyState title="No contacts" description="Add a contact for this client." />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {contacts.map((c) => (
            <li key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                  {c.firstName} {c.lastName}
                  {c.isPrimary && <Badge tone="success">Primary</Badge>}
                </p>
                <p style={{ color: "var(--text-muted)" }}>
                  {c.jobTitle ?? "—"} {c.email ? `· ${c.email}` : ""}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {canUpdateContact && !c.isPrimary && (
                  <Button variant="secondary" onClick={() => void handleMakePrimary(c)}>
                    <Star className="w-3 h-3" /> Make primary
                  </Button>
                )}
                {canDeleteContact && (
                  <Button variant="danger" onClick={() => setRemoveContact(c)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ClientFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => onChanged(updated)}
        mode="edit"
        client={client}
      />
      <ContactFormModal open={addContactOpen} onClose={() => setAddContactOpen(false)} onSaved={loadContacts} clientId={client.id} />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive client"
        message={`Archive "${client.name}"? Historical records are preserved; the client will no longer appear as active.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
      <ConfirmDialog
        open={!!removeContact}
        title="Remove contact"
        message={`Remove ${removeContact?.firstName} ${removeContact?.lastName} from this client?`}
        confirmLabel="Remove"
        destructive
        onConfirm={handleRemoveContact}
        onCancel={() => setRemoveContact(null)}
      />
    </Card>
  );
};

export const ClientsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "clients.create");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<ClientStatusValue | "">("");
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [selected, setSelected] = useState<CrmClient | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await clientsApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setClients(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((c) => c.id === prev.id) ? res.items.find((c) => c.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clients.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Building2 className="w-5 h-5" /> Clients
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Manage client accounts and their contacts.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New client
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ClientStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : clients.length === 0 ? (
        <Card>
          <EmptyState title="No clients found" description="Create a client or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {clients.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selected?.id === c.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{c.name}</span>
                <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selected && <ClientDetail client={selected} onChanged={(updated) => (updated ? setSelected(updated) : void load())} />}
        </div>
      )}

      <ClientFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" />
    </div>
  );
};
