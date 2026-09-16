import React, { useState } from "react";
import {
  FileClock,
  Search,
  Filter,
  Download,
  ShieldCheck,
  CheckCircle2,
  Clock,
  RotateCcw
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { AuditLogEntry, SystemModule } from "../../types";

export const AuditLogsModule: React.FC = () => {
  const { auditLogs } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedModule, setSelectedModule] = useState<string>("All");
  const [selectedAction, setSelectedAction] = useState<string>("All");

  const filteredLogs = auditLogs.filter((log) => {
    const matchSearch =
      log.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.ipAddress.toLowerCase().includes(searchTerm.toLowerCase());
    const matchModule = selectedModule === "All" || log.module === selectedModule;
    const matchAction = selectedAction === "All" || log.action === selectedAction;
    return matchSearch && matchModule && matchAction;
  });

  const handleExportCsv = () => {
    const headers = ["ID", "Timestamp", "UserEmail", "UserRole", "Action", "Module", "IP", "Status", "Details"];
    const rows = filteredLogs.map((l) => [
      l.id,
      l.timestamp,
      l.userEmail,
      l.userRole,
      l.action,
      l.module,
      l.ipAddress,
      l.status,
      `"${l.details.replace(/"/g, '""')}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `artify_audit_trail_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FileClock className="w-5 h-5 text-indigo-400" />
            <span>Immutable Administrative Audit Logs</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Full compliance traceability, cryptographic tamper-evident logging of all state mutations, and operator footprints.
          </p>
        </div>
        <button
          onClick={handleExportCsv}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 shadow-sm flex items-center gap-2 transition"
        >
          <Download className="w-4 h-4 text-indigo-400" />
          <span>Export Audit CSV</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search action details, user email, IP address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none capitalize"
          >
            <option value="All">All Modules</option>
            <option value="products">Products</option>
            <option value="leads">Leads</option>
            <option value="customers">Customers</option>
            <option value="subscriptions">Subscriptions</option>
            <option value="website">Website</option>
            <option value="blog">Blog</option>
            <option value="users">Users</option>
            <option value="ai">AI</option>
          </select>

          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            <option value="All">All Actions</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="CONVERT">CONVERT</option>
            <option value="PUBLISH">PUBLISH</option>
          </select>
        </div>
      </div>

      {/* Audit Log Stream Table */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Operator</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Audit Details</th>
                <th className="px-4 py-3">Origin IP</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredLogs.map((log) => {
                const actionColors: Record<string, string> = {
                  CREATE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                  UPDATE: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
                  DELETE: "bg-rose-500/10 text-rose-400 border-rose-500/30",
                  CONVERT: "bg-purple-500/10 text-purple-400 border-purple-500/30",
                  PUBLISH: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30"
                };

                return (
                  <tr key={log.id} className="hover:bg-slate-800/40 transition font-sans">
                    <td className="px-4 py-3 text-slate-400 text-[11px] whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">{log.userEmail}</p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        [{log.userRole}]
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded border ${
                          actionColors[log.action] || "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-indigo-300 capitalize">
                      {log.module}
                    </td>
                    <td className="px-4 py-3 text-slate-200 max-w-xs md:max-w-md truncate">
                      {log.details}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                      {log.ipAddress}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/30 text-[10px] font-bold">
                        {log.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
