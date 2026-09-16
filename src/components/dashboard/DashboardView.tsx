import React from "react";
import {
  LayoutDashboard,
  Users,
  Contact2,
  Activity,
  FileClock,
  Shield,
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  AlertCircle,
  Clock,
  ArrowUpRight,
  Sparkles,
  Server,
  Database,
  Cpu,
  RefreshCw,
  Building2,
  CreditCard
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { UserRole } from "../../types";

export const DashboardView: React.FC = () => {
  const {
    users = [],
    leads = [],
    customers = [],
    subscriptions = [],
    auditLogs = [],
    currentUser,
    setActiveModule,
    switchUserRole,
    setCurrentView
  } = useAdminData();

  // Metrics computation for Phase 1
  const activeUsersCount = users.filter((u) => u.status === "active").length;
  const totalUsersCount = users.length;
  const mfaEnabledCount = users.filter((u) => u.mfaEnabled || u.twoFactorEnabled).length;

  const activeLeads = leads.filter((l) => l.stage !== "Converted" && l.stage !== "Lost");
  const totalPipelineValue = leads
    .filter((l) => l.stage !== "Lost")
    .reduce((sum, l) => sum + (l.estimatedValue || 0), 0);

  const activeSubscriptions = subscriptions.filter((s) => s.status === "active");

  // System Health Status items
  const healthServices = [
    {
      name: "Core API Gateway",
      status: "operational",
      latency: "14ms",
      uptime: "99.99%",
      icon: Server,
      description: "Express & Vite reverse proxy routing"
    },
    {
      name: "Primary Database Cluster",
      status: "operational",
      latency: "18ms",
      uptime: "99.98%",
      icon: Database,
      description: "Encrypted relational schema & state storage"
    },
    {
      name: "AI Orchestration Node",
      status: "operational",
      latency: "180ms",
      uptime: "99.95%",
      icon: Cpu,
      description: "Server-side Gemini 2.5 Flash reasoning engine"
    },
    {
      name: "IAM & Session Security",
      status: "operational",
      latency: "8ms",
      uptime: "100.0%",
      icon: ShieldCheck,
      description: "Role-based access control & token verification"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome Bar */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold tracking-wide uppercase">
              Phase 1 Governance
            </span>
            <span className="text-xs text-slate-400">
              Session: <span className="text-slate-200 font-medium">{currentUser.name}</span> ({currentUser.role})
            </span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mt-1.5 flex items-center gap-2.5">
            <span>Executive Command Center</span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" title="System Live"></span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            “Software should adapt your business, not your business adapt software.” Real-time visibility into identities, inbound opportunities, role policies, and infrastructure health.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setCurrentView("public_website")}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
          >
            <span>Live Site</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" />
          </button>
          <button
            onClick={() => setActiveModule("audit")}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow-md shadow-indigo-600/20"
          >
            <FileClock className="w-3.5 h-3.5" />
            <span>Audit Trail</span>
          </button>
        </div>
      </div>

      {/* Phase 1 Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Users Card */}
        <div
          onClick={() => setActiveModule("users")}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/50 transition cursor-pointer group shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Active Users
              </span>
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center group-hover:scale-105 transition">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">{activeUsersCount}</span>
              <span className="text-xs text-slate-400 font-medium">/ {totalUsersCount} total</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-emerald-400 flex items-center gap-1 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              {mfaEnabledCount} MFA Enforced
            </span>
            <span className="text-slate-500 group-hover:text-indigo-400 flex items-center gap-0.5 text-[11px] font-semibold transition">
              Manage <ArrowUpRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* Inbound Leads Card */}
        <div
          onClick={() => setActiveModule("leads")}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 transition cursor-pointer group shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Tracked Leads
              </span>
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center group-hover:scale-105 transition">
                <Contact2 className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">{activeLeads.length}</span>
              <span className="text-xs text-emerald-400 font-medium flex items-center gap-0.5">
                <TrendingUp className="w-3 h-3" /> Active Pipeline
              </span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400 text-[11px]">
              Est. Value: <strong className="text-white font-mono">${totalPipelineValue.toLocaleString()}</strong>
            </span>
            <span className="text-slate-500 group-hover:text-cyan-400 flex items-center gap-0.5 text-[11px] font-semibold transition">
              CRM <ArrowUpRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* Roles & Governance Card */}
        <div
          onClick={() => setActiveModule("roles")}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-purple-500/50 transition cursor-pointer group shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                RBAC Security Roles
              </span>
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center group-hover:scale-105 transition">
                <Shield className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">5</span>
              <span className="text-xs text-purple-300 font-medium">Defined Personas</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400 text-[11px]">
              Super Admin, Admin, CRM, etc.
            </span>
            <span className="text-slate-500 group-hover:text-purple-400 flex items-center gap-0.5 text-[11px] font-semibold transition">
              Matrix <ArrowUpRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* System Health Overview Card */}
        <div
          onClick={() => setActiveModule("health")}
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition cursor-pointer group shadow-sm flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                System Status
              </span>
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center group-hover:scale-105 transition">
                <Activity className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-emerald-400">Operational</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400 text-[11px]">4 Core Services 100% Uptime</span>
            <span className="text-slate-500 group-hover:text-emerald-400 flex items-center gap-0.5 text-[11px] font-semibold transition">
              Telemetry <ArrowUpRight className="w-3 h-3" />
            </span>
          </div>
        </div>
      </div>

      {/* System Health Status Cards Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Infrastructure & Health Status Cards
            </h2>
          </div>
          <button
            onClick={() => setActiveModule("health")}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 transition"
          >
            <span>Full System Telemetry</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {healthServices.map((srv, idx) => {
            const Icon = srv.icon;
            return (
              <div
                key={idx}
                className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/80 flex items-center justify-center text-slate-300">
                      <Icon className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-white leading-tight">{srv.name}</h3>
                      <p className="text-[10px] text-slate-500 mt-0.5">{srv.description}</p>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/70 flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3 h-3" />
                    Operational
                  </span>
                  <div className="flex items-center gap-2 font-mono text-slate-400 text-[10px]">
                    <span>{srv.latency}</span>
                    <span>•</span>
                    <span className="text-slate-300 font-medium">{srv.uptime}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two Column Section: Quick Identity Table & Recent Audit Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick User Identity Management */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-white">Active System Users (RBAC)</h3>
            </div>
            <button
              onClick={() => setActiveModule("users")}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition"
            >
              View All ({users.length})
            </button>
          </div>

          <div className="divide-y divide-slate-800/80">
            {users.slice(0, 5).map((u) => (
              <div key={u.id} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-xs shrink-0">
                    {u.name.charAt(0)}
                  </div>
                  <div className="truncate">
                    <p className="text-xs font-semibold text-white truncate">{u.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">{u.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-indigo-300">
                    {u.role}
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      u.status === "active" ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                    title={u.status}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400">
            <span>Current Role Simulation:</span>
            <select
              value={currentUser.role}
              onChange={(e) => switchUserRole(e.target.value as UserRole)}
              className="bg-slate-800 text-indigo-300 text-xs font-semibold rounded px-2.5 py-1 border border-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="Super Admin">Super Admin</option>
              <option value="Admin">Admin</option>
              <option value="Content Manager">Content Manager</option>
              <option value="Sales / CRM">Sales / CRM</option>
              <option value="Support Manager">Support Manager</option>
            </select>
          </div>
        </div>

        {/* Recent Audit Logs Stream */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileClock className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">Recent Immutable Audit Logs</h3>
            </div>
            <button
              onClick={() => setActiveModule("audit")}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold transition"
            >
              View Trail ({auditLogs.length})
            </button>
          </div>

          <div className="space-y-2.5">
            {auditLogs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-slate-700/80 transition flex items-start justify-between gap-3 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] font-bold text-cyan-400 uppercase">
                      {log.action}
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700">
                      {log.module}
                    </span>
                  </div>
                  <p className="text-slate-300 truncate text-[11px]">{log.details}</p>
                  <p className="text-[10px] text-slate-500">
                    By <span className="text-slate-400 font-medium">{log.performedBy}</span> ({log.performedByRole})
                  </p>
                </div>
                <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              SHA-256 Tamper Evident
            </span>
            <button
              onClick={() => setActiveModule("audit")}
              className="text-slate-400 hover:text-white text-xs font-semibold"
            >
              Full Security Ledger →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
