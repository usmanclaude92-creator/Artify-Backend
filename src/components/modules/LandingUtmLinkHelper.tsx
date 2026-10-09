/** Composer helper (Step 12): builds a /lp/<slug> link with UTM parameters pre-filled for a LIVE landing page. */
import React, { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { landingApi } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Button, Input, Select, Field } from "../ui/ui";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9._~-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

export const LandingUtmLinkHelper: React.FC<{ defaultSource: string; disabled?: boolean; onLink: (url: string) => void; notify: (m: string, kind?: "success" | "error" | "info") => void }> = ({ defaultSource, disabled, onLink, notify }) => {
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<Array<{ id: string; title: string; slug: string }> | null>(null);
  const [pageId, setPageId] = useState("");
  const [source, setSource] = useState(defaultSource || "social");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open && !pages) landingApi.live().then((r) => setPages(r.pages)).catch(() => setPages([])); }, [open, pages]);
  useEffect(() => setSource(defaultSource || "social"), [defaultSource]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await landingApi.utmLink(pageId, { source: slugify(source), medium: slugify(medium), campaign: slugify(campaign) });
      if (!r.url) { notify("The public site address (PUBLIC_SITE_BASE_URL) is not configured on the server, so a full link cannot be built.", "error"); return; }
      onLink(r.url);
      notify("Link added", "success");
      setOpen(false);
    } catch (e) { notify(e instanceof ApiClientError ? e.message : "Could not create the link.", "error"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <Button type="button" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open}><Link2 className="w-3.5 h-3.5" /> Create landing page UTM link</Button>
      {open && (
        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
          {pages && pages.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>No landing page is live yet. Publish one first.</p>
          ) : (
            <>
              <Field label="Landing page">
                <Select className="w-full" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                  <option value="">Choose a live page…</option>
                  {(pages ?? []).map((p) => <option key={p.id} value={p.id}>{p.title} (/lp/{p.slug})</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="utm_source"><Input value={source} onChange={(e) => setSource(e.target.value)} /></Field>
                <Field label="utm_medium"><Input value={medium} onChange={(e) => setMedium(e.target.value)} /></Field>
                <Field label="utm_campaign"><Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="spring-launch" /></Field>
              </div>
              <Button type="button" variant="primary" disabled={busy || !pageId || !source.trim() || !medium.trim() || !campaign.trim()} onClick={() => void create()}>Use this link</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
