import React, { useState, useMemo } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Users,
  UserCheck,
  UserX,
  Lock,
  Unlock,
  KeyRound,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  SlidersHorizontal,
  RotateCcw,
  Sparkles,
  Info,
  ArrowUpDown,
  ExternalLink,
  Laptop,
  Smartphone,
  Eye,
  Edit3,
  Trash2,
  FileClock,
  ChevronDown
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { User, UserRole, UserStatus } from "../../types";

export const GovernanceControlModule: React.FC = () => {
  const {
    users = [],
    currentUser,
    rbacMatrix = [],
    updateRbacPermission,
    updateUserRole,
    revokeUserAccess,
    toggleUserStatus,
    revokeUserSession,
    logAuditEvent,
    switchUserRole
  } = useAdminData();

  // Active view tab inside Governance Control
  const [activeTab, setActiveTab] = useState<"users_access" | "permission_matrix">("users_access");

  // User Access Table filters & search
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Permission Matrix state
  const [matrixRole, setMatrixRole] = useState<UserRole>("Admin");

  // Revoke modal state
  const [revokingUser, setRevokingUser] = useState<User | null>(null);
  const [revokeReason, setRevokeReason] = useState("Administrative policy enforcement");

  // Edit Role modal state
  const [editingRoleUser, setEditingRoleUser] = useState<User | null>(null);
  const [newSelectedRole, setNewSelectedRole] = useState<UserRole>("Admin");

  // Permission definition
  const permissionColumns = [
    { key: "canView", label: "View", desc: "Read-only visibility" },
    { key: "canCreate", label: "Create", desc: "Draft and add new entities" },
    { key: "canEdit", label: "Edit", desc: "Modify existing configurations" },
    { key: "canDelete", label: "Delete", desc: "Archive or permanently delete" },
    { key: "canPublish", label: "Publish", desc: "Broadcast live to production" },
    { key: "canApprove", label: "Approve", desc: "Review and sign-off on changes" },
    { key: "canExport", label: "Export", desc: "Extract CSV, PDF, and API dumps" },
    { key: "canManage", label: "Manage", desc: "Root administrative override" }
  ] as const;

  const roleDefinitions: { role: UserRole; badge: string; color: string; desc: string }[] = [
    {
      role: "Super Admin",
      badge: "Root Authority",
      color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
      desc: "Universal immutable administrative power across all business entities and security modules."
    },
    {
      role: "Admin",
      badge: "Full Admin",
      color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
      desc: "Enterprise operations, user provisioning, CRM management, and configuration."
    },
    {
      role: "Content Manager",
      badge: "CMS Lead",
      color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      desc: "Web page authoring, blog publishing, digital assets, and search metadata."
    },
    {
      role: "Sales / CRM",
      badge: "Revenue",
      color: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      desc: "Inbound opportunity qualification, lead progression, and client CRM management."
    },
    {
      role: "Support Manager",
      badge: "Success",
      color: "bg-rose-500/20 text-rose-300 border-rose-500/30",
      desc: "Client account handling, onboarding milestone execution, and ticket resolution."
    },
    {
      role: "Developer / Technical",
      badge: "Engineering",
      color: "bg-sky-500/20 text-sky-300 border-sky-500/30",
      desc: "API gateway orchestration, server telemetry, and integration webhook debugging."
    },
    {
      role: "Finance",
      badge: "Billing",
      color: "bg-teal-500/20 text-teal-300 border-teal-500/30",
      desc: "Subscription plans, MRR billing cycles, invoices, and payment entitlements."
    },
    {
      role: "Read-Only / Auditor",
      badge: "Compliance",
      color: "bg-slate-500/20 text-slate-300 border-slate-500/30",
      desc: "Full inspection and tamper-evident audit log review without mutation privileges."
    }
  ];

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchSearch =
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.department || "").toLowerCase().includes(searchTerm.toLowerCase());

      const matchRole = roleFilter === "ALL" || u.role === roleFilter;
      const matchStatus = statusFilter === "ALL" || u.status === statusFilter;

      return matchSearch && matchRole && matchStatus;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  // Handle access revocation
  const handleConfirmRevoke = () => {
    if (!revokingUser) return;
    revokeUserAccess(revokingUser.id, revokeReason);
    setRevokingUser(null);
    setRevokeReason("Administrative policy enforcement");
  };

  // Handle role edit save
  const handleConfirmRoleChange = () => {
    if (!editingRoleUser) return;
    updateUserRole(editingRoleUser.id, newSelectedRole);
    setEditingRoleUser(null);
  };

  // Emergency: Revoke all non-admin sessions
  const handleEmergencyRevokeSessions = () => {
    const nonAdmins = users.filter((u) => u.role !== "Super Admin" && u.activeSessionsCount > 0);
    nonAdmins.forEach((u) => revokeUserSession(u.id));
    logAuditEvent(
      "EMERGENCY_REVOKE_SESSIONS",
      "Governance & IAM",
      `Emergency protocol: Revoked active sessions for ${nonAdmins.length} non-Super Admin accounts.`
    );
  };

  // Permission calculation
  const totalMatrixItems = rbacMatrix.length * permissionColumns.length;
  const activePermissionsCount = rbacMatrix.reduce((acc, row) => {
    return (
      acc +
      permissionColumns.filter((col) =>
        matrixRole === "Super Admin" ? true : Boolean(row[col.key])
      ).length
    );
  }, 0);

  return (
    <div className="space-y-6">
      {/* Top Banner: Governance Control & Identity Status */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-purple-950/30 to-slate-900 border border-slate-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
              <Shield className="w-3 h-3 text-purple-400" />
              Governance Control Center
            </span>
            <span className="text-xs text-slate-400">
              Operating as: <strong className="text-white">{currentUser.name}</strong> ({currentUser.role})
            </span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mt-1.5 flex items-center gap-2">
            <span>Enterprise Access Governance & Permission Matrix</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Centralized policy orchestration for Artify Sols. Audit user authority, assign granular ecosystem roles, enforce two-factor boundaries, and revoke access instantly.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={handleEmergencyRevokeSessions}
            className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
            title="Terminate active sessions for non-superadmins"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Emergency Session Flush</span>
          </button>

          <div className="flex items-center gap-1.5 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
            <span className="text-[11px] text-slate-400 pl-2">Persona:</span>
            <select
              value={currentUser.role}
              onChange={(e) => switchUserRole(e.target.value as UserRole)}
              className="bg-slate-900 text-indigo-300 text-xs font-bold rounded-lg px-2 py-1 border border-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="Super Admin">Super Admin</option>
              <option value="Admin">Admin</option>
              <option value="Content Manager">Content Manager</option>
              <option value="Sales / CRM">Sales / CRM</option>
              <option value="Support Manager">Support Manager</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary KPI Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Total Accounts</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">{users.length}</span>
            <span className="text-[11px] text-emerald-400 font-medium">
              {users.filter((u) => u.status === "active").length} Active
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Privileged Roles</span>
            <ShieldCheck className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">8</span>
            <span className="text-[11px] text-slate-400 font-medium">Defined Tiers</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>MFA Enforcement</span>
            <KeyRound className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">
              {users.filter((u) => u.mfaEnabled || u.twoFactorEnabled).length}
            </span>
            <span className="text-[11px] text-cyan-400 font-medium">Enforced</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Revoked / Suspended</span>
            <UserX className="w-4 h-4 text-rose-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-rose-400">
              {users.filter((u) => u.status === "suspended" || u.status === "inactive").length}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">Restricted</span>
          </div>
        </div>
      </div>

      {/* Main Tab Controller */}
      <div className="flex border-b border-slate-800 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab("users_access")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            activeTab === "users_access"
              ? "border-purple-500 text-purple-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User Access & Role Assignment ({users.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("permission_matrix")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            activeTab === "permission_matrix"
              ? "border-purple-500 text-purple-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Table-Based Permission Matrix</span>
        </button>
      </div>

      {/* TAB 1: User Access & Role Assignment Table */}
      {activeTab === "users_access" && (
        <div className="space-y-4">
          {/* Filter and Search Bar */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search user name, email, department..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto overflow-x-auto">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Filter className="w-3.5 h-3.5" />
                <span>Role:</span>
              </div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="ALL">All Roles</option>
                <option value="Super Admin">Super Admin</option>
                <option value="Admin">Admin</option>
                <option value="Content Manager">Content Manager</option>
                <option value="Sales / CRM">Sales / CRM</option>
                <option value="Support Manager">Support Manager</option>
                <option value="Developer / Technical">Developer / Technical</option>
                <option value="Finance">Finance</option>
                <option value="Read-Only / Auditor">Read-Only</option>
              </select>

              <div className="flex items-center gap-1.5 text-xs text-slate-400 ml-2">
                <span>Status:</span>
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="pending_invite">Pending Invite</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* User Table */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-800/60 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400">
                  <tr>
                    <th className="px-4 py-3.5">User Identity</th>
                    <th className="px-4 py-3.5">Assigned Role</th>
                    <th className="px-4 py-3.5">Access Status</th>
                    <th className="px-4 py-3.5">MFA / 2FA</th>
                    <th className="px-4 py-3.5">Active Sessions</th>
                    <th className="px-4 py-3.5 text-right">Governance Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-xs">
                        No user accounts match your search filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const isSuperAdmin = user.role === "Super Admin";
                      const isSelf = user.id === currentUser.id;
                      const isSuspended = user.status === "suspended" || user.status === "inactive";

                      return (
                        <tr key={user.id} className="hover:bg-slate-800/30 transition">
                          {/* User Identity */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-300 border border-purple-500/30 flex items-center justify-center font-bold text-xs shrink-0">
                                {user.name.charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-white truncate">{user.name}</span>
                                  {isSelf && (
                                    <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[9px] font-semibold border border-indigo-500/30">
                                      You
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] text-slate-400 block truncate">{user.email}</span>
                                {user.department && (
                                  <span className="text-[10px] text-slate-500">{user.department}</span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Assigned Role */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                  isSuperAdmin
                                    ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                                    : "bg-slate-800 text-slate-200 border-slate-700"
                                }`}
                              >
                                {user.role}
                              </span>
                              <button
                                onClick={() => {
                                  setEditingRoleUser(user);
                                  setNewSelectedRole(user.role);
                                }}
                                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition"
                                title="Change role"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>

                          {/* Access Status */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  user.status === "active"
                                    ? "bg-emerald-400"
                                    : user.status === "suspended"
                                    ? "bg-rose-400 animate-pulse"
                                    : "bg-amber-400"
                                }`}
                              />
                              <span
                                className={`font-semibold capitalize text-xs ${
                                  user.status === "active"
                                    ? "text-emerald-400"
                                    : user.status === "suspended"
                                    ? "text-rose-400"
                                    : "text-amber-400"
                                }`}
                              >
                                {user.status.replace("_", " ")}
                              </span>
                            </div>
                          </td>

                          {/* MFA */}
                          <td className="px-4 py-3.5">
                            {user.mfaEnabled || user.twoFactorEnabled ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Enforced ({user.twoFactorType?.replace("_", " ") || "Auth App"})
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-slate-500 text-[11px]">
                                <XCircle className="w-3.5 h-3.5" />
                                Optional
                              </span>
                            )}
                          </td>

                          {/* Active Sessions */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-slate-300 font-semibold">
                                {user.activeSessionsCount}
                              </span>
                              {user.activeSessionsCount > 0 && (
                                <button
                                  onClick={() => revokeUserSession(user.id)}
                                  className="text-[10px] text-slate-500 hover:text-rose-400 underline transition"
                                  title="Terminate active browser tokens"
                                >
                                  Terminate
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isSuspended ? (
                                <button
                                  onClick={() => toggleUserStatus(user.id)}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold transition flex items-center gap-1"
                                >
                                  <Unlock className="w-3 h-3" />
                                  <span>Restore Access</span>
                                </button>
                              ) : (
                                <button
                                  disabled={isSelf}
                                  onClick={() => setRevokingUser(user)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition flex items-center gap-1 ${
                                    isSelf
                                      ? "bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700"
                                      : "bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                  }`}
                                  title={isSelf ? "Cannot revoke your own root access" : "Revoke access and invalidate sessions"}
                                >
                                  <UserX className="w-3 h-3" />
                                  <span>Revoke Access</span>
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  setEditingRoleUser(user);
                                  setNewSelectedRole(user.role);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition"
                              >
                                Edit Role
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>Showing {filteredUsers.length} of {users.length} registered governance identities</span>
              <span className="flex items-center gap-1 text-indigo-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                Immutable IAM audit trace active
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Clear Table-Based Permission Matrix */}
      {activeTab === "permission_matrix" && (
        <div className="space-y-4">
          {/* Matrix Controls & Role Selector */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Target Governance Role:
                </span>
                <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-bold">
                  {matrixRole}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {roleDefinitions.find((r) => r.role === matrixRole)?.desc}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400">Select Role:</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {roleDefinitions.map((rd) => (
                  <button
                    key={rd.role}
                    onClick={() => setMatrixRole(rd.role)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      matrixRole === rd.role
                        ? "bg-purple-600 text-white shadow-sm"
                        : "bg-slate-800 text-slate-400 hover:text-white border border-slate-700/80"
                    }`}
                  >
                    {rd.role}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Matrix Progress & Policy Stats */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-slate-300">
                <Shield className="w-4 h-4 text-purple-400" />
                <span>Coverage for <strong className="text-white">{matrixRole}</strong>:</span>
              </div>
              <span className="font-mono text-emerald-400 font-bold">
                {activePermissionsCount} / {totalMatrixItems} Rules Active
              </span>
            </div>

            <div className="flex items-center gap-4 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-[9px] font-bold">✓</span>
                <span>Permitted</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 text-[9px] font-bold">✕</span>
                <span>Restricted</span>
              </div>
              {matrixRole === "Super Admin" && (
                <div className="flex items-center gap-1 text-amber-400 font-semibold">
                  <Lock className="w-3 h-3" />
                  <span>Immutable System Root</span>
                </div>
              )}
            </div>
          </div>

          {/* Clear Table-Based Matrix */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-800/80 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400">
                  <tr>
                    <th className="px-4 py-3.5 min-w-[200px]">Ecosystem Module</th>
                    {permissionColumns.map((col) => (
                      <th key={col.key} className="px-3 py-3.5 text-center min-w-[90px]">
                        <div className="flex flex-col items-center">
                          <span>{col.label}</span>
                          <span className="text-[9px] font-normal text-slate-500 lowercase hidden sm:inline">
                            {col.desc}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {rbacMatrix.map((item) => (
                    <tr key={item.module} className="hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3 font-semibold text-white">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                          <span>{item.module}</span>
                        </div>
                      </td>

                      {permissionColumns.map((col) => {
                        const isSuperAdmin = matrixRole === "Super Admin";
                        const isAllowed = isSuperAdmin || Boolean(item[col.key]);

                        return (
                          <td key={col.key} className="px-3 py-3 text-center">
                            <button
                              disabled={isSuperAdmin}
                              onClick={() =>
                                updateRbacPermission(item.module, col.key, !item[col.key])
                              }
                              className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition ${
                                isAllowed
                                  ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30"
                                  : "bg-slate-800 text-slate-600 hover:text-slate-400 border border-slate-700/80"
                              } ${isSuperAdmin ? "cursor-not-allowed opacity-90" : ""}`}
                              title={
                                isSuperAdmin
                                  ? "Super Admin retains universal root permission"
                                  : `Toggle ${col.label} on ${item.module} (Currently: ${
                                      isAllowed ? "Allowed" : "Denied"
                                    })`
                              }
                            >
                              {isAllowed ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : (
                                <XCircle className="w-4 h-4" />
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

            <div className="p-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-purple-400 shrink-0" />
                <span>
                  Click any cell to toggle access on or off. Policies are evaluated real-time at the API routing layer.
                </span>
              </div>
              <span className="font-mono text-slate-500 text-[11px]">
                Audited by Artify Sols Security Subsystem
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Modal 1: Revoke Access Confirmation */}
      {revokingUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center shrink-0">
                <UserX className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Revoke User Access</h3>
                <p className="text-xs text-slate-400">Immediate access suspension & session purge</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-xs space-y-1">
              <p className="text-slate-300">
                Target User: <strong className="text-white">{revokingUser.name}</strong> ({revokingUser.email})
              </p>
              <p className="text-slate-400">
                Current Role: <strong className="text-indigo-300">{revokingUser.role}</strong>
              </p>
              <p className="text-rose-400 text-[11px] pt-1">
                Warning: This will set user status to "Suspended", terminate all {revokingUser.activeSessionsCount} active browser sessions, and block all future API calls until restored.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Audit Reason for Revocation:
              </label>
              <input
                type="text"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                placeholder="e.g., Immediate offboarding, Security policy violation"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setRevokingUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRevoke}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/20 transition flex items-center gap-1.5"
              >
                <UserX className="w-3.5 h-3.5" />
                <span>Confirm Revoke Access</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Edit User Role */}
      {editingRoleUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Modify Governance Role</h3>
                <p className="text-xs text-slate-400">Reassign access level across ecosystem</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/80 text-xs space-y-1">
              <p className="text-slate-300">
                User: <strong className="text-white">{editingRoleUser.name}</strong> ({editingRoleUser.email})
              </p>
              <p className="text-slate-400">
                Current Role: <strong className="text-indigo-300">{editingRoleUser.role}</strong>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Select New Role:</label>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {roleDefinitions.map((rd) => (
                  <div
                    key={rd.role}
                    onClick={() => setNewSelectedRole(rd.role)}
                    className={`p-3 rounded-xl border transition cursor-pointer flex items-start justify-between gap-2 ${
                      newSelectedRole === rd.role
                        ? "bg-purple-950/40 border-purple-500"
                        : "bg-slate-800/60 border-slate-700/80 hover:border-slate-600"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{rd.role}</span>
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border ${rd.color}`}>
                          {rd.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{rd.desc}</p>
                    </div>
                    {newSelectedRole === rd.role && (
                      <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setEditingRoleUser(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRoleChange}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 transition flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Save New Role</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
