/** Reviews: the rating trend we can read, the reviews that reach us, and replies (a person sends every one). Honest about which networks provide reviews at all. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { socialInboxApi, socialReviewsApi, type InboxCannedReply, type InboxStatus, type ListeningItem, type ReviewOverview } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Select } from "../ui/ui";
import { PRIORITY_LABEL, STATUS_LABEL, shortAgo } from "./socialInboxShared";
import { NotAvailable, TrendChart, fmtNumber, providerLabel } from "./socialAnalyticsShared";
import { ConversationView } from "./SocialInboxPage";

const STATUSES: InboxStatus[] = ["OPEN", "PENDING", "RESOLVED", "SPAM"];
const errMsg = (e: unknown) => (e instanceof ApiClientError || e instanceof Error ? e.message : "Something went wrong.");
const fmtRating = (n: number | null) => (n === null ? "—" : n.toFixed(1));

const AccountRating: React.FC<{ a: ReviewOverview["accounts"][number] }> = ({ a }) => {
  const ratingSeries = a.series.map((p) => ({ date: p.date, value: p.averageRating }));
  const hasNumbers = ratingSeries.some((p) => p.value !== null);
  return (
    <Card className="p-3 space-y-2" aria-label={`${a.displayName} rating`}>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{a.displayName}</p>
        <Badge tone="neutral">{providerLabel(a.provider)}</Badge>
        <Badge tone={a.reviewsAvailable ? "success" : "warning"}>{a.reviewsAvailable ? "Reviews available" : "No review feed"}</Badge>
      </div>
      {!a.reviewsAvailable && <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{a.reviewsReason}</p>}
      {a.latest && a.latest.averageRating !== null ? (
        <p className="text-sm" style={{ color: "var(--text-primary)" }}><strong>{fmtRating(a.latest.averageRating)}</strong> average from <strong>{fmtNumber(a.latest.reviewCount)}</strong> reviews <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>(as of {a.latest.date}, as reported by the network)</span></p>
      ) : (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{a.latest ? `No rating on ${a.latest.date}: ${a.latest.note ?? "the network returned none."}` : "No rating has been captured yet. The daily job records one value per day when the network provides it."}</p>
      )}
      {a.series.length > 0 && (hasNumbers ? <TrendChart series={ratingSeries} label={`${a.displayName} average rating`} /> : <NotAvailable reason={a.latest?.note ?? "The network returned no rating for this period."} />)}
    </Card>
  );
};

export const SocialReviewsPage: React.FC = () => {
  const { user } = useAuth();
  const { current } = useActiveWorkspace();
  const canRespond = hasPermission(user?.role.permissions, "social.reviews.respond");
  const canWork = hasPermission(user?.role.permissions, "social.reply");
  const [overview, setOverview] = useState<ReviewOverview | null>(null);
  const [items, setItems] = useState<ListeningItem[] | null>(null);
  const [status, setStatus] = useState<InboxStatus | "">("OPEN");
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [canned, setCanned] = useState<InboxCannedReply[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    socialReviewsApi.overview(90).then((o) => { setOverview(o); setError(null); }).catch((e) => setError(errMsg(e)));
    socialReviewsApi.list({ status: status || undefined, limit: 50 }).then((r) => setItems(r.items)).catch((e) => setError(errMsg(e)));
  }, [status]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { load(); }, [load, current?.organizationId]);
  useEffect(() => { const t = setInterval(() => loadRef.current(), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (canWork) { socialInboxApi.assignees().then(setPeople).catch(() => undefined); socialInboxApi.canned().then(setCanned).catch(() => undefined); }
  }, [current?.organizationId, canWork]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><Star className="w-5 h-5" style={{ color: "var(--accent)" }} /> Reviews</h1>
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>Ratings and reviews that the connected networks make available to apps. Nothing is estimated: a missing value shows as “—” with the reason. A person sends every reply; nothing is answered automatically.</p>
      </div>

      {error ? <ErrorState message={error} /> : overview === null ? <LoadingState /> : (
        <>
          <section aria-label="Where reviews come from" className="grid gap-3 md:grid-cols-2">
            {overview.accounts.length === 0 && <Card className="p-3 md:col-span-2"><EmptyState title="No social accounts connected" description="Connect an account under Social Media → Connected Accounts." /></Card>}
            {overview.accounts.map((a) => <AccountRating key={a.id} a={a} />)}
            <Card className="p-3 space-y-1" aria-label="Google Business Profile">
              <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>Google Business Profile <Badge tone="neutral">Not connected</Badge></p>
              <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{overview.google.reason}</p>
            </Card>
          </section>

          <div className="flex items-center gap-2">
            <Select aria-label="Filter reviews by status" value={status} onChange={(e) => setStatus(e.target.value as InboxStatus | "")} className="max-w-[12rem]"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
          </div>
          {items === null ? <LoadingState /> : (
            <div className="grid gap-3 lg:grid-cols-[minmax(320px,2fr)_3fr]">
              <Card className="overflow-hidden" aria-label="Reviews">
                {items.length === 0 ? <EmptyState title="No reviews" description="No review has reached this workspace. Facebook no longer shares Page reviews with apps and Google is not connected, so this list stays empty until a network that provides reviews is connected." /> : (
                  <ul className="divide-y max-h-[60vh] overflow-y-auto" style={{ borderColor: "var(--border)" }}>
                    {items.map((r) => (
                      <li key={r.id} style={{ background: selected === r.id ? "var(--accent-soft)" : undefined }}>
                        <button type="button" className="cc-row w-full text-left p-2 space-y-1" onClick={() => setSelected(r.id)} aria-current={selected === r.id}>
                          <span className="flex items-center gap-2"><span className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>{r.participant.name || r.participant.handle || "Reviewer"}</span><span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>{providerLabel(r.account.provider)} · {shortAgo(r.lastMessageAt)}</span></span>
                          <span className="block text-[11px] line-clamp-2" style={{ color: "var(--text-muted)" }}>{r.preview || "(no text provided)"}</span>
                          <span className="flex gap-1 flex-wrap">{r.crisis && <Badge tone="danger">Crisis words</Badge>}{r.sentiment === "negative" && <Badge tone="danger">Negative</Badge>}{(r.priority === "HIGH" || r.priority === "URGENT") && <Badge tone="warning">{PRIORITY_LABEL[r.priority]}</Badge>}{r.status !== "OPEN" && <Badge tone="neutral">{STATUS_LABEL[r.status]}</Badge>}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <div>
                {selected ? <ConversationView id={selected} canReply={canRespond} people={people} canned={canned} onChanged={load} onBack={() => setSelected(null)} narrow={false} reviewMode /> : <Card><EmptyState title="Select a review" description={canRespond ? "Pick a review to read it and send a reply you have approved." : "Pick a review to read it. Replying needs the “respond to reviews” permission."} /></Card>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
