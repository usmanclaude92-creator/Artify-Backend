/**
 * Phase 16 — My Work (docs/AUTOMATION_ARCHITECTURE.md §4). A personal
 * workspace view over the existing automation surface: this caller's own
 * assigned tasks (overdue/upcoming/all), the approvals they're actually
 * eligible to decide, and their own recent workflow activity. Every
 * number/row comes straight from /automation/my-work — never fabricated,
 * never another user's data.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Briefcase, Clock, AlertTriangle, CheckCircle2, XCircle, History, ListChecks } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { automationApi, type AutomationTask, type AutomationApproval, type MyWork } from "../../lib/api";
import { Card, Badge, Button, LoadingState, ErrorState, EmptyState } from "../ui/ui";
import { ApiClientError } from "../../lib/apiClient";

function formatDue(iso: string | null): string {
  if (!iso) return "No due date";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const priorityTone = (p: string): "neutral" | "warning" | "danger" | "info" => (p === "URGENT" ? "danger" : p === "HIGH" ? "warning" : p === "MEDIUM" ? "info" : "neutral");

const TaskRow: React.FC<{ task: AutomationTask; overdue?: boolean; onComplete: (id: string) => void; busy: boolean }> = ({ task, overdue, onComplete, busy }) => (
  <li className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
    <div className="min-w-0">
      <p className="font-semibold truncate" style={{ color: overdue ? "var(--danger)" : "var(--text-primary)" }}>
        {task.title}
      </p>
      <p style={{ color: "var(--text-muted)" }}>
        {formatDue(task.dueDate)}
        {task.sourceEntityType ? ` · ${task.sourceEntityType}` : ""}
      </p>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
      {task.status !== "COMPLETED" && task.status !== "CANCELLED" && (
        <Button variant="secondary" disabled={busy} onClick={() => onComplete(task.id)}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Done
        </Button>
      )}
    </div>
  </li>
);

const SectionCard: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <Card className="overflow-hidden">
    <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
      <Icon className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
      <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
    </div>
    {children}
  </Card>
);

export const MyWorkPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const [data, setData] = useState<MyWork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await automationApi.myWork();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your work.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completeTask = async (id: string) => {
    setBusyId(id);
    try {
      await automationApi.updateTask(id, { status: "COMPLETED" });
      notify("Task completed.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not complete task.", "error");
    } finally {
      setBusyId(null);
    }
  };

  const decideApproval = async (id: string, decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED") => {
    setBusyId(id);
    try {
      await automationApi.decideApproval(id, decision);
      notify(decision === "APPROVED" ? "Approved." : decision === "CHANGES_REQUESTED" ? "Changes requested." : "Rejected.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not decide.", "error");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState label="Loading your work…" />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const { tasks, pendingApprovals, recentActivity } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Briefcase className="w-5 h-5" /> My Work
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {user?.role.name} · your assigned tasks, pending approvals, and recent activity
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-lg font-bold" style={{ color: "var(--danger)" }}>
            {tasks.overdue.length}
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Overdue
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            {tasks.upcoming.length}
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Due this week
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            {tasks.assigned.length}
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Open tasks
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            {pendingApprovals.length}
          </p>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Awaiting my approval
          </p>
        </Card>
      </div>

      <SectionCard title="Overdue" icon={AlertTriangle}>
        {tasks.overdue.length === 0 ? (
          <EmptyState title="Nothing overdue" description="You're all caught up." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {tasks.overdue.map((t) => (
              <TaskRow key={t.id} task={t} overdue onComplete={completeTask} busy={busyId === t.id} />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Due this week" icon={Clock}>
        {tasks.upcoming.length === 0 ? (
          <EmptyState title="Nothing due soon" description="No tasks due in the next 7 days." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {tasks.upcoming.map((t) => (
              <TaskRow key={t.id} task={t} onComplete={completeTask} busy={busyId === t.id} />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Pending my approval" icon={CheckCircle2}>
        {pendingApprovals.length === 0 ? (
          <EmptyState title="Nothing to approve" description="Approval requests you're eligible to decide will appear here." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {pendingApprovals.map((a: AutomationApproval) => (
              <li key={a.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {a.action} — {a.workflow?.name ?? a.workflowId}
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{a.description ?? "No description."}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="primary" disabled={busyId === a.id} onClick={() => void decideApproval(a.id, "APPROVED")}>
                    Approve
                  </Button>
                  <Button variant="secondary" disabled={busyId === a.id} onClick={() => void decideApproval(a.id, "CHANGES_REQUESTED")}>
                    Request changes
                  </Button>
                  <Button variant="danger" disabled={busyId === a.id} onClick={() => void decideApproval(a.id, "REJECTED")}>
                    <XCircle className="w-3.5 h-3.5" /> Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <SectionCard title="All my open tasks" icon={ListChecks}>
          {tasks.assigned.length === 0 ? (
            <EmptyState title="No open tasks" description="Tasks assigned to you will appear here." />
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {tasks.assigned.map((t) => (
                <TaskRow key={t.id} task={t} onComplete={completeTask} busy={busyId === t.id} />
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent activity" icon={History}>
          {recentActivity.executions.length === 0 && recentActivity.completedTasks.length === 0 ? (
            <EmptyState title="No recent activity" description="Workflows you've triggered and tasks you've completed will appear here." />
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {recentActivity.executions.map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                  <span style={{ color: "var(--text-primary)" }}>{e.workflow?.name ?? "Workflow"} run</span>
                  <Badge tone={e.status === "COMPLETED" ? "success" : e.status === "FAILED" ? "danger" : "info"}>{e.status}</Badge>
                </li>
              ))}
              {recentActivity.completedTasks.map((t) => (
                <li key={t.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                  <span style={{ color: "var(--text-primary)" }}>{t.title}</span>
                  <Badge tone="success">Completed</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
