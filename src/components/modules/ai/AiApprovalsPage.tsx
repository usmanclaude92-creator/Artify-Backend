/** Phase 12 — AI approval requests: the human-approval gate for HIGH-risk tool calls (docs/AI_GOVERNANCE.md §17). */
import React, { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Check, X } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import { aiApprovalsApi, type AiApprovalRequest, type AiApprovalStatusValue } from "../../../lib/aiApi";
import { ApiClientError } from "../../../lib/apiClient";
import { Card, Button, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, ReasonConfirmDialog } from "../../ui/ui";
import { hasPermission } from "../../../lib/permissions";

const STATUS_OPTIONS: AiApprovalStatusValue[] = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"];
const STATUS_TONE: Record<AiApprovalStatusValue, "success" | "warning" | "danger" | "neutral"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  EXPIRED: "neutral",
};

export const AiApprovalsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canDecide = hasPermission(user?.role.permissions, "ai.approvals.decide");

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<AiApprovalStatusValue | "">("PENDING");
  const [approvals, setApprovals] = useState<AiApprovalRequest[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AiApprovalRequest | null>(null);

  useEffect(() => setPage(1), [status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await aiApprovalsApi.list({ page, limit: 20, status: status || undefined });
      setApprovals(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approval requests.");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (approval: AiApprovalRequest) => {
    setBusyId(approval.id);
    try {
      await aiApprovalsApi.decide(approval.id, "APPROVE");
      notify("Approved — the action has been executed.", "success");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not approve request.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (reason: string) => {
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id);
    try {
      await aiApprovalsApi.decide(rejectTarget.id, "REJECT", reason);
      notify("Rejected.", "success");
      setRejectTarget(null);
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not reject request.", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <ShieldAlert className="w-5 h-5" /> AI Approvals
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          HIGH-risk AI actions (money movement, contract-binding changes) wait here until a human decides — never executed automatically.
        </p>
      </div>

      <Card className="p-3 flex gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value as AiApprovalStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : approvals.length === 0 ? (
        <Card>
          <EmptyState title="Nothing waiting" description="Approval requests from HIGH-risk AI tool calls will appear here." />
        </Card>
      ) : (
        <Card className="divide-y" style={{ borderColor: "var(--border)" }}>
          {approvals.map((approval) => (
            <div key={approval.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  {approval.action}
                  <Badge tone={STATUS_TONE[approval.status]}>{approval.status}</Badge>
                </p>
                <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                  {approval.requestedBy ? `${approval.requestedBy.firstName} ${approval.requestedBy.lastName}` : "Unknown requester"} · requested{" "}
                  {new Date(approval.createdAt).toLocaleString()}
                </p>
                <pre className="text-[10px] mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                  {JSON.stringify(approval.payload)}
                </pre>
              </div>
              {canDecide && approval.status === "PENDING" && (
                <div className="flex gap-2 shrink-0">
                  <Button variant="primary" disabled={busyId === approval.id} onClick={() => void approve(approval)}>
                    <Check className="w-3.5 h-3.5" /> Approve
                  </Button>
                  <Button variant="danger" disabled={busyId === approval.id} onClick={() => setRejectTarget(approval)}>
                    <X className="w-3.5 h-3.5" /> Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
          <div className="px-4 py-2">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        </Card>
      )}

      <ReasonConfirmDialog
        open={!!rejectTarget}
        title="Reject AI approval request"
        message="The pending action will not be executed."
        reasonLabel="Rejection reason"
        reasonPlaceholder="Why is this being rejected?"
        confirmLabel="Reject"
        onConfirm={(reason) => void reject(reason)}
        onCancel={() => setRejectTarget(null)}
      />
    </div>
  );
};
