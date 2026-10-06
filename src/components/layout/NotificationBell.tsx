/**
 * Phase 11 — Notifications. Polls the unread count every 60s (cheap: one
 * indexed COUNT query) and only fetches the actual list when the dropdown
 * opens. IN_APP only — there is no email/SMS delivery to configure here.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, CheckCheck } from "lucide-react";
import { notificationsApi, type AppNotification } from "../../lib/api";
import { Spinner } from "../ui/ui";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    notificationsApi
      .unreadCount()
      .then((res) => setUnreadCount(res.count))
      .catch(() => {
        /* transient — next poll retries */
      });
  }, []);

  useEffect(() => {
    refreshCount();
    const interval = setInterval(refreshCount, 60000);
    return () => clearInterval(interval);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    notificationsApi
      .list({ limit: 10 })
      .then((res) => setNotifications(res.items))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const handleMarkRead = async (id: string) => {
    await notificationsApi.markRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, status: "READ" } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, status: "READ" })));
    setUnreadCount(0);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        className="cc-ctl relative p-2"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="cc-popover absolute right-0 mt-1 w-80 max-w-[90vw] z-40 text-xs overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="flex items-center gap-1 text-[11px]" style={{ color: "var(--accent-soft-text)" }}>
                <CheckCheck className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-6 flex justify-center">
                <Spinner className="w-4 h-4" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="p-6 text-center" style={{ color: "var(--text-muted)" }}>
                No notifications yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className="px-3 py-2.5 flex items-start gap-2"
                    style={{ background: n.status === "UNREAD" ? "var(--accent-soft)" : "transparent" }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {n.title}
                      </p>
                      <p style={{ color: "var(--text-secondary)" }}>{n.message}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {timeAgo(n.createdAt)}
                      </p>
                    </div>
                    {n.status === "UNREAD" && (
                      <button onClick={() => handleMarkRead(n.id)} aria-label="Mark as read" className="shrink-0 p-1" style={{ color: "var(--text-muted)" }}>
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
