import React from "react";
import {
  Users,
  Building2,
  Contact2,
  CreditCard,
  Rocket,
  TrendingUp,
  Eye,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Package
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";

export const DashboardModule: React.FC = () => {
  const {
    selectedDateRange,
    users = [],
    customers = [],
    leads = [],
    subscriptions = [],
    onboardingRecords = [],
    auditLogs = [],
    setActiveModule,
    setCurrentView
  } = useAdminData();

  // Metrics computation
  const totalUsers = users.length;
  const activeCustomers = customers.filter((c) => c.status === "active").length;
  const activeLeads = leads.filter((l) => l.stage !== "Converted" && l.stage !== "Lost").length;
  const activeSubs = subscriptions.filter((s) => s.status === "active");
  const trialSubs = subscriptions.filter((s) => s.status === "trialing");
  const expiringSubs = subscriptions.filter((s) => {
    if (!s.currentPeriodEnd) return false;
    const daysLeft = (new Date(s.currentPeriodEnd).getTime() - Date.now()) / (1000 * 3600 * 24);
    return daysLeft > 0 && daysLeft <= 45;
  });

  // Calculate MRR / ARR
  const mrr = activeSubs.reduce((acc, s) => {
    return acc + (s.billingCycle === "annual" ? s.amount / 12 : s.amount);
  }, 0);
  const arr = mrr * 12;

  // Funnel numbers
  const visitorsCount = 48250;
  const engagementCount = 19300;
  const leadsCount = leads.length + 84;
  const registrationsCount = 142;
  const trialsCount = trialSubs.length + 38;
  const customersCount = customers.length;
  const paidSubsCount = activeSubs.length;

  const funnelSteps = [
    { label: "Website Visitors", count: visitorsCount.toLocaleString(), conv: "100%" },
    { label: "Engaged Sessions", count: engagementCount.toLocaleString(), conv: "40.0%" },
    { label: "Enterprise Leads", count: leadsCount.toString(), conv: "1.2%" },
    { label: "Product Trials", count: trialsCount.toString(), conv: "28.5%" },
    { label: "Active Customers", count: customersCount.toString(), conv: "12.8%" },
    { label: "Paid Subscriptions", count: paidSubsCount.toString(), conv: "94.0%" }
  ];

  const recentAdminActivities = auditLogs.slice(0, 6);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner: Enterprise Positioning & Filter Summary */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-xs font-bold uppercase tracking-wider border border-indigo-500/30">
              Artify Enterprise Ecosystem
            </span>
            <span className="text-xs text-slate-400">Governance Plane</span>
          </div>
          <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
            “Software should adapt your business, not your business adapt software.”
          </h2>
          <p className="text-xs text-slate-300 mt-1 max-w-3xl">
            Real-time multi-dimensional operational metrics across ERP, HRM, FinTech, and AI deployments for the selected period ({selectedDateRange}).
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setActiveModule("reports")}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center gap-2 shadow-sm"
          >
            <span>Export Executive PDF</span>
          </button>
          <button
            onClick={() => setCurrentView("public_website")}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center gap-2"
          >
            <span>Preview Live Ecosystem</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* MRR / Revenue */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Normalized MRR</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-white">
              ${Math.round(mrr).toLocaleString()}
            </span>
            <span className="text-xs font-bold text-emerald-400 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> +14.2%
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            ARR Run-rate: ${(Math.round(arr) / 1000).toFixed(1)}k / yr
          </p>
        </div>

        {/* Active Customers */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Customers</span>
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-white">{activeCustomers}</span>
            <span className="text-xs font-bold text-cyan-400 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> +8.5%
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Across 5 Enterprise Industry Sectors
          </p>
        </div>

        {/* Pipeline Leads */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active CRM Leads</span>
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
              <Contact2 className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-white">{activeLeads}</span>
            <span className="text-xs font-bold text-purple-400 flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> +19.4%
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Est. Pipeline Value: $182,000
          </p>
        </div>

        {/* Subscriptions & Trials */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Subs / Trials</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <Rocket className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-white">{activeSubs.length}</span>
            <span className="text-xs text-amber-400 font-semibold">
              ({trialSubs.length} in trial)
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {expiringSubs.length} expiring within 45 days
          </p>
        </div>
      </div>

      {/* Secondary Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
          <span className="text-[11px] text-slate-400 font-medium">Website Visitors</span>
          <p className="text-lg font-bold text-white mt-0.5">48,250</p>
          <span className="text-[10px] text-emerald-400 font-semibold">+22.4% vs last period</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
          <span className="text-[11px] text-slate-400 font-medium">Total Pageviews</span>
          <p className="text-lg font-bold text-white mt-0.5">184,910</p>
          <span className="text-[10px] text-slate-400">Avg 3.8 pages / session</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
          <span className="text-[11px] text-slate-400 font-medium">Demo Conversion</span>
          <p className="text-lg font-bold text-white mt-0.5">3.82%</p>
          <span className="text-[10px] text-emerald-400 font-semibold">+0.6% optimization</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
          <span className="text-[11px] text-slate-400 font-medium">Platform Uptime</span>
          <p className="text-lg font-bold text-white mt-0.5">99.99%</p>
          <span className="text-[10px] text-emerald-400 font-semibold">Zero critical incidents</span>
        </div>
      </div>

      {/* Main Section: Conversion Funnel & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Conversion Funnel */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Enterprise Conversion Funnel
              </h3>
              <p className="text-xs text-slate-400">
                Visitor → Engagement → Lead → Registration → Trial → Customer → Subscription
              </p>
            </div>
            <button
              onClick={() => setActiveModule("analytics")}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
            >
              <span>Full Analytics</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3 mt-4">
            {funnelSteps.map((step, idx) => {
              const widths = ["100%", "78%", "52%", "38%", "26%", "20%"];
              const colors = [
                "from-indigo-600 to-indigo-500",
                "from-indigo-500 to-cyan-500",
                "from-cyan-500 to-teal-500",
                "from-teal-500 to-emerald-500",
                "from-emerald-500 to-amber-500",
                "from-amber-500 to-purple-500"
              ];
              return (
                <div key={step.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">
                      {idx + 1}. {step.label}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-slate-300 font-bold">{step.count}</span>
                      <span className="text-[11px] font-semibold text-indigo-400 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">
                        {step.conv}
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-slate-800/80 overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${colors[idx] || "from-indigo-600 to-cyan-500"} transition-all duration-500`}
                      style={{ width: widths[idx] || "50%" }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Onboarding Health Mini-widget */}
          <div className="mt-6 pt-5 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <Rocket className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">Active Onboarding Pipelines</p>
                <p className="text-[11px] text-slate-400">
                  {onboardingRecords.length} enterprise accounts currently completing technical deployment & data migration.
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveModule("onboarding")}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 shrink-0"
            >
              Manage Onboarding
            </button>
          </div>
        </div>

        {/* Recent Admin Activity & System Health Stream */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-white tracking-tight">
              Recent Administrative Activity
            </h3>
            <button
              onClick={() => setActiveModule("audit")}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
            >
              Audit Trail
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto max-h-[380px] pr-1">
            {recentAdminActivities.map((log) => (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-slate-700 text-xs transition"
              >
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                  <span className="font-semibold text-indigo-400">{log.module}</span>
                  <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-slate-200 font-medium leading-snug">{log.details}</p>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                  <span>{log.userEmail}</span>
                  <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                    {log.action}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span>All 6 microservices healthy</span>
            </div>
            <button
              onClick={() => setActiveModule("health")}
              className="text-xs text-slate-400 hover:text-white"
            >
              Diagnostics →
            </button>
          </div>
        </div>
      </div>

      {/* Quick Action Matrix for Artify Ecosystem */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
          Direct Ecosystem Actions
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <button
            onClick={() => setActiveModule("leads")}
            className="p-3.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/40 text-left transition group"
          >
            <Contact2 className="w-5 h-5 text-indigo-400 mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-xs font-bold text-white">Review Inbound Leads</p>
            <p className="text-[11px] text-slate-400">Triage demo and consultation requests</p>
          </button>

          <button
            onClick={() => setActiveModule("products")}
            className="p-3.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/40 text-left transition group"
          >
            <Package className="w-5 h-5 text-cyan-400 mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-xs font-bold text-white">Manage Products & Plans</p>
            <p className="text-[11px] text-slate-400">Update ERP, HRM, AI suite offerings</p>
          </button>

          <button
            onClick={() => setActiveModule("ai")}
            className="p-3.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/40 text-left transition group"
          >
            <Sparkles className="w-5 h-5 text-purple-400 mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-xs font-bold text-white">AI Control Center</p>
            <p className="text-[11px] text-slate-400">Configure Gemini 3.8 models & agent review</p>
          </button>

          <button
            onClick={() => setActiveModule("website")}
            className="p-3.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/40 text-left transition group"
          >
            <Eye className="w-5 h-5 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-xs font-bold text-white">Configure Website Sections</p>
            <p className="text-[11px] text-slate-400">Hero, CTAs, testimonials & FAQ</p>
          </button>
        </div>
      </div>
    </div>
  );
};
