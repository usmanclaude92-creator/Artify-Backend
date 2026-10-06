/** Content Calendar: month and week views of scheduled social posts, status colours, filters, click to open, drag to reschedule. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { socialApi, socialContentApi, type SocialAccountSummary, type SocialPostStatus, type SocialPostView } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, Select, ErrorState } from "../ui/ui";
import { POST_STATUS_COLOR, POST_STATUS_LABEL, SCHEDULE_EDITABLE } from "./socialPostShared";

type View = "month" | "week";
const DAY_MS = 86400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function visibleRange(anchor: Date, view: View): { start: Date; days: number } {
  if (view === "week") return { start: startOfWeek(anchor), days: 7 };
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return { start: startOfWeek(first), days: 42 };
}

export const SocialCalendarPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const { current } = useActiveWorkspace();
  const canPublish = hasPermission(user?.role.permissions, "social.publish");

  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState<SocialPostStatus | "">("");
  const [accounts, setAccounts] = useState<SocialAccountSummary[]>([]);
  const [days, setDays] = useState<Record<string, SocialPostView[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);

  // Phones get an agenda list instead of a 7-column grid (a grid is unreadable at 390px).
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const range = useMemo(() => visibleRange(anchor, view), [anchor, view]);
  const cells = useMemo(() => Array.from({ length: range.days }, (_, i) => addDays(range.start, i)), [range]);

  useEffect(() => {
    void socialApi.list().then((r) => setAccounts(r.accounts)).catch(() => undefined);
  }, [current?.organizationId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = new Date(range.start.getTime() - DAY_MS).toISOString(); // pad a day for timezone edges
      const to = new Date(range.start.getTime() + (range.days + 1) * DAY_MS).toISOString();
      const res = await socialContentApi.calendar({ from, to, ...(accountId ? { accountId } : {}), ...(status ? { status } : {}) });
      setDays(res.days);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the calendar.");
    } finally {
      setLoading(false);
    }
  }, [range, accountId, status]);

  useEffect(() => {
    void load();
  }, [load, current?.organizationId]);

  // Group by the viewer's LOCAL day so a post shows on the day the user will see it happen.
  const byLocalDay = useMemo(() => {
    const out: Record<string, SocialPostView[]> = {};
    for (const p of Object.values(days).flat()) if (p.scheduledAt) (out[ymd(new Date(p.scheduledAt))] ??= []).push(p);
    for (const list of Object.values(out)) list.sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
    return out;
  }, [days]);

  const shift = (dir: -1 | 1) => setAnchor((a) => (view === "week" ? addDays(a, dir * 7) : new Date(a.getFullYear(), a.getMonth() + dir, 1)));

  const drop = async (target: Date) => {
    const id = dragId;
    setDragId(null);
    const post = Object.values(days).flat().find((p) => p.id === id);
    if (!post || !post.scheduledAt) return;
    const original = new Date(post.scheduledAt);
    if (ymd(original) === ymd(target)) return;
    const next = new Date(target.getFullYear(), target.getMonth(), target.getDate(), original.getHours(), original.getMinutes());
    try {
      await socialContentApi.reschedule(post.id, next.toISOString());
      notify("Post rescheduled.", "success");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not reschedule.", "error");
    }
  };

  const today = ymd(new Date());
  const title = view === "week" ? `${range.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(range.start, 6).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <CalendarDays className="w-5 h-5" /> Content Calendar
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Scheduled and planned posts. Drag a post to another day to reschedule it.
        </p>
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" aria-label="Previous" onClick={() => shift(-1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="secondary" aria-label="Next" onClick={() => shift(1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button variant="secondary" onClick={() => setAnchor(new Date())}>
          Today
        </Button>
        <span className="text-sm font-bold px-1" style={{ color: "var(--text-primary)" }} aria-live="polite">
          {title}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          <Select aria-label="View" value={view} onChange={(e) => setView(e.target.value as View)}>
            <option value="month">Month</option>
            <option value="week">Week</option>
          </Select>
          <Select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as SocialPostStatus | "")}>
            <option value="">All statuses</option>
            {(Object.keys(POST_STATUS_LABEL) as SocialPostStatus[]).map((s) => (
              <option key={s} value={s}>
                {POST_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </span>
      </Card>

      {error ? (
        <ErrorState message={error} />
      ) : narrow ? (
        <Card className="p-3 space-y-3" aria-busy={loading} aria-label="Agenda">
          {cells.filter((d) => (byLocalDay[ymd(d)] ?? []).length > 0 && (view === "week" || d.getMonth() === anchor.getMonth())).length === 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              No scheduled posts in this {view}.
            </p>
          )}
          {cells
            .filter((d) => (byLocalDay[ymd(d)] ?? []).length > 0 && (view === "week" || d.getMonth() === anchor.getMonth()))
            .map((d) => (
              <section key={ymd(d)} data-day={ymd(d)}>
                <h2 className="text-[11px] font-bold uppercase mb-1" style={{ color: ymd(d) === today ? "var(--accent-soft-text)" : "var(--text-muted)" }}>
                  {d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </h2>
                <ul className="space-y-1">
                  {(byLocalDay[ymd(d)] ?? []).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/social/compose?post=${p.id}`)}
                        aria-label={`${p.title}, ${POST_STATUS_LABEL[p.status]}, ${new Date(p.scheduledAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                        className="w-full text-left text-xs rounded-md px-2 py-2"
                        style={{ background: `${POST_STATUS_COLOR[p.status]}22`, color: "var(--text-primary)", borderLeft: `3px solid ${POST_STATUS_COLOR[p.status]}` }}
                      >
                        <span className="font-semibold">{new Date(p.scheduledAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> {p.title}
                        <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {POST_STATUS_LABEL[p.status]} · {p.targets.map((t) => t.account.displayName).join(", ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          {canPublish && (
            <Button variant="secondary" onClick={() => navigate("/social/compose")}>
              <Plus className="w-3.5 h-3.5" /> New post
            </Button>
          )}
        </Card>
      ) : (
        <Card className="p-2 overflow-x-auto" aria-busy={loading}>
          <div className="min-w-[640px]">
            <div className="grid grid-cols-7 text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px" style={{ background: "var(--border)" }} role="grid" aria-label="Calendar">
              {cells.map((d) => {
                const key = ymd(d);
                const posts = byLocalDay[key] ?? [];
                const outside = view === "month" && d.getMonth() !== anchor.getMonth();
                return (
                  <div
                    key={key}
                    role="gridcell"
                    data-day={key}
                    onDragOver={(e) => canPublish && e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void drop(d);
                    }}
                    className={`p-1.5 ${view === "week" ? "min-h-[10rem]" : "min-h-[6.5rem]"}`}
                    style={{ background: outside ? "var(--bg-surface-alt)" : "var(--bg-surface)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold" style={{ color: key === today ? "var(--accent-soft-text)" : outside ? "var(--text-muted)" : "var(--text-secondary)" }} aria-current={key === today ? "date" : undefined}>
                        {d.getDate()}
                      </span>
                      {canPublish && (
                        <button type="button" aria-label={`New post on ${key}`} className="cc-ctl p-0.5" onClick={() => navigate(`/social/compose?date=${key}`)}>
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <ul className="space-y-1 mt-1">
                      {posts.map((p) => {
                        const movable = canPublish && SCHEDULE_EDITABLE.includes(p.status);
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              draggable={movable}
                              onDragStart={() => setDragId(p.id)}
                              onClick={() => navigate(`/social/compose?post=${p.id}`)}
                              title={`${p.title} · ${POST_STATUS_LABEL[p.status]}`}
                              aria-label={`${p.title}, ${POST_STATUS_LABEL[p.status]}, ${new Date(p.scheduledAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                              className="w-full text-left text-[11px] rounded-md px-1.5 py-1 truncate"
                              style={{ background: `${POST_STATUS_COLOR[p.status]}22`, color: "var(--text-primary)", borderLeft: `3px solid ${POST_STATUS_COLOR[p.status]}`, cursor: movable ? "grab" : "pointer" }}
                            >
                              {new Date(p.scheduledAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {p.title}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      <ul className="flex flex-wrap gap-3 text-[11px]" aria-label="Status colours" style={{ color: "var(--text-muted)" }}>
        {(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHED", "REJECTED"] as SocialPostStatus[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: POST_STATUS_COLOR[s] }} aria-hidden="true" />
            {POST_STATUS_LABEL[s]}
          </li>
        ))}
      </ul>
    </div>
  );
};
