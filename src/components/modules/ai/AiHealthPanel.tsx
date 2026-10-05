/** Phase 18 — AI provider/health/limits panel. Renders only server-reported facts; "Not configured" when credentials are absent, never an assumed-connected state. */
import React, { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { aiHealthApi, type AiHealth } from "../../../lib/aiApi";
import { Card, Badge, Button, Input, ErrorState } from "../../ui/ui";

const n = (v: number) => v.toLocaleString();

export const AiHealthPanel: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState("0");
  const [tokens, setTokens] = useState("0");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      const res = await aiHealthApi.get();
      setHealth(res.health);
      setRequests(String(res.health.limits.dailyRequests));
      setTokens(String(res.health.limits.dailyTokens));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load AI health");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!health) return null;
  const { provider, usage, knowledge, limits } = health;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await aiHealthApi.setLimits({ dailyRequests: Math.max(0, Number(requests) || 0), dailyTokens: Math.max(0, Number(tokens) || 0) });
      setSaved(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save limits");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <Cpu className="w-4 h-4" /> Provider status
          </h2>
          <Badge tone={provider.configured ? "success" : "warning"}>{provider.configured ? "Configured" : "Not configured"}</Badge>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {provider.label}. Credentials are held server-side only; connectivity is not probed, and the first real request reveals provider errors.
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(provider.capabilities).map(([k, on]) => (
            <Badge key={k} tone={on ? "success" : "neutral"}>
              {k}: {on ? "available" : "unavailable"}
            </Badge>
          ))}
        </div>
        {!provider.configured && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Set AI_PROVIDER=gemini and GEMINI_API_KEY in the server environment to enable AI features. Until then Copilot and workflow AI steps report that no AI answer is available.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-lg font-bold">{n(usage.copilotRequests)}</p><p className="text-[11px]">Copilot requests ({usage.window})</p></Card>
        <Card className="p-4"><p className="text-lg font-bold">{n(usage.copilotFailures)}</p><p className="text-[11px]">Failed / unavailable</p></Card>
        <Card className="p-4"><p className="text-lg font-bold">{n(usage.totalTokens)}</p><p className="text-[11px]">Tokens reported by provider</p></Card>
        <Card className="p-4"><p className="text-lg font-bold">{usage.avgLatencyMs === null ? "—" : `${usage.avgLatencyMs} ms`}</p><p className="text-[11px]">Avg latency</p></Card>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Knowledge retrieval</h2>
        <p className="text-xs">
          Mode: <strong>{knowledge.retrievalMode === "HYBRID" ? "Hybrid (semantic + keyword)" : "Keyword only (embeddings unavailable)"}</strong> · {n(knowledge.chunks)} chunks, {n(knowledge.embeddedChunks)} embedded · {n(knowledge.failedIngestionJobs)} failed ingestion job(s)
        </p>
        {knowledge.documents.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>No knowledge documents yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {knowledge.documents.map((d) => (
              <Badge key={d.status} tone={d.status === "FAILED" ? "danger" : d.status === "INDEXED" ? "success" : "neutral"}>
                {d.status}: {d.count}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Daily limits (0 = unlimited)</h2>
        <p className="text-xs">
          Used today: {n(limits.usedToday.requests)} requests, {n(limits.usedToday.tokens)} tokens
        </p>
        {canManage && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              Requests / day
              <Input aria-label="Daily requests" type="number" min={0} value={requests} onChange={(e) => setRequests(e.target.value)} />
            </label>
            <label className="text-xs">
              Tokens / day
              <Input aria-label="Daily tokens" type="number" min={0} value={tokens} onChange={(e) => setTokens(e.target.value)} />
            </label>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save limits"}</Button>
            {saved && <span className="text-xs">Saved</span>}
          </div>
        )}
      </Card>

      {health.recentErrors.length > 0 && (
        <Card className="p-4 space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Recent errors</h2>
          <ul className="text-xs space-y-1">
            {health.recentErrors.map((e) => (
              <li key={e.id}>{e.category ?? "ERROR"}: {e.message}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};
