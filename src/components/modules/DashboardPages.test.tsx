/** Step 14 UI: Dashboard shows only readable widgets with as-of times and honest empty states; Scheduled Reports defaults to dry run and exposes the kill switch. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import { ScheduledReportsPage } from "./ScheduledReportsPage";

const dash = vi.hoisted(() => ({ get: vi.fn(), exportCsv: vi.fn(), views: vi.fn(), saveView: vi.fn(), deleteView: vi.fn(), inbox: vi.fn(), downloadReport: vi.fn(), schedules: vi.fn(), recipients: vi.fn(), createSchedule: vi.fn(), updateSchedule: vi.fn(), deleteSchedule: vi.fn(), runSchedule: vi.fn(), sendTest: vi.fn(), runs: vi.fn(), setKillSwitch: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("../../lib/api", () => ({ dashboardApi: dash, auditLogsApi: { list: vi.fn().mockResolvedValue({ items: [] }) } }));
const roleKey = vi.hoisted(() => ({ current: "ADMIN" }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { firstName: "Sam", role: { key: roleKey.current, name: roleKey.current, permissions: [] } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => nav }));

afterEach(() => { roleKey.current = "ADMIN"; cleanup(); Object.values(dash).forEach((m) => m.mockReset()); nav.navigate.mockReset(); });

const t = "2026-10-20T10:00:00.000Z";
const w = (key: string, title: string, over: object = {}) => ({ key, title, state: "ok", asOf: t, sourceAsOf: null, source: "stored rows", link: "/x", ...over });
const forbidden = (key: string, title: string) => ({ key, title, state: "forbidden", asOf: t, sourceAsOf: null, source: "", link: "/x" });
const period = { days: 28, from: "2026-09-22", to: "2026-10-19", previousFrom: "2026-08-25", previousTo: "2026-09-21" };

function setup(widgets: unknown[]) {
  dash.get.mockResolvedValue({ period, asOf: t, widgets });
  dash.views.mockResolvedValue({ views: [] });
  dash.inbox.mockResolvedValue({ reports: [] });
}

describe("DashboardPage", () => {
  it("shows the attention strip first, with as-of and sources, and hides forbidden widgets entirely", async () => {
    setup([
      w("attention_approvals", "Approvals waiting", { data: { total: 2, counts: { social: 2, ai: 0 } } }),
      forbidden("attention_health", "Red health checks"),
      w("website", "Website", { sourceAsOf: t, data: { views: { current: 120, previous: null, changePct: null, note: "Comparison needs data from 2026-08-25; the first stored record is 2026-09-30." }, sessions: { current: 40, previous: 30, changePct: 33.3, note: null }, topPages: [{ path: "/", views: 80 }], note: "A session is one browser tab." } }),
      forbidden("social_analytics", "Social performance"),
      forbidden("operations", "Operations"),
    ]);
    render(<DashboardPage />);
    expect(await screen.findByText(/Attention needed/)).toBeInTheDocument();
    expect(screen.getByText(/waiting/i, { selector: "span, span *" })).toBeInTheDocument();
    expect(screen.getByText(/social 2/)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/Comparison needs data from 2026-08-25/)).toBeInTheDocument();
    expect(screen.getByText(/\+33.3% vs previous \(30\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/As of /).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Operations")).toBeNull();
    expect(screen.queryByText("Social performance")).toBeNull();
    expect(screen.queryByText("Red health checks")).toBeNull();
  });

  it("says why a widget is empty instead of showing zeros, and never shows an empty attention strip as a problem", async () => {
    setup([
      w("attention_approvals", "Approvals waiting", { state: "empty", emptyText: "Nothing is waiting for your approval." }),
      w("crm", "CRM", { state: "empty", emptyText: "No leads yet." }),
      w("landing", "Landing pages", { state: "empty", emptyText: "No landing page has been published." }),
    ]);
    render(<DashboardPage />);
    expect(await screen.findByText(/Nothing needs attention right now/)).toBeInTheDocument();
    expect(screen.getByText("No leads yet.")).toBeInTheDocument();
    expect(screen.getByText("No landing page has been published.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download CRM as CSV/ })).toBeNull();
  });

  it("omits the strip when the role can read no attention widget, deep-links cards and exports a readable widget", async () => {
    setup([forbidden("attention_approvals", "Approvals waiting"), w("website", "Website", { link: "/analytics", data: { views: { current: 1, previous: null, changePct: null, note: null }, sessions: { current: 1, previous: null, changePct: null, note: null }, topPages: [], note: "" } })]);
    dash.exportCsv.mockResolvedValue(undefined);
    render(<DashboardPage />);
    await screen.findByText("Website");
    expect(screen.queryByText(/Attention needed/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Website" }));
    expect(nav.navigate).toHaveBeenCalledWith("/analytics");
    fireEvent.click(screen.getByRole("button", { name: "Download Website as CSV" }));
    expect(dash.exportCsv).toHaveBeenCalledWith("website", 28);
  });

  it("sends client portal users to the portal without calling the workspace dashboard API", async () => {
    roleKey.current = "CLIENT_PORTAL";
    render(<DashboardPage />);
    expect(await screen.findByText(/Open Client Portal/)).toBeInTheDocument();
    expect(dash.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Open Client Portal/ }));
    expect(nav.navigate).toHaveBeenCalledWith("/portal");
  });

  it("reloads for the chosen period", async () => {
    setup([w("website", "Website", { data: { views: { current: 1, previous: null, changePct: null, note: null }, sessions: { current: 1, previous: null, changePct: null, note: null }, topPages: [], note: "" } })]);
    render(<DashboardPage />);
    await screen.findByText("Website");
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "7" } });
    await waitFor(() => expect(dash.get).toHaveBeenLastCalledWith(7));
  });
});

describe("ScheduledReportsPage", () => {
  const schedule = { id: "s1", name: "Weekly", cadence: "WEEKLY", sections: ["website"], recipientIds: ["u1"], periodDays: 7, enabled: true, dryRun: true, nextRunAt: t, lastRunAt: null };
  it("explains the missing email provider, shows dry run, and offers the kill switch", async () => {
    dash.schedules.mockResolvedValue({ schedules: [schedule], settings: { killSwitch: false, emailConfigured: false, updatedAt: null } });
    dash.recipients.mockResolvedValue({ recipients: [] });
    render(<ScheduledReportsPage />);
    expect(await screen.findByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("dry run")).toBeInTheDocument();
    expect(screen.getByText(/no outbound email provider is configured/)).toBeInTheDocument();
    dash.setKillSwitch.mockResolvedValue({});
    fireEvent.click(screen.getByRole("button", { name: "Turn kill switch on" }));
    await waitFor(() => expect(dash.setKillSwitch).toHaveBeenCalledWith(true));
  });
  it("disables 'send test' while the kill switch is on and creates schedules in dry run by default", async () => {
    dash.schedules.mockResolvedValue({ schedules: [schedule], settings: { killSwitch: true, emailConfigured: true, updatedAt: t } });
    dash.recipients.mockResolvedValue({ recipients: [{ id: "u1", name: "Pat Admin", email: "pat@example.com", role: "Admin", roleKey: "ADMIN" }] });
    dash.createSchedule.mockResolvedValue({});
    render(<ScheduledReportsPage />);
    await screen.findByText("Weekly");
    expect(screen.getByRole("button", { name: "Send test to me" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /New schedule/ }));
    const dlg = screen.getByRole("dialog");
    expect((within(dlg).getByLabelText(/Dry run/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dlg).getByLabelText(/Pat Admin/));
    fireEvent.click(within(dlg).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(dash.createSchedule).toHaveBeenCalled());
    expect(dash.createSchedule.mock.calls[0]![0]).toMatchObject({ dryRun: true, recipientIds: ["u1"], cadence: "WEEKLY" });
  });
});
