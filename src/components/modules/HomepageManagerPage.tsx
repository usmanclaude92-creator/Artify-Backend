/**
 * Phase 5 (Navigation + Pages + Homepage) — Homepage Manager: a focused,
 * safe control for the one `isHomepage: true` page an organization may
 * have (the DB-level constraint — pages_one_homepage_per_org — and its
 * ConflictError translation already exist in pageService.ts; this page
 * is just a purpose-built UI over the same pagesApi.update(isHomepage)
 * call PagesPage.tsx could already make, not a new mechanism).
 *
 * Safety: switching requires picking an existing PUBLISHED page and
 * confirming — never creates or writes page content itself, so a blank/
 * broken homepage is structurally impossible here (worst case: no
 * homepage designated, which the public API already treats as "keep
 * rendering the existing static homepage," see publicSiteService.getHomepage).
 * "Rollback" is just switching back, exactly like any other reassignment —
 * the previous homepage's own content/history is never touched.
 */
import React, { useEffect, useState } from "react";
import { Home, Eye, RefreshCw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { pagesApi, type CmsPage } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Select, Badge, LoadingState, ErrorState, EmptyState, Modal, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { BlockTreeRenderer } from "../common/BlockRenderer";

export const HomepageManagerPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const canUpdate = hasPermission(user?.role.permissions, "content.update");

  const [pages, setPages] = useState<CmsPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [switching, setSwitching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPage, setPreviewPage] = useState<CmsPage | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // All pages, newest-updated first — the homepage candidate list and
      // the "current homepage" lookup both read from this one fetch.
      const res = await pagesApi.list({ limit: 100, sort: "updatedAt", order: "desc" });
      setPages(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentHomepage = pages.find((p) => p.isHomepage) ?? null;
  const candidates = pages.filter((p) => !p.isHomepage && p.status === "PUBLISHED");

  const handleOpenPreview = (page: CmsPage) => {
    setPreviewPage(page);
    setPreviewOpen(true);
  };

  const handleSwitch = async () => {
    if (!candidateId) return;
    setConfirmOpen(false);
    setSwitching(true);
    try {
      // Unset the current homepage first — the DB allows only one at a
      // time, so a direct promote-without-unset would 409.
      if (currentHomepage) {
        await pagesApi.update(currentHomepage.id, { isHomepage: false });
      }
      await pagesApi.update(candidateId, { isHomepage: true });
      notify("Homepage switched.", "success");
      setCandidateId("");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not switch the homepage.", "error");
    } finally {
      setSwitching(false);
    }
  };

  const handleUnset = async () => {
    if (!currentHomepage) return;
    setSwitching(true);
    try {
      await pagesApi.update(currentHomepage.id, { isHomepage: false });
      notify("Homepage unassigned. The public site falls back to its default homepage.", "success");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not unassign the homepage.", "error");
    } finally {
      setSwitching(false);
    }
  };

  const candidatePage = pages.find((p) => p.id === candidateId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Home className="w-5 h-5" /> Homepage
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Choose which published page the public site resolves as its homepage. Leave unassigned to keep the site's existing default homepage.
        </p>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <Card className="p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Current homepage
            </p>
            {currentHomepage ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {currentHomepage.title}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    /{currentHomepage.slug} ·{" "}
                    <Badge tone={currentHomepage.status === "PUBLISHED" ? "success" : "neutral"}>{currentHomepage.status}</Badge>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => handleOpenPreview(currentHomepage)}>
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </Button>
                  {canUpdate && (
                    <Button variant="secondary" onClick={() => void handleUnset()} disabled={switching}>
                      Unassign
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                title="No homepage designated"
                description="The public site is rendering its own existing default homepage. Select a page below to switch to a dynamic homepage."
              />
            )}
          </Card>

          {canUpdate && (
            <Card className="p-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Switch homepage
              </p>
              {candidates.length === 0 ? (
                <EmptyState title="No eligible pages" description="Publish a page first — only PUBLISHED pages can become the homepage." />
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={candidateId} onChange={(e) => setCandidateId(e.target.value)} className="flex-1 min-w-[220px]">
                      <option value="">Select a published page…</option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} (/{p.slug})
                        </option>
                      ))}
                    </Select>
                    {candidatePage && (
                      <Button variant="ghost" onClick={() => handleOpenPreview(candidatePage)}>
                        <Eye className="w-3.5 h-3.5" /> Preview
                      </Button>
                    )}
                    <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={!candidateId || switching}>
                      <RefreshCw className="w-3.5 h-3.5" /> Switch
                    </Button>
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Switching never deletes or edits any page's content — reassign at any time, including back to the current homepage, with full rollback.
                  </p>
                </>
              )}
            </Card>
          )}

          <Card className="p-4">
            <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
              All pages
            </p>
            {pages.length === 0 ? (
              <EmptyState title="No pages yet" description="Create a page in Pages first." />
            ) : (
              <ul className="space-y-1">
                {pages.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-[11px] px-2 py-1.5 rounded-lg" style={{ color: "var(--text-secondary)" }}>
                    <span className="truncate flex items-center gap-1.5">
                      {p.isHomepage && <Home className="w-3 h-3" style={{ color: "var(--accent)" }} />}
                      {p.title}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={p.status === "PUBLISHED" ? "success" : "neutral"}>{p.status}</Badge>
                      <button type="button" className="font-semibold" style={{ color: "var(--accent)" }} onClick={() => navigate(`/website/site-editor?pageId=${p.id}`)}>
                        Edit
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Switch homepage?"
        message={
          candidatePage
            ? `Make "${candidatePage.title}" the homepage?${currentHomepage ? ` This replaces "${currentHomepage.title}".` : ""} You can switch back at any time.`
            : ""
        }
        confirmLabel="Switch"
        onConfirm={() => void handleSwitch()}
        onCancel={() => setConfirmOpen(false)}
      />

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={previewPage ? `Preview: ${previewPage.title}` : "Preview"}>
        <div className="max-h-[70vh] overflow-y-auto">
          {previewPage && Array.isArray(previewPage.currentRevision?.editorBlocks?.blocks) && previewPage.currentRevision!.editorBlocks!.blocks.length > 0 ? (
            <BlockTreeRenderer blocks={previewPage.currentRevision!.editorBlocks!.blocks} />
          ) : previewPage?.currentRevision?.body ? (
            <div className="text-sm cms-rendered-body" dangerouslySetInnerHTML={{ __html: previewPage.currentRevision.body }} />
          ) : (
            <EmptyState title="Nothing to preview yet" description="This page has no content yet." />
          )}
        </div>
      </Modal>
    </div>
  );
};
