import React, { useState } from "react";
import {
  Users,
  Search,
  Plus,
  Shield,
  CheckCircle2,
  Clock,
  UserX,
  KeyRound,
  Edit2,
  X,
  Mail,
  Building
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { User, UserRole, UserStatus } from "../../types";

export const UsersModule: React.FC = () => {
  const { users, saveUser, deleteUser, currentUser } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("All");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  const roles: ("All" | UserRole)[] = [
    "All",
    "Super Admin",
    "Admin",
    "Content Manager",
    "Sales / CRM",
    "Support Manager",
    "Developer / Technical",
    "Finance",
    "Read-Only / Auditor"
  ];

  const filteredUsers = users.filter((u) => {
    const matchSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.department.toLowerCase().includes(searchTerm.toLowerCase());
    const matchRole = selectedRole === "All" || u.role === selectedRole;
    return matchSearch && matchRole;
  });

  const handleOpenInvite = () => {
    const newU: User = {
      id: `usr-${Date.now()}`,
      name: "",
      email: "",
      role: "Sales / CRM",
      status: "pending_invite",
      department: "Enterprise Commercials",
      createdAt: new Date().toISOString(),
      mfaEnabled: false,
      activeSessionsCount: 0,
      twoFactorEnabled: false,
      permissions: ["crm.read", "crm.write", "leads.manage"]
    };
    setEditingUser(newU);
    setIsInviteOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !editingUser.name || !editingUser.email) return;
    saveUser(editingUser);
    setIsInviteOpen(false);
    setEditingUser(null);
  };

  const handleToggleStatus = (u: User) => {
    const nextStatus: UserStatus = u.status === "active" ? "suspended" : "active";
    saveUser({ ...u, status: nextStatus });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            <span>User Management & Granular RBAC</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Govern administrative privileges, departmental scoping, multi-factor authentication, and active staff sessions.
          </p>
        </div>
        <button
          onClick={handleOpenInvite}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Invite Team Member</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search team member, email, or department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              Role: {r}
            </option>
          ))}
        </select>
      </div>

      {/* Users Table */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3">Team Member</th>
                <th className="px-4 py-3">Assigned Role</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">2FA Status</th>
                <th className="px-4 py-3">Account Status</th>
                <th className="px-4 py-3">Last Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredUsers.map((usr) => {
                const statusStyles = {
                  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                  inactive: "bg-slate-800 text-slate-400 border-slate-700",
                  suspended: "bg-rose-500/10 text-rose-400 border-rose-500/30",
                  pending_invite: "bg-amber-500/10 text-amber-400 border-amber-500/30"
                };

                return (
                  <tr key={usr.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-xs">
                          {usr.name.charAt(0) || "U"}
                        </div>
                        <div>
                          <p className="font-bold text-white text-sm">
                            {usr.name}{" "}
                            {usr.id === currentUser.id && (
                              <span className="text-[10px] text-indigo-400 font-normal">
                                (Current Session)
                              </span>
                            )}
                          </p>
                          <p className="text-slate-400 text-[11px]">{usr.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-semibold">
                        {usr.role}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">{usr.department}</td>
                    <td className="px-4 py-3.5">
                      {usr.twoFactorEnabled ? (
                        <span className="text-emerald-400 text-xs font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Enforced
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs">Not Enabled</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                          statusStyles[usr.status]
                        }`}
                      >
                        {usr.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-400 text-[11px]">
                      {usr.lastLoginAt
                        ? new Date(usr.lastLoginAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit"
                          })
                        : "Never"}
                    </td>
                    <td className="px-4 py-3.5 text-right space-x-2">
                      <button
                        onClick={() => {
                          setEditingUser(usr);
                          setIsInviteOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                      >
                        Edit
                      </button>
                      {usr.id !== currentUser.id && (
                        <button
                          onClick={() => handleToggleStatus(usr)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                            usr.status === "active"
                              ? "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/30"
                              : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30"
                          }`}
                        >
                          {usr.status === "active" ? "Suspend" : "Activate"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite / Edit User Modal */}
      {isInviteOpen && editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">
                {editingUser.id.startsWith("usr-new") || !editingUser.name
                  ? "Invite New Enterprise Team Member"
                  : `Edit Privileges: ${editingUser.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setIsInviteOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Jessica Sterling"
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Work Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="j.sterling@artifysols.com"
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Department</label>
                  <input
                    type="text"
                    value={editingUser.department}
                    onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">RBAC Role</label>
                  <select
                    value={editingUser.role}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, role: e.target.value as UserRole })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  >
                    <option value="Super Admin">Super Admin</option>
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

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingUser.twoFactorEnabled}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, twoFactorEnabled: e.target.checked })
                    }
                    className="rounded bg-slate-800 border-slate-700 text-indigo-500"
                  />
                  <span className="text-slate-300">
                    Enforce Multi-Factor Authentication (MFA) on next login
                  </span>
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsInviteOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md"
              >
                Save Member Privileges
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
