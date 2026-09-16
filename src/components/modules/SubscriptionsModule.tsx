import React, { useState } from "react";
import {
  CreditCard,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  DollarSign,
  Calendar,
  Building2,
  X
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { Subscription } from "../../types";

export const SubscriptionsModule: React.FC = () => {
  const { subscriptions, updateSubscriptionStatus } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  const [selectedSubDetail, setSelectedSubDetail] = useState<Subscription | null>(null);

  const filteredSubs = subscriptions.filter((s) => {
    const matchSearch =
      s.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.planName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = selectedStatus === "All" || s.status === selectedStatus;
    return matchSearch && matchStatus;
  });

  const totalMRR = subscriptions
    .filter((s) => s.status === "active")
    .reduce((acc, s) => acc + (s.billingCycle === "annual" ? s.amount / 12 : s.amount), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-emerald-400" />
            <span>Subscriptions, Plans & Entitlements</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time recurring billing, seat entitlements, automated renewal schedules, and gateway linkages.
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs">
          <span className="text-slate-400">Total Run-rate MRR: </span>
          <span className="font-extrabold text-emerald-400 text-sm">
            ${Math.round(totalMRR).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search customer, product, or plan code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
        >
          <option value="All">All Statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="past_due">Past Due</option>
          <option value="canceled">Canceled</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Subscriptions Table */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3">Customer & Solution</th>
                <th className="px-4 py-3">Plan Tier</th>
                <th className="px-4 py-3">Billing Cycle</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Renewal Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredSubs.map((sub) => {
                const statusStyles = {
                  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                  trialing: "bg-amber-500/10 text-amber-400 border-amber-500/30",
                  past_due: "bg-rose-500/10 text-rose-400 border-rose-500/30",
                  canceled: "bg-slate-700 text-slate-400 border-slate-600",
                  expired: "bg-slate-800 text-slate-500 border-slate-700"
                };

                return (
                  <tr key={sub.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-white text-sm">{sub.customerName}</p>
                      <p className="text-slate-400 text-[11px]">{sub.productName}</p>
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-slate-200">
                      {sub.planName}
                    </td>
                    <td className="px-4 py-3.5 capitalize text-slate-300">
                      {sub.billingCycle}
                    </td>
                    <td className="px-4 py-3.5 font-bold text-white">
                      ${sub.amount.toLocaleString()} <span className="text-[10px] text-slate-400">/{sub.currency}</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">
                      {sub.currentPeriodEnd}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                          statusStyles[sub.status]
                        }`}
                      >
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right space-x-2">
                      <button
                        onClick={() => setSelectedSubDetail(sub)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium"
                      >
                        Entitlements
                      </button>
                      {sub.status === "active" ? (
                        <button
                          onClick={() => updateSubscriptionStatus(sub.id, "canceled")}
                          className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[11px]"
                        >
                          Cancel
                        </button>
                      ) : sub.status === "trialing" ? (
                        <button
                          onClick={() => updateSubscriptionStatus(sub.id, "active")}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px]"
                        >
                          Activate
                        </button>
                      ) : (
                        <button
                          onClick={() => updateSubscriptionStatus(sub.id, "active")}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                        >
                          Reinstate
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

      {/* Subscription Entitlement Detail Modal */}
      {selectedSubDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">
                  {selectedSubDetail.customerName}
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedSubDetail.productName} • {selectedSubDetail.planName}
                </p>
              </div>
              <button
                onClick={() => setSelectedSubDetail(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700">
                  <span className="text-[10px] text-slate-400 block">Gateway Ref</span>
                  <span className="font-mono text-emerald-400 font-bold">{selectedSubDetail.gatewayRef}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700">
                  <span className="text-[10px] text-slate-400 block">Seats Allocated</span>
                  <span className="font-bold text-white">{selectedSubDetail.seats} Seats</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">
                  Configured Entitlements & SLAs
                </span>
                <div className="flex justify-between py-1 border-b border-slate-700/50">
                  <span>Support SLA:</span>
                  <span className="font-semibold text-white">4-hour Enterprise Response</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-700/50">
                  <span>API Monthly Quota:</span>
                  <span className="font-semibold text-white">5,000,000 requests</span>
                </div>
                <div className="flex justify-between py-1">
                  <span>Storage Allocation:</span>
                  <span className="font-semibold text-white">1,000 GB High-Throughput NVMe</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedSubDetail(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
