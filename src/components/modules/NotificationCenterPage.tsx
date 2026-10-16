/**
 * Phase 16 — Notification Center (docs/AUTOMATION_ARCHITECTURE.md §6).
 * Full view over the same /notifications endpoints the header bell already
 * uses (Phase 11) — no parallel notification list, just a fuller one with
 * filtering and pagination the dropdown has no room for.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { notificationsApi, type AppNotification, type NotificationStatusValue } from "../../lib/api";
import { Card, Badge, Select, LoadingState, ErrorState, EmptyState, Pagination } from "../ui/ui";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { notificationLink } from "../../lib/notificationLinks";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A human label for the real entityType string an entity-linked notification carries. The jump link itself comes from lib/notificationLinks.ts. */
function entityLabel(entityType: string): string {
  return entityType.replace(/_/g, " ");
}

type Filter = "ALL" | NotificationStatusValue;

export const NotificationCenterPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await notificationsApi.list({ page, limit: 20, status: filter === "ALL" ? undefined : filter });
      setItems(res.items);
      setTotalPages(Math.max(1, res.totalPages));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMarkRead = async (id: string) => {
    await notificationsApi.markRead(id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, status: "READ" } : n)));
  };

  const handleOpen = async (n: AppNotification, path: string) => {
    if (n.status === "UNREAD") await handleMarkRead(n.id).catch(() => undefined);
    navigate(path);
  };

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Bell className="w-5 h-5" /> Notification Center
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Everything you've been notified about, in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as Filter);
              setPage(1);
            }}
          >
            <option value="ALL">All</option>
            <option value="UNREAD">Unread</option>
            <option value="READ">Read</option>
          </Select>
          <button onClick={() => void handleMarkAllRead()} className="flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--accent)" }}>
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : items.length === 0 ? (
          <EmptyState title="No notifications" description="Nothing here yet." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((n) => (
              <li
                key={n.id}
                className="px-4 py-3 flex items-start gap-3 text-xs"
                style={{ background: n.status === "UNREAD" ? "var(--accent-soft)" : "transparent" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {n.title}
                    </p>
                    {n.entityType && n.entityId && <Badge tone="info">{entityLabel(n.entityType)}</Badge>}
                  </div>
                  <p style={{ color: "var(--text-secondary)" }}>{n.message}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {formatTimestamp(n.createdAt)}
                  </p>
                  {(() => {
                    const link = notificationLink(n, user?.role.permissions);
                    return link ? (
                      <button
                        type="button"
                        onClick={() => void handleOpen(n, link.path)}
                        className="mt-1 text-[11px] font-semibold underline-offset-2 hover:underline"
                        style={{ color: "var(--accent)" }}
                        aria-label={`Open ${link.label}`}
                      >
                        Open {link.label} →
                      </button>
                    ) : null;
                  })()}
                </div>
                {n.status === "UNREAD" && (
                  <button onClick={() => void handleMarkRead(n.id)} aria-label="Mark as read" className="shrink-0 p-1" style={{ color: "var(--text-muted)" }}>
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
    </div>
  );
};
