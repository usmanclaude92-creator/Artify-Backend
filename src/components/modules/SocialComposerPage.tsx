/** Social Composer: write once, tune per account, check guardrails, get approval. Nothing here sends directly — scheduled posts are published by the scheduler. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PenSquare, Sparkles, Image as ImageIcon, X, AlertTriangle, CheckCircle2, Link2, Undo2, Save, Send, CalendarClock } from "lucide-react";
import {
  mediaApi, socialApi, socialContentApi,
  type CmsMedia, type SocialAccountSummary, type SocialConstraints, type SocialPostView, type SocialSourceContent,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, Modal, ReasonConfirmDialog } from "../ui/ui";
import { LiveLink } from "./SocialFailuresPage";
import { CONTENT_EDITABLE, PostStatusBadge, SCHEDULE_EDITABLE, countHashtags, timezoneOptions, utcToZonedLocal, zonedLocalToUtc } from "./socialPostShared";

const SHARED = "__shared__";

const MediaThumb: React.FC<{ media: Pick<CmsMedia, "id" | "originalFilename" | "mimeType">; size?: string }> = ({ media, size = "w-16 h-16" }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void mediaApi.getReadUrl(media.id).then((r) => !cancelled && setUrl(r.url)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [media.id]);
  return url && media.mimeType.startsWith("image/") ? (
    <img src={url} alt={media.originalFilename} className={`${size} rounded-lg object-cover`} />
  ) : (
    <span className={`${size} rounded-lg flex items-center justify-center`} style={{ background: "var(--bg-hover)" }} aria-label={media.originalFilename}>
      <ImageIcon className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
    </span>
  );
};

export const SocialComposerPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const perms = user?.role.permissions;
  const canPublish = hasPermission(perms, "social.publish");
  const canApprove = hasPermission(perms, "social.approve");

  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SocialAccountSummary[]>([]);
  const [constraints, setConstraints] = useState<Record<string, SocialConstraints>>({});
  const [post, setPost] = useState<SocialPostView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [mediaCache, setMediaCache] = useState<Record<string, CmsMedia>>({});
  const [linkUrl, setLinkUrl] = useState("");
  const [source, setSource] = useState<{ type: "post" | "case_study"; id: string } | undefined>();
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [localSchedule, setLocalSchedule] = useState("");
  const [tab, setTab] = useState<string>(SHARED);
  const [dirty, setDirty] = useState(false);

  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaList, setMediaList] = useState<CmsMedia[]>([]);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceType, setSourceType] = useState<"post" | "case_study">("post");
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceItems, setSourceItems] = useState<SocialSourceContent[]>([]);
  const [instruction, setInstruction] = useState("");
  const [language, setLanguage] = useState("");
  const [undoBody, setUndoBody] = useState<{ accountId: string | null; text: string } | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const status = post?.status;
  const editable = !post || CONTENT_EDITABLE.includes(post.status);
  const scheduleEditable = !post || SCHEDULE_EDITABLE.includes(post.status);
  const zones = useMemo(() => timezoneOptions(), []);

  const applyPost = useCallback((p: SocialPostView) => {
    setPost(p);
    setTitle(p.title);
    setBody(p.body);
    setOverrides(Object.fromEntries(p.targets.filter((t) => t.bodyOverride).map((t) => [t.accountId, t.bodyOverride!])));
    setAccountIds(p.targets.map((t) => t.accountId));
    setMediaIds(p.mediaIds);
    setLinkUrl(p.linkUrl ?? "");
    setSource(p.sourceContentType && p.sourceContentId ? { type: p.sourceContentType as "post" | "case_study", id: p.sourceContentId } : undefined);
    setTimezone(p.timezone);
    setLocalSchedule(p.scheduledAt ? utcToZonedLocal(p.scheduledAt, p.timezone) : "");
    setDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [acc, cons] = await Promise.all([socialApi.list(), socialContentApi.constraints()]);
        if (cancelled) return;
        setAccounts(acc.accounts.filter((a) => a.status !== "DISCONNECTED"));
        setConstraints(cons);
        const id = query.get("post");
        if (id) applyPost(await socialContentApi.getPost(id));
        else if (query.get("date")) setLocalSchedule(`${query.get("date")}T10:00`);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the composer.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPost, query]);

  // Media metadata for thumbnails of already-attached files.
  useEffect(() => {
    const missing = mediaIds.filter((id) => !mediaCache[id]);
    if (missing.length === 0) return;
    void Promise.all(missing.map((id) => mediaApi.get(id).catch(() => null))).then((rows) => setMediaCache((c) => ({ ...c, ...Object.fromEntries(rows.filter((r): r is CmsMedia => !!r).map((r) => [r.id, r])) })));
  }, [mediaIds, mediaCache]);

  const selectedAccounts = accounts.filter((a) => accountIds.includes(a.id));
  const textFor = (accountId: string) => overrides[accountId] ?? body;
  const activeAccount = tab === SHARED ? null : accounts.find((a) => a.id === tab) ?? null;
  const activeText = activeAccount ? (overrides[activeAccount.id] ?? "") : body;
  const activeConstraint = activeAccount ? constraints[activeAccount.id] : selectedAccounts.length ? selectedAccounts.map((a) => constraints[a.id]).filter(Boolean).sort((x, y) => x!.maxChars - y!.maxChars)[0] : undefined;
  const previewText = activeAccount ? textFor(activeAccount.id) : body;

  const liveWarnings = useMemo(() => {
    const out: string[] = [];
    for (const a of selectedAccounts) {
      const c = constraints[a.id];
      if (!c) continue;
      const text = textFor(a.id);
      if (text.length > c.maxChars) out.push(`${a.displayName}: ${text.length}/${c.maxChars} characters`);
      if (countHashtags(text, c.hashtagPrefix) > c.maxHashtags) out.push(`${a.displayName}: more than ${c.maxHashtags} hashtags`);
      if (c.requiresMedia && mediaIds.length === 0) out.push(`${a.displayName}: needs an image or video`);
      if (mediaIds.length > c.maxMedia) out.push(`${a.displayName}: at most ${c.maxMedia} media`);
      for (const id of mediaIds) {
        const m = mediaCache[id];
        if (!m) continue;
        if (c.allowedMediaTypes.length && !c.allowedMediaTypes.includes(m.mimeType)) out.push(`${a.displayName}: ${m.originalFilename} is ${m.mimeType}; allowed: ${c.allowedMediaTypes.join(", ")}`);
        if (c.mediaLimits?.imageMaxBytes && m.mimeType.startsWith("image/") && Number(m.sizeBytes) > c.mediaLimits.imageMaxBytes) out.push(`${a.displayName}: ${m.originalFilename} is over ${Math.round(c.mediaLimits.imageMaxBytes / 1048576)} MB`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccounts, constraints, body, overrides, mediaIds, mediaCache]);

  const touch = () => setDirty(true);
  const setActiveText = (v: string) => {
    touch();
    if (activeAccount) setOverrides((o) => (v ? { ...o, [activeAccount.id]: v } : Object.fromEntries(Object.entries(o).filter(([k]) => k !== activeAccount.id))));
    else setBody(v);
  };

  const buildInput = () => ({
    title: title.trim() || "Untitled post",
    body,
    mediaIds,
    linkUrl: linkUrl.trim() || null,
    scheduledAt: localSchedule ? zonedLocalToUtc(localSchedule, timezone).toISOString() : null,
    timezone,
    accountIds,
    bodyOverrides: Object.fromEntries(Object.entries(overrides).filter(([id]) => accountIds.includes(id))),
    ...(source ? { sourceContent: source } : {}),
  });

  const save = async (silent = false): Promise<SocialPostView | null> => {
    setBusy("save");
    try {
      const saved = post ? await socialContentApi.updatePost(post.id, buildInput()) : await socialContentApi.createPost(buildInput());
      applyPost(saved);
      if (!post) window.history.replaceState({}, "", `/social/compose?post=${saved.id}`);
      if (!silent) notify("Draft saved.", "success");
      return saved;
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not save the post.", "error");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runAction = async (action: "submit" | "withdraw" | "reopen" | "cancel" | "unschedule" | "approve" | "reject" | "schedule", extra: { comment?: string; scheduledAt?: string; timezone?: string } = {}) => {
    setBusy(action);
    let id = post?.id;
    try {
      if (editable && (dirty || !post)) {
        const saved = await save(true);
        if (!saved) return;
        id = saved.id;
      }
      applyPost(await socialContentApi.action(id!, action, extra));
      notify(
        { submit: "Submitted for approval.", withdraw: "Moved back to draft.", reopen: "Reopened as a draft.", cancel: "Post cancelled.", unschedule: "Unscheduled.", approve: "Approved.", reject: "Rejected.", schedule: "Scheduled. It will be published automatically at that time if publishing is enabled." }[action],
        "success"
      );
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "That action failed.", "error");
      if (id) void socialContentApi.getPost(id).then(applyPost).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const openMediaPicker = async () => {
    setMediaOpen(true);
    try {
      const res = await mediaApi.list({ status: "ACTIVE", limit: 30 });
      setMediaList(res.items.filter((m) => m.mimeType.startsWith("image/")));
    } catch {
      setMediaList([]);
    }
  };
  const toggleMedia = (m: CmsMedia) => {
    touch();
    setMediaCache((c) => ({ ...c, [m.id]: m }));
    setMediaIds((ids) => (ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id]));
  };

  useEffect(() => {
    if (!sourceOpen) return;
    const t = setTimeout(() => void socialContentApi.contentSources(sourceType, sourceSearch || undefined).then(setSourceItems).catch(() => setSourceItems([])), 200);
    return () => clearTimeout(t);
  }, [sourceOpen, sourceType, sourceSearch]);
  const pickSource = (item: SocialSourceContent) => {
    touch();
    setSource({ type: item.type, id: item.id });
    setLinkUrl(item.url);
    if (!title.trim()) setTitle(item.title);
    if (!body.trim()) setBody(`${item.title}\n\n${item.excerpt}\n\n${item.url}`.slice(0, 2000));
    if (item.featuredMediaId && !mediaIds.includes(item.featuredMediaId)) setMediaIds((ids) => [...ids, item.featuredMediaId!]);
    setSourceOpen(false);
  };

  const aiDraft = async () => {
    if (!instruction.trim() || accountIds.length === 0) return;
    setBusy("ai-draft");
    try {
      const res = await socialContentApi.aiDraft({ instruction: instruction.trim(), accountIds, ...(source ? { sourceContent: source } : {}), ...(language ? { language } : {}) });
      applyPost(res.post);
      window.history.replaceState({}, "", `/social/compose?post=${res.post.id}`);
      notify("AI draft created. Review it, then submit for approval.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "AI drafting failed.", "error");
    } finally {
      setBusy(null);
    }
  };
  const aiRewrite = async (action: "rewrite" | "shorten" | "translate") => {
    if (action === "translate" && !language.trim()) {
      notify("Enter a language to translate into.", "error");
      return;
    }
    setBusy(`ai-${action}`);
    try {
      let id = post?.id;
      if (dirty || !post) {
        const saved = await save(true);
        if (!saved) return;
        id = saved.id;
      }
      const res = await socialContentApi.aiRewrite(id!, { action, ...(language ? { language } : {}), ...(activeAccount ? { accountId: activeAccount.id } : {}) });
      setUndoBody({ accountId: activeAccount?.id ?? null, text: res.previousBody });
      applyPost(res.post);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "AI action failed.", "error");
    } finally {
      setBusy(null);
    }
  };
  const undoAi = async () => {
    if (!undoBody || !post) return;
    const saved = await socialContentApi.updatePost(post.id, undoBody.accountId ? { bodyOverrides: { ...overrides, [undoBody.accountId]: undoBody.text } } : { body: undoBody.text });
    applyPost(saved);
    setUndoBody(null);
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  const issues = post?.guardrailResult?.issues ?? [];
  const blockers = issues.filter((i) => i.severity === "block");
  const connectedOnly = accounts.filter((a) => a.status !== "DISCONNECTED");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <PenSquare className="w-5 h-5" /> {post ? "Edit post" : "New post"} {status && <PostStatusBadge status={status} />}
            {post?.aiGenerated && <Badge tone="info">AI draft</Badge>}
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Posts are never sent from here. Scheduled posts are published by the scheduler when publishing is enabled for this workspace.
          </p>
        </div>
      </div>

      {post && post.targets.some((t) => t.externalUrl) && (
        <Card className="p-3 text-xs space-y-1" aria-label="Published links">
          {post.targets.filter((t) => t.externalUrl).map((t) => (
            <p key={t.id}>{t.account.displayName}: <LiveLink url={t.externalUrl!} /></p>
          ))}
        </Card>
      )}

      {post?.status === "REJECTED" && post.rejectionReason && (
        <Card className="p-3 text-xs" role="alert" style={{ borderColor: "#e11d48" }}>
          <strong>Rejected:</strong> {post.rejectionReason}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 space-y-3">
            <label className="block text-xs font-semibold" htmlFor="post-title" style={{ color: "var(--text-secondary)" }}>
              Internal name
            </label>
            <Input id="post-title" value={title} disabled={!editable} onChange={(e) => { setTitle(e.target.value); touch(); }} placeholder="e.g. Spring launch announcement" />

            <fieldset>
              <legend className="text-xs font-semibold mb-1.5" style={{ color: "var(--text-secondary)" }}>
                Accounts
              </legend>
              {connectedOnly.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  No connected accounts yet.{" "}
                  <button type="button" className="underline" onClick={() => navigate("/social/accounts")}>
                    Connect one
                  </button>
                  .
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {connectedOnly.map((a) => (
                    <label key={a.id} className="cc-field flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer">
                      <input type="checkbox" disabled={!editable} checked={accountIds.includes(a.id)} onChange={() => { setAccountIds((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id])); touch(); }} />
                      <span style={{ color: "var(--text-primary)" }}>{a.displayName}</span>
                      {a.status !== "CONNECTED" && <Badge tone="warning">needs reconnect</Badge>}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div role="tablist" aria-label="Text per account" className="flex gap-1 overflow-x-auto">
              {[{ id: SHARED, label: "Shared text" }, ...selectedAccounts.map((a) => ({ id: a.id, label: a.displayName }))].map((t) => (
                <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="cc-nav-item !w-auto !px-3 !py-1.5 shrink-0" aria-current={tab === t.id ? "page" : undefined}>
                  {t.label}
                </button>
              ))}
            </div>

            <label className="sr-only" htmlFor="post-body">
              Post text
            </label>
            <textarea
              id="post-body"
              value={activeText}
              disabled={!editable}
              onChange={(e) => setActiveText(e.target.value)}
              rows={7}
              placeholder={activeAccount ? "Leave empty to use the shared text for this account." : "Write your post…"}
              className="cc-field w-full px-3 py-2 text-sm focus:outline-none"
              style={{ color: "var(--text-primary)" }}
            />
            <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }} aria-live="polite">
              <span>
                {(activeAccount ? previewText : activeText).length}
                {activeConstraint ? ` / ${activeConstraint.maxChars}` : ""} characters · {countHashtags(previewText, activeConstraint?.hashtagPrefix)} hashtags
              </span>
              {activeConstraint && previewText.length > activeConstraint.maxChars && <span style={{ color: "#e11d48" }}>Over the limit</span>}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" disabled={!editable} onClick={() => void openMediaPicker()}>
                  <ImageIcon className="w-3.5 h-3.5" /> Add media
                </Button>
                <Button variant="secondary" disabled={!editable} onClick={() => setSourceOpen(true)}>
                  <Link2 className="w-3.5 h-3.5" /> Share a blog post / case study
                </Button>
              </div>
              {selectedAccounts.filter((a) => constraints[a.id]?.notes?.length).map((a) => (
                <div key={a.id} className="text-[11px] rounded-lg p-2" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }} aria-label={`${a.displayName} media requirements`}>
                  <p className="font-bold" style={{ color: "var(--text-primary)" }}>{a.displayName}: media requirements</p>
                  <ul className="list-disc pl-4 space-y-0.5">{constraints[a.id]!.notes!.map((n) => <li key={n}>{n}</li>)}</ul>
                </div>
              ))}
              {mediaIds.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {mediaIds.map((id) => (
                    <li key={id} className="relative">
                      {mediaCache[id] ? <MediaThumb media={mediaCache[id]!} /> : <span className="w-16 h-16 rounded-lg block" style={{ background: "var(--bg-hover)" }} />}
                      {editable && (
                        <button type="button" aria-label="Remove media" className="absolute -top-1.5 -right-1.5 rounded-full p-0.5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }} onClick={() => { setMediaIds((m) => m.filter((x) => x !== id)); touch(); }}>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <label className="block text-xs font-semibold" htmlFor="post-link" style={{ color: "var(--text-secondary)" }}>
                Link (optional)
              </label>
              <Input id="post-link" value={linkUrl} disabled={!editable} onChange={(e) => { setLinkUrl(e.target.value); touch(); }} placeholder="https://" />
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <CalendarClock className="w-4 h-4" /> Schedule
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold mb-1" htmlFor="post-when" style={{ color: "var(--text-secondary)" }}>
                  Date and time
                </label>
                <Input id="post-when" type="datetime-local" value={localSchedule} disabled={!scheduleEditable} onChange={(e) => { setLocalSchedule(e.target.value); touch(); }} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" htmlFor="post-tz" style={{ color: "var(--text-secondary)" }}>
                  Timezone
                </label>
                <Select id="post-tz" value={timezone} disabled={!scheduleEditable} onChange={(e) => { setTimezone(e.target.value); touch(); }}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap gap-2">
            {canPublish && editable && (
              <>
                <Button variant="secondary" disabled={busy !== null} onClick={() => void save()}>
                  <Save className="w-3.5 h-3.5" /> Save draft
                </Button>
                <Button variant="primary" disabled={busy !== null || accountIds.length === 0} onClick={() => void runAction("submit")}>
                  <Send className="w-3.5 h-3.5" /> Submit for approval
                </Button>
              </>
            )}
            {canPublish && status === "PENDING_APPROVAL" && (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void runAction("withdraw")}>
                Withdraw
              </Button>
            )}
            {canApprove && status === "PENDING_APPROVAL" && (
              <>
                <Button variant="primary" disabled={busy !== null} onClick={() => void runAction("approve")}>
                  Approve
                </Button>
                <Button variant="danger" disabled={busy !== null} onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
              </>
            )}
            {canPublish && status === "APPROVED" && (
              <Button variant="primary" disabled={busy !== null || !localSchedule} onClick={() => void runAction("schedule", { scheduledAt: zonedLocalToUtc(localSchedule, timezone).toISOString(), timezone })}>
                <CalendarClock className="w-3.5 h-3.5" /> Schedule
              </Button>
            )}
            {canPublish && status === "SCHEDULED" && (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void runAction("unschedule")}>
                Unschedule
              </Button>
            )}
            {canPublish && (status === "REJECTED" || status === "CANCELLED" || status === "FAILED") && (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void runAction("reopen")}>
                Reopen as draft
              </Button>
            )}
            {canPublish && post && !["CANCELLED", "PUBLISHED", "PUBLISHING"].includes(post.status) && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => void runAction("cancel")}>
                Cancel post
              </Button>
            )}
            {canPublish && scheduleEditable && !editable && post && (
              <Button variant="secondary" disabled={busy !== null || !dirty} onClick={() => void socialContentApi.reschedule(post.id, localSchedule ? zonedLocalToUtc(localSchedule, timezone).toISOString() : null, timezone).then(applyPost).then(() => notify("Schedule updated.", "success")).catch((e) => notify(e instanceof ApiClientError ? e.message : "Could not reschedule.", "error"))}>
                Update schedule
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <Card className="p-4 space-y-2" aria-label="Preview">
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Preview{activeAccount ? ` · ${activeAccount.displayName}` : ""}
            </h2>
            <div className="cc-field p-3 space-y-2">
              <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                {activeAccount?.displayName ?? selectedAccounts[0]?.displayName ?? "Your account"}
                <span className="font-normal" style={{ color: "var(--text-muted)" }}> {activeAccount?.handle ?? ""}</span>
              </p>
              <p className="text-sm whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>
                {previewText || "Your post text appears here."}
              </p>
              {linkUrl && (
                <p className="text-xs break-all" style={{ color: "var(--accent-soft-text)" }}>
                  {linkUrl}
                </p>
              )}
              {mediaIds.length > 0 && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{mediaIds.length} media attached</p>}
            </div>
          </Card>

          <Card className="p-4 space-y-2" aria-label="Guardrails">
            <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              {blockers.length || liveWarnings.length ? <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />}
              Guardrails
            </h2>
            {liveWarnings.map((w) => (
              <p key={w} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                ⚠ {w}
              </p>
            ))}
            {issues.map((i, n) => (
              <p key={`${i.rule}-${n}`} className="text-xs" style={{ color: i.severity === "block" ? "#e11d48" : "var(--text-secondary)" }}>
                {i.severity === "block" ? "⛔" : "⚠"} {i.message}
              </p>
            ))}
            {!issues.length && !liveWarnings.length && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {post ? "No issues found on the last save." : "Checks run when you save: banned words, disclaimers, length, media, links and duplicates."}
              </p>
            )}
            {post?.guardrailResult && !post.guardrailResult.passed && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Blocking issues must be fixed before the post can be submitted or scheduled.</p>}
          </Card>

          {canPublish && editable && (
            <Card className="p-4 space-y-2" aria-label="AI assist">
              <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} /> AI assist
              </h2>
              <label className="block text-xs font-semibold" htmlFor="ai-instruction" style={{ color: "var(--text-secondary)" }}>
                What should this post say?
              </label>
              <textarea id="ai-instruction" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} className="cc-field w-full px-3 py-2 text-sm focus:outline-none" style={{ color: "var(--text-primary)" }} placeholder="e.g. Announce our spring launch, friendly tone" />
              <Button variant="primary" disabled={busy !== null || !instruction.trim() || accountIds.length === 0} onClick={() => void aiDraft()}>
                <Sparkles className="w-3.5 h-3.5" /> {busy === "ai-draft" ? "Drafting…" : "Draft with AI"}
              </Button>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                AI saves a new draft in your brand voice. It never publishes; approval still applies.
              </p>
              <div className="pt-2 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  Improve current text{activeAccount ? ` (${activeAccount.displayName})` : ""}
                </p>
                <Input aria-label="Translate to language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language for translation, e.g. French" />
                <div className="flex flex-wrap gap-2">
                  {(["rewrite", "shorten", "translate"] as const).map((a) => (
                    <Button key={a} variant="secondary" disabled={busy !== null || !(activeAccount ? previewText : body).trim()} onClick={() => void aiRewrite(a)}>
                      {a === "rewrite" ? "Rewrite" : a === "shorten" ? "Shorten" : "Translate"}
                    </Button>
                  ))}
                </div>
                {undoBody && (
                  <Button variant="ghost" onClick={() => void undoAi()}>
                    <Undo2 className="w-3.5 h-3.5" /> Undo AI change
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal open={mediaOpen} onClose={() => setMediaOpen(false)} title="Choose media">
        {mediaList.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            No images available. Upload some in the Media Library first.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto">
            {mediaList.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => toggleMedia(m)} aria-pressed={mediaIds.includes(m.id)} aria-label={m.originalFilename} className="rounded-lg p-1 w-full" style={{ outline: mediaIds.includes(m.id) ? "2px solid var(--accent)" : "none" }}>
                  <MediaThumb media={m} size="w-full h-20" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="pt-3 border-t flex justify-end" style={{ borderColor: "var(--border)" }}>
          <Button variant="primary" onClick={() => setMediaOpen(false)}>
            Done
          </Button>
        </div>
      </Modal>

      <Modal open={sourceOpen} onClose={() => setSourceOpen(false)} title="Share existing content">
        <div className="flex gap-2">
          <Select aria-label="Content type" value={sourceType} onChange={(e) => setSourceType(e.target.value as "post" | "case_study")}>
            <option value="post">Blog posts</option>
            <option value="case_study">Case studies</option>
          </Select>
          <Input aria-label="Search content" value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} placeholder="Search published content…" />
        </div>
        <ul className="max-h-64 overflow-y-auto divide-y" style={{ borderColor: "var(--border)" }}>
          {sourceItems.length === 0 && (
            <li className="py-3 text-xs" style={{ color: "var(--text-muted)" }}>
              No published content found.
            </li>
          )}
          {sourceItems.map((item) => (
            <li key={item.id}>
              <button type="button" className="cc-row w-full text-left py-2 px-1" onClick={() => pickSource(item)}>
                <span className="block text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {item.title}
                </span>
                <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                  {item.excerpt}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <ReasonConfirmDialog
        open={rejectOpen}
        title="Reject post"
        message="Tell the author what to change."
        reasonLabel="Comment"
        confirmLabel="Reject"
        onCancel={() => setRejectOpen(false)}
        onConfirm={(reason) => {
          setRejectOpen(false);
          void runAction("reject", { comment: reason });
        }}
      />
    </div>
  );
};
