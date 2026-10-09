/** Step 13 UI: System Health, Backups and Data Privacy render honest states and gate actions by permission. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SystemHealthPage } from "./SystemHealthPage";
import { BackupsPage } from "./BackupsPage";
import { DataPrivacyPage } from "./DataPrivacyPage";

const role = { current: { key: "ADMIN", permissions: ["ops.health.read", "ops.backups.read", "privacy.read", "privacy.export"] } };
const ops = vi.hoisted(() => ({ health: vi.fn(), backups: vi.fn(), verifyExport: vi.fn(), runExport: vi.fn(), retention: vi.fn(), consent: vi.fn() }));
const priv = vi.hoisted(() => ({ lookup: vi.fn(), preview: vi.fn(), requestErasure: vi.fn(), requests: vi.fn(), request: vi.fn(), download: vi.fn() }));
vi.mock("../../lib/api", () => ({ opsApi: ops, privacyApi: priv }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: role.current } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));

afterEach(() => { cleanup(); [...Object.values(ops), ...Object.values(priv)].forEach((m) => m.mockReset()); role.current = { key: "ADMIN", permissions: ["ops.health.read", "ops.backups.read", "privacy.read", "privacy.export"] }; });

const now = new Date().toISOString();
describe("SystemHealthPage", () => {
  it("shows status, plain reason and last-checked for each check, an Unknown that is not green, and env names only", async () => {
    ops.health.mockResolvedValue({
      generatedAt: now, summary: { ok: 1, warn: 0, red: 1, unknown: 1, disabled: 0 },
      checks: [
        { key: "hb_automation_tick", group: "Scheduler", label: "Automation tick", status: "red", reason: "LATE: last finished 20 min ago, expected every 5 min.", checkedAt: now, redSince: now },
        { key: "db_latency", group: "Platform", label: "Database latency", status: "ok", reason: "Round trip 12 ms.", checkedAt: now },
        { key: "logs_error_rate", group: "Logs", label: "API error rate", status: "unknown", reason: "The app does not store its own request logs.", checkedAt: now },
      ],
      env: [{ name: "CRON_SECRET", required: true, purpose: "Scheduler authentication", present: true }, { name: "BACKUP_EXPORT_KEY", required: false, purpose: "Export key", present: false }],
    });
    render(<SystemHealthPage />);
    expect(await screen.findByText("Automation tick")).toBeInTheDocument();
    expect(screen.getByText(/LATE: last finished 20 min ago/)).toBeInTheDocument();
    expect(screen.getByText("Round trip 12 ms.")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.getByText("CRON_SECRET")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getAllByText(/checked /).length).toBe(3);
  });
});

describe("BackupsPage", () => {
  const base = { provider: { available: false, reason: "Not available here: set SUPABASE_ACCESS_TOKEN" }, exportConfig: { enabled: false, keyConfigured: false, retentionDays: 30, problems: ["BACKUP_EXPORT_ENABLED is not true: no scheduled export runs."] }, exports: [] };
  it("says 'not available here' instead of inventing a backup state, and hides the manual export from non-SUPER_ADMIN", async () => {
    ops.backups.mockResolvedValue(base);
    render(<BackupsPage />);
    expect(await screen.findByText(/Not available here/)).toBeInTheDocument();
    expect(screen.getByText("Not active")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run export now/i })).toBeNull();
    expect(screen.getByText(/Restore runbook/)).toBeInTheDocument();
  });
  it("verifies an export and shows each check", async () => {
    role.current = { key: "SUPER_ADMIN", permissions: [] };
    ops.backups.mockResolvedValue({ ...base, exportConfig: { ...base.exportConfig, enabled: true, keyConfigured: true, problems: [] }, exports: [{ id: "e1", status: "SUCCEEDED", sizeBytes: 2048, rowCounts: {}, error: null, createdAt: now, expiresAt: null, verifiedAt: null }] });
    ops.verifyExport.mockResolvedValue({ ok: true, checks: [{ name: "File checksum matches", ok: true }] });
    render(<BackupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /verify/i }));
    expect(await screen.findByText(/Passed: File checksum matches/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run export now/i })).toBeEnabled();
  });
});

describe("DataPrivacyPage", () => {
  const counts = { contacts: 1, leads: 1, clients: 0, consentRecords: 1, formSubmissions: 1, socialConversations: 0, socialMessages: 0, auditReferences: 2 };
  it("finds a person, offers export for privacy.export holders, and hides the erase request without privacy.erase", async () => {
    priv.lookup.mockResolvedValue({ subjectRef: "abcdef1234567890", staffAccount: false, found: true, counts, auditSnapshotsContainingEmail: 1, records: {} });
    priv.preview.mockResolvedValue({ subjectRef: "x", staffAccount: false, erasable: true, blocker: null, counts, changes: [{ table: "leads", rows: 1, action: "Anonymise", detail: "d" }, { table: "consent_records", rows: 1, action: "Keep", detail: "k" }] });
    render(<DataPrivacyPage />);
    fireEvent.change(screen.getByLabelText(/person's email/i), { target: { value: "p@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /find everything held/i }));
    expect(await screen.findByText("Held about this person")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export json/i })).toBeInTheDocument();
    expect(screen.getByText(/audit log is immutable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /preview erasure/i }));
    expect(await screen.findByText("What an erasure would change")).toBeInTheDocument();
    expect(screen.getByText("Anonymise")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /request erasure/i })).toBeNull();
    expect(screen.getByText(/Only a SUPER_ADMIN can request an erasure/)).toBeInTheDocument();
  });
  it("SUPER_ADMIN must give a reason before requesting; the request names the two-person rule", async () => {
    role.current = { key: "SUPER_ADMIN", permissions: ["privacy.read", "privacy.export", "privacy.erase"] };
    priv.lookup.mockResolvedValue({ subjectRef: "abcdef1234567890", staffAccount: false, found: true, counts, auditSnapshotsContainingEmail: 0, records: {} });
    priv.preview.mockResolvedValue({ subjectRef: "x", staffAccount: false, erasable: true, blocker: null, counts, changes: [] });
    priv.requestErasure.mockResolvedValue({ requestId: "r", approvalId: "a", subjectRef: "x" });
    render(<DataPrivacyPage />);
    fireEvent.change(screen.getByLabelText(/person's email/i), { target: { value: "p@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /find everything held/i }));
    fireEvent.click(await screen.findByRole("button", { name: /preview erasure/i }));
    const btn = await screen.findByRole("button", { name: /request erasure/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Data subject request received 2026-10-01" } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(priv.requestErasure).toHaveBeenCalledWith("p@example.com", "Data subject request received 2026-10-01"));
  });
  it("shows the retention table and states whether automatic deletion is on", async () => {
    ops.retention.mockResolvedValue({ purgeEnabled: false, policy: [{ key: "analytics_events", dataClass: "Website analytics events", tables: ["analytics_events"], retentionDays: 395, basis: "13 months", purgeJob: "analytics_events", setBy: "policy" }, { key: "audit_logs", dataClass: "Audit log", tables: ["audit_logs"], retentionDays: null, basis: "kept", purgeJob: null, setBy: "policy" }], preview: [{ key: "analytics_events", dataClass: "x", retentionDays: 395, cutoff: now, eligible: 7, purged: 0 }] });
    render(<DataPrivacyPage />);
    fireEvent.click(screen.getByRole("tab", { name: /retention policy/i }));
    expect(await screen.findByText(/Automatic deletion is/)).toBeInTheDocument();
    expect(screen.getByText("395 days")).toBeInTheDocument();
    expect(screen.getByText("Until erased or reviewed")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});
