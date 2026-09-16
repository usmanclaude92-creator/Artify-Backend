import React, { useState } from "react";
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Filter,
  TrendingUp,
  DollarSign,
  Users,
  Contact2,
  FileText
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";

export const ReportsModule: React.FC = () => {
  const { customers, subscriptions, leads, users, selectedDateRange } = useAdminData();
  const [selectedReportType, setSelectedReportType] = useState<"revenue" | "leads" | "customers" | "users">("revenue");

  const activeSubs = subscriptions.filter((s) => s.status === "active");
  const totalMRR = activeSubs.reduce(
    (acc, s) => acc + (s.billingCycle === "annual" ? s.amount / 12 : s.amount),
    0
  );

  const handleExportCsv = () => {
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    let filename = `artify_${selectedReportType}_report.csv`;

    if (selectedReportType === "revenue") {
      headers = ["Subscription ID", "Customer", "Product", "Plan", "Billing Cycle", "Amount", "Currency", "Status"];
      rows = subscriptions.map((s) => [s.id, s.customerName, s.productName, s.planName, s.billingCycle, s.amount, s.currency, s.status]);
    } else if (selectedReportType === "leads") {
      headers = ["Lead ID", "Company", "Contact Name", "Email", "Product Interest", "Stage", "Source", "Est Value"];
      rows = leads.map((l) => [l.id, l.companyName, l.name, l.email, l.productInterest, l.stage, l.leadSource, l.estimatedValue]);
    } else if (selectedReportType === "customers") {
      headers = ["Customer ID", "Company Name", "Industry", "Status", "Account Manager", "Total Spend", "Joined At"];
      rows = customers.map((c) => [c.id, c.name, c.industry, c.status, c.accountManager, c.totalSpend, c.joinedAt]);
    } else {
      headers = ["User ID", "Name", "Email", "Role", "Department", "Status", "Last Login"];
      rows = users.map((u) => [u.id, u.name, u.email, u.role, u.department, u.status, u.lastLoginAt || "N/A"]);
    }

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
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
            <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
            <span>Centralized Enterprise Reporting & Data Export</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit-grade business reports covering ARR runs, customer aging, pipeline conversion, and staff utilization ({selectedDateRange}).
          </p>
        </div>
        <button
          onClick={handleExportCsv}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Download className="w-4 h-4" />
          <span>Export {selectedReportType.toUpperCase()} Dataset (CSV)</span>
        </button>
      </div>

      {/* Report Types Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setSelectedReportType("revenue")}
          className={`p-4 rounded-xl border text-left transition ${
            selectedReportType === "revenue"
              ? "bg-indigo-950/40 border-indigo-500/50 shadow-md"
              : "bg-slate-900 border-slate-800 hover:border-slate-700"
          }`}
        >
          <DollarSign className="w-5 h-5 text-emerald-400 mb-1" />
          <span className="font-bold text-white text-sm block">Revenue & MRR</span>
          <span className="text-[11px] text-slate-400">Run-rate: ${Math.round(totalMRR).toLocaleString()}</span>
        </button>

        <button
          onClick={() => setSelectedReportType("leads")}
          className={`p-4 rounded-xl border text-left transition ${
            selectedReportType === "leads"
              ? "bg-indigo-950/40 border-indigo-500/50 shadow-md"
              : "bg-slate-900 border-slate-800 hover:border-slate-700"
          }`}
        >
          <Contact2 className="w-5 h-5 text-purple-400 mb-1" />
          <span className="font-bold text-white text-sm block">Leads & Pipeline</span>
          <span className="text-[11px] text-slate-400">{leads.length} Tracked Opportunities</span>
        </button>

        <button
          onClick={() => setSelectedReportType("customers")}
          className={`p-4 rounded-xl border text-left transition ${
            selectedReportType === "customers"
              ? "bg-indigo-950/40 border-indigo-500/50 shadow-md"
              : "bg-slate-900 border-slate-800 hover:border-slate-700"
          }`}
        >
          <TrendingUp className="w-5 h-5 text-cyan-400 mb-1" />
          <span className="font-bold text-white text-sm block">Client Portfolio</span>
          <span className="text-[11px] text-slate-400">{customers.length} Enterprise Accounts</span>
        </button>

        <button
          onClick={() => setSelectedReportType("users")}
          className={`p-4 rounded-xl border text-left transition ${
            selectedReportType === "users"
              ? "bg-indigo-950/40 border-indigo-500/50 shadow-md"
              : "bg-slate-900 border-slate-800 hover:border-slate-700"
          }`}
        >
          <Users className="w-5 h-5 text-amber-400 mb-1" />
          <span className="font-bold text-white text-sm block">Staff & Access</span>
          <span className="text-[11px] text-slate-400">{users.length} Provisioned Identities</span>
        </button>
      </div>

      {/* Report Data Table Preview */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Tabular Report Preview ({selectedReportType.toUpperCase()})
          </h3>
          <span className="text-xs text-slate-400">
            Filtered by active tenant scope
          </span>
        </div>

        <div className="overflow-x-auto">
          {selectedReportType === "revenue" && (
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-[11px] uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Solution</th>
                  <th className="px-3 py-2.5">Plan Tier</th>
                  <th className="px-3 py-2.5">Billing</th>
                  <th className="px-3 py-2.5">Amount</th>
                  <th className="px-3 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {subscriptions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-3 font-bold text-white">{s.customerName}</td>
                    <td className="px-3 py-3 text-slate-300">{s.productName}</td>
                    <td className="px-3 py-3 text-indigo-300">{s.planName}</td>
                    <td className="px-3 py-3 capitalize">{s.billingCycle}</td>
                    <td className="px-3 py-3 font-bold text-white">${s.amount.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right capitalize text-emerald-400">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedReportType === "leads" && (
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-[11px] uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Company</th>
                  <th className="px-3 py-2.5">Contact</th>
                  <th className="px-3 py-2.5">Product Interest</th>
                  <th className="px-3 py-2.5">Pipeline Stage</th>
                  <th className="px-3 py-2.5 text-right">Est. Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {leads.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-3 font-bold text-white">{l.companyName}</td>
                    <td className="px-3 py-3 text-slate-300">{l.name}</td>
                    <td className="px-3 py-3 text-indigo-300">{l.productInterest}</td>
                    <td className="px-3 py-3 capitalize text-purple-400 font-semibold">{l.stage}</td>
                    <td className="px-3 py-3 text-right font-bold text-white">${l.estimatedValue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedReportType === "customers" && (
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-[11px] uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Company</th>
                  <th className="px-3 py-2.5">Industry</th>
                  <th className="px-3 py-2.5">Account Manager</th>
                  <th className="px-3 py-2.5">Total Spend</th>
                  <th className="px-3 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-3 font-bold text-white">{c.name}</td>
                    <td className="px-3 py-3 text-slate-300">{c.industry}</td>
                    <td className="px-3 py-3 text-slate-300">{c.accountManager}</td>
                    <td className="px-3 py-3 font-bold text-emerald-400">${c.totalSpend.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right capitalize text-cyan-400">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedReportType === "users" && (
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-[11px] uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Name</th>
                  <th className="px-3 py-2.5">Email</th>
                  <th className="px-3 py-2.5">Role</th>
                  <th className="px-3 py-2.5">Department</th>
                  <th className="px-3 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-3 font-bold text-white">{u.name}</td>
                    <td className="px-3 py-3 text-slate-300">{u.email}</td>
                    <td className="px-3 py-3 font-semibold text-indigo-300">{u.role}</td>
                    <td className="px-3 py-3 text-slate-300">{u.department}</td>
                    <td className="px-3 py-3 text-right capitalize text-emerald-400">{u.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
