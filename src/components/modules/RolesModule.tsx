import React, { useState } from "react";
import {
  Shield,
  ShieldCheck,
  Users,
  CheckCircle2,
  XCircle,
  Lock,
  KeyRound,
  Sliders,
  RotateCcw,
  Sparkles,
  Info
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { UserRole } from "../../types";

export const RolesModule: React.FC = () => {
  const { rbacMatrix = [], updateRbacPermission, users = [], currentUser, switchUserRole } = useAdminData();
  const [selectedRole, setSelectedRole] = useState<UserRole>("Admin");

  const definedRoles: { role: UserRole; title: string; description: string; badge: string; color: string }[] = [
    {
      role: "Super Admin",
      title: "Master Super Admin",
      description: "Root enterprise governance with universal, non-revocable administrative authority.",
      badge: "Universal Access",
      color: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
    },
    {
      role: "Admin",
      title: "Platform Administrator",
      description: "Day-to-day operations, account management, user lifecycles, and configuration.",
      badge: "Full Management",
      color: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
    },
    {
      role: "Content Manager",
      title: "Content & Growth Specialist",
      description: "Authority over website pages, blog entries, digital assets, and search metadata.",
      badge: "CMS Authority",
      color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    },
    {
      role: "Sales / CRM",
      title: "Revenue & Accounts Lead",
      description: "Pipeline prospecting, qualification, lead-to-customer conversion, and client CRM.",
      badge: "Revenue & CRM",
      color: "border-amber-500/40 bg-amber-500/10 text-amber-300"
    },
    {
      role: "Support Manager",
      title: "Customer Success Architect",
      description: "Technical onboarding milestones, client customer accounts, and SLA escalation.",
      badge: "Success & Triage",
      color: "border-rose-500/40 bg-rose-500/10 text-rose-300"
    }
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
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold uppercase tracking-wider">
              Phase 1 RBAC
            </span>
            <span className="text-xs text-slate-400">
              Active Persona: <strong className="text-white">{currentUser.role}</strong>
            </span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2 mt-1">
            <Shield className="w-5 h-5 text-purple-400" />
            <span>Role-Based Access Control (RBAC) & Governance Matrix</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Configure granular functional authorities across ecosystem modules. Policies govern data visibility, creation, destruction, and administrative overrides.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Simulate Persona:</span>
          <select
            value={currentUser.role}
            onChange={(e) => switchUserRole(e.target.value as UserRole)}
            className="px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-indigo-300 font-bold focus:outline-none focus:border-indigo-500 shadow-sm"
          >
            <option value="Super Admin">Super Admin</option>
            <option value="Admin">Admin</option>
            <option value="Content Manager">Content Manager</option>
            <option value="Sales / CRM">Sales / CRM</option>
            <option value="Support Manager">Support Manager</option>
          </select>
        </div>
      </div>

      {/* Roles Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {definedRoles.map((r) => {
          const userCount = users.filter((u) => u.role === r.role).length;
          const isSelected = selectedRole === r.role;
          return (
            <div
              key={r.role}
              onClick={() => setSelectedRole(r.role)}
              className={`p-5 rounded-2xl border transition cursor-pointer shadow-sm flex flex-col justify-between ${
                isSelected
                  ? "bg-slate-900 border-purple-500 ring-1 ring-purple-500/50"
                  : "bg-slate-900/80 border-slate-800 hover:border-slate-700"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">{r.title}</h3>
                    <span className="text-[11px] font-mono text-slate-400">{r.role}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${r.color}`}>
                    {r.badge}
                  </span>
                </div>
                <p className="text-xs text-slate-400 line-clamp-2 mt-1">{r.description}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-slate-500" />
                  <strong className="text-slate-200">{userCount}</strong> assigned users
                </span>
                <span className={`text-[11px] font-semibold ${isSelected ? "text-purple-400" : "text-slate-500"}`}>
                  {isSelected ? "Active Configuration ●" : "Select to inspect"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Granular Permission Table for Selected Role */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">
                Permissions Matrix: <span className="text-purple-400">{selectedRole}</span>
              </h3>
              {selectedRole === "Super Admin" && (
                <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-semibold flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Immutable
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {selectedRole === "Super Admin"
                ? "Super Admin rights are mathematically enforced at system runtime and cannot be revoked."
                : "Toggle specific action rights for this role. Changes immediately update authorization barriers across the app."}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Allowed
            <span className="w-2 h-2 rounded-full bg-slate-600 ml-2"></span> Denied
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
              {rbacMatrix.map((item) => (
                <tr key={item.module} className="hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-semibold text-white">
                    {item.module}
                  </td>
                  {permissionsList.map((perm) => {
                    const isAllowed = selectedRole === "Super Admin" || Boolean(item[perm.key]);
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
                          } ${selectedRole === "Super Admin" ? "cursor-not-allowed opacity-80" : ""}`}
                          title={`${perm.label} on ${item.module}: ${isAllowed ? "Permitted" : "Denied"}`}
                        >
                          {isAllowed ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Info className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>Policy changes are written directly to the tamper-evident audit ledger.</span>
          </div>
          <span className="font-mono text-slate-500 text-[11px]">
            Active Rules: {rbacMatrix.length * permissionsList.length} Policies Checked
          </span>
        </div>
      </div>
    </div>
  );
};
