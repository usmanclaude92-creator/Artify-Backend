/** Phase 12 — shared CRM activity-timeline viewer (Leads/Opportunities/Clients). Real audit log rows only, via each resource's own :id/activity endpoint. */
import React, { useEffect, useState } from "react";
import type { AuditLogEntry } from "../../lib/api";
import { Modal, Badge, LoadingState, ErrorState, EmptyState } from "../ui/ui";

const ACTION_LABEL: Record<string, string> = {
  LEAD_CREATED: "Lead created",
  LEAD_UPDATED: "Lead updated",
  LEAD_ARCHIVED: "Lead archived",
  LEAD_CONVERTED: "Lead converted to client",
  CLIENT_CREATED: "Client created",
  CLIENT_UPDATED: "Client updated",
  CLIENT_ARCHIVED: "Client archived",
  OPPORTUNITY_CREATED: "Opportunity created",
  OPPORTUNITY_UPDATED: "Opportunity updated",
  OPPORTUNITY_DELETED: "Opportunity deleted",
  OPPORTUNITY_WON: "Opportunity won",
  OPPORTUNITY_LOST: "Opportunity lost",
  OPPORTUNITY_CLIENT_LINKED: "Client linked to opportunity",
  FORM_SUBMITTED: "Form submitted",
};

function describe(entry: AuditLogEntry): string {
  return ACTION_LABEL[entry.action] ?? entry.action;
}

export const ActivityTimelineModal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  load: () => Promise<{ activity: AuditLogEntry[] }>;
}> = ({ open, onClose, title, load }) => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((res) => {
        if (!cancelled) setEntries(res.activity);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load activity."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : entries.length === 0 ? (
        <EmptyState title="No activity yet" description="Actions on this record will appear here." />
      ) : (
        <ul className="space-y-2 max-h-96 overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 text-xs pb-2 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                  {describe(entry)}
                </p>
                <p style={{ color: "var(--text-muted)" }}>{entry.actorName ?? entry.actorType}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {entry.result === "FAILURE" && <Badge tone="danger">Failed</Badge>}
                <span style={{ color: "var(--text-muted)" }}>{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
