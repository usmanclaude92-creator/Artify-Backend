/** Phase 12 — AI tool catalog + per-organization enablement (docs/AI_TOOL_SECURITY.md). */
import React, { useCallback, useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { aiToolsApi, type AiTool, type AiToolRiskLevelValue } from "../../../lib/aiApi";
import { ApiClientError } from "../../../lib/apiClient";
import { Card, Badge, LoadingState, ErrorState } from "../../ui/ui";
import { hasPermission } from "../../../lib/permissions";

const RISK_TONE: Record<AiToolRiskLevelValue, "success" | "warning" | "danger" | "info"> = {
  READ_ONLY: "info",
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "danger",
};

export const AiToolsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "ai.tools.manage");

  const [tools, setTools] = useState<AiTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await aiToolsApi.list();
      setTools(res.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI tools.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleTool = async (tool: AiTool) => {
    setBusyCode(tool.code);
    try {
      await aiToolsApi.updateSetting(tool.code, { enabled: !tool.orgEnabled });
      notify(`${tool.name} ${!tool.orgEnabled ? "enabled" : "disabled"} for this organization.`, "success");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update tool setting.", "error");
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Wrench className="w-5 h-5" /> AI Tools
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          The governed actions an AI coworker can take on this organization's behalf — every call is permission-checked, audited, and HIGH-risk actions always require human approval.
        </p>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <Card className="divide-y" style={{ borderColor: "var(--border)" }}>
          {tools.map((tool) => (
            <div key={tool.code} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  {tool.name}
                  <Badge tone={RISK_TONE[tool.riskLevel]}>{tool.riskLevel}</Badge>
                  {tool.requiresApproval && <Badge tone="warning">Requires approval</Badge>}
                  {!tool.orgEnabled && <Badge tone="neutral">Disabled</Badge>}
                </p>
                <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                  {tool.code} · {tool.description}
                </p>
              </div>
              {canManage && (
                <button
                  onClick={() => void toggleTool(tool)}
                  disabled={busyCode === tool.code}
                  className="shrink-0 relative w-10 h-5 rounded-full transition"
                  style={{ background: tool.orgEnabled ? "var(--accent)" : "var(--border-strong)" }}
                  aria-pressed={tool.orgEnabled}
                  aria-label={`${tool.orgEnabled ? "Disable" : "Enable"} ${tool.name}`}
                >
                  <span
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                    style={{ transform: tool.orgEnabled ? "translateX(20px)" : "translateX(2px)" }}
                  />
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
};
