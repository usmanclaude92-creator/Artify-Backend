import React, { useState } from "react";
import {
  ShieldCheck,
  Lock,
  KeyRound,
  Laptop,
  Smartphone,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Sliders,
  RotateCcw
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { UserRole } from "../../types";

export const SecurityModule: React.FC = () => {
  const { rbacMatrix, updateRbacPermission } = useAdminData();
  const [selectedRole, setSelectedRole] = useState<UserRole>("Admin");
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [enforceMfaGlobal, setEnforceMfaGlobal] = useState(true);

  const activeSessions = [
    {
      id: "sess-1",
      user: "superadmin@artifysols.com",
      role: "Super Admin",
      ip: "192.168.1.104",
      location: "San Francisco, US",
      device: "MacBook Pro • Chrome 128",
      lastActive: "Just now (Active Session)",
      isCurrent: true
    },
    {
      id: "sess-2",
      user: "marcus.vance@artifysols.com",
      role: "Admin",
      ip: "84.17.42.19",
      location: "London, UK",
      device: "ThinkPad X1 • Firefox 130",
      lastActive: "14 minutes ago",
      isCurrent: false
    },
    {
      id: "sess-3",
      user: "content@artifysols.com",
      role: "Content Manager",
      ip: "185.220.101.5",
      location: "Berlin, DE",
      device: "iPad Pro • Safari",
      lastActive: "1 hour ago",
      isCurrent: false
    }
  ];

  const failedAttempts = [
    { id: "fail-1", ip: "194.26.29.112", user: "admin@artifysols.com", timestamp: "Today, 04:12 UTC", reason: "Invalid credential signature", status: "Blocked by WAF" },
    { id: "fail-2", ip: "45.154.255.89", user: "root", timestamp: "Yesterday, 22:45 UTC", reason: "Non-existent identity probe", status: "Blocked by WAF" }
  ];

  const permissionsList = [
    { key: "canView", label: "View" },
    { key: "canCreate", label: "Create" },
    { key: "canEdit", label: "Edit" },
    { key: "canDelete", label: "Delete" },
    { key: "canPublish", label: "Publish" },
    { key: "canApprove", label: "Approve" },
    { key: "canExport", label: "Export" },
    { key: "canManage", label: "Manage" }
  ] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span>Security, IAM & Granular Authorization Matrix</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Role-Based Access Control (RBAC), multi-factor enforcement, concurrent session revocation, and audit shields.
          </p>
        </div>
      </div>

      {/* Security Policies Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 block font-medium">MFA Policy</span>
            <span className="text-sm font-bold text-emerald-400">Strict Enforcement</span>
            <p className="text-[10px] text-slate-400 mt-0.5">Mandatory for all admin tiers</p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 block font-medium">Idle Session Expiry</span>
            <span className="text-sm font-bold text-white">{sessionTimeout} Minutes</span>
            <p className="text-[10px] text-slate-400 mt-0.5">Automatic token revocation</p>
          </div>
          <Lock className="w-5 h-5 text-indigo-400" />
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 block font-medium">Firewall & WAF</span>
            <span className="text-sm font-bold text-cyan-400">Shield Active (14ms)</span>
            <p className="text-[10px] text-slate-400 mt-0.5">Rate limit: 120 req/min per IP</p>
          </div>
          <ShieldCheck className="w-5 h-5 text-cyan-400" />
        </div>
      </div>

      {/* RBAC Matrix Table */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Granular Role-Based Permissions Matrix
            </h3>
            <p className="text-xs text-slate-400">
              Super Admin always possesses immutable universal rights. Edit permissions for delegated roles:
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Configuring Role:</span>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as UserRole)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-indigo-300 font-bold focus:outline-none"
            >
              <option value="Admin">Admin</option>
              <option value="Content Manager">Content Manager</option>
              <option value="Sales / CRM">Sales / CRM</option>
              <option value="Support Manager">Support Manager</option>
              <option value="Developer / Technical">Developer / Technical</option>
              <option value="Finance">Finance</option>
              <option value="Read-Only / Auditor">Read-Only / Auditor</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3">Ecosystem Module</th>
                {permissionsList.map((perm) => (
                  <th key={perm.key} className="px-3 py-3 text-center">
                    {perm.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rbacMatrix.map((item) => {
                return (
                  <tr key={item.module} className="hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-semibold text-white capitalize">
                      {item.module}
                    </td>
                    {permissionsList.map((perm) => {
                      const isAllowed = selectedRole === "Super Admin" || item[perm.key];
                      return (
                        <td key={perm.key} className="px-3 py-3 text-center">
                          <button
                            disabled={selectedRole === "Super Admin"}
                            onClick={() =>
                              updateRbacPermission(item.module, perm.key, !item[perm.key])
                            }
                            className={`w-6 h-6 rounded-md inline-flex items-center justify-center transition ${
                              isAllowed
                                ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                                : "bg-slate-800 text-slate-600 hover:text-slate-400 border border-slate-700"
                            }`}
                          >
                            {isAllowed ? "✓" : "—"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Concurrent Sessions & Failed Logins */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sessions */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Active Administrative Sessions
          </h3>

          <div className="space-y-2">
            {activeSessions.map((sess) => (
              <div
                key={sess.id}
                className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{sess.user}</span>
                    <span className="px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-300 text-[10px] font-semibold border border-indigo-500/20">
                      {sess.role}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    {sess.device} • {sess.location} ({sess.ip})
                  </p>
                  <span className="text-[10px] text-emerald-400 mt-1 block">
                    {sess.lastActive}
                  </span>
                </div>

                {!sess.isCurrent && (
                  <button className="px-2.5 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold">
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Failed Login Probes */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>WAF Intrusion Monitor & Threat Prevention</span>
          </h3>

          <div className="space-y-2">
            {failedAttempts.map((fail) => (
              <div
                key={fail.id}
                className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-rose-400 font-bold">{fail.ip}</span>
                    <span className="text-slate-400 text-[11px]">Target: {fail.user}</span>
                  </div>
                  <p className="text-slate-300 text-[11px] mt-0.5">{fail.reason}</p>
                  <span className="text-[10px] text-slate-500 block mt-0.5">{fail.timestamp}</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/30 text-[10px] font-bold">
                  {fail.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
