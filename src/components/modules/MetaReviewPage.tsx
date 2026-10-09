/** Administration → Meta Review Demo (Step 15). SUPER_ADMIN seeds / removes the isolated demo workspace used for Meta App Review. The reviewer password is shown once. */
import React, { useCallback, useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { metaReviewApi, type MetaReviewStatus } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, ConfirmDialog, ErrorState, LoadingState } from "../ui/ui";

export const MetaReviewPage: React.FC = () => {
  const { notify } = useToast();
  const [status, setStatus] = useState<MetaReviewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { metaReviewApi.status().then((s) => { setStatus(s); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Could not load the demo workspace status.")); }, []);
  useEffect(load, [load]);

  if (error && !status) return <ErrorState message={error} />;
  if (!status) return <LoadingState />;

  const seed = async () => {
    setBusy(true);
    try { const r = await metaReviewApi.seed(); setSecret({ email: r.reviewerEmail, password: r.reviewerPassword }); notify("Demo workspace created.", "success"); load(); } catch (e) { notify(e instanceof Error ? e.message : "Could not create the demo workspace.", "error"); } finally { setBusy(false); }
  };
  const remove = async () => {
    setConfirmRemove(false); setBusy(true);
    try { await metaReviewApi.remove(); setSecret(null); notify("Demo workspace removed.", "success"); load(); } catch (e) { notify(e instanceof Error ? e.message : "Could not remove the demo workspace.", "error"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><FlaskConical className="w-5 h-5" /> Meta review demo workspace</h1>
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>An isolated organization with clearly fictional sample conversations and posts, plus one reviewer login, so Meta's reviewers can use Control Center without seeing real customer data. The reviewer connects their own Meta test Page. Create it only for the review, and remove it afterwards: removal deletes the organization, the reviewer and everything they created in it.</p>
      </div>
      <Card className="p-4 space-y-3">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Status: <Badge tone={status.seeded ? "warning" : "neutral"}>{status.seeded ? "exists" : "not created"}</Badge></p>
        {status.seeded ? (
          <>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Reviewer login: {status.reviewerEmail} · {status.counts.accounts} sample accounts, {status.counts.conversations} conversations, {status.counts.posts} posts · created {new Date(status.createdAt).toLocaleString()}. The password was shown once when it was created and is stored only as a hash. To get a new one, remove and create the workspace again.</p>
            <Button variant="danger" onClick={() => setConfirmRemove(true)} disabled={busy}>Remove demo workspace</Button>
          </>
        ) : (
          <Button variant="primary" onClick={seed} disabled={busy}>Create demo workspace</Button>
        )}
        {secret && (
          <div role="alert" className="rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border)" }}>
            <p className="font-semibold">Copy these now. The password is not shown again.</p>
            <p>Email: <code>{secret.email}</code></p>
            <p>Password: <code data-testid="reviewer-password">{secret.password}</code></p>
            <p style={{ color: "var(--text-muted)" }}>Put them only in the "Instructions for reviewers" field of the App Review submission.</p>
          </div>
        )}
      </Card>
      <ConfirmDialog open={confirmRemove} title="Remove demo workspace" message="This deletes the demo organization, the reviewer login and everything created inside it, including any test Page the reviewer connected. Real data is not affected." confirmLabel="Remove" destructive onCancel={() => setConfirmRemove(false)} onConfirm={remove} />
    </div>
  );
};

export default MetaReviewPage;
