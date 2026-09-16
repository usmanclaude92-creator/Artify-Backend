import React, { useState } from "react";
import {
  Building2,
  Search,
  Filter,
  Plus,
  ExternalLink,
  Mail,
  Phone,
  Calendar,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Edit2,
  Eye,
  X,
  FileText
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { CustomerCompany } from "../../types";

export const CustomersModule: React.FC = () => {
  const { customers, saveCustomer, setActiveModule } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  const [activeCustomerDetail, setActiveCustomerDetail] = useState<CustomerCompany | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerCompany | null>(null);

  const industries = ["All", ...Array.from(new Set(customers.map((c) => c.industry)))];

  const filteredCustomers = customers.filter((c) => {
    const matchSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.contactEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.accountManager.toLowerCase().includes(searchTerm.toLowerCase());
    const matchIndustry = selectedIndustry === "All" || c.industry === selectedIndustry;
    const matchStatus = selectedStatus === "All" || c.status === selectedStatus;
    return matchSearch && matchIndustry && matchStatus;
  });

  const handleOpenAdd = () => {
    const newCust: CustomerCompany = {
      id: `cust-${Date.now()}`,
      name: "",
      industry: "Logistics & Freight",
      size: "100-500 Employees",
      country: "United States",
      website: "https://",
      contactEmail: "",
      contactPhone: "",
      accountManager: "Marcus Vance",
      status: "onboarding",
      onboardingProgress: 10,
      activeProducts: ["Artify ERP One"],
      totalSpend: 12000,
      joinedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      notes: "Newly initiated enterprise deployment."
    };
    setEditingCustomer(newCust);
    setIsEditModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !editingCustomer.name) return;
    saveCustomer(editingCustomer);
    setIsEditModalOpen(false);
    setEditingCustomer(null);
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-400" />
            <span>Customer & Client Directory (360° Lifecycle)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitor enterprise account telemetry, purchased products, active SLAs, and account managers.
          </p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Enterprise Customer</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search company, contact, or account manager..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            value={selectedIndustry}
            onChange={(e) => setSelectedIndustry(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            {industries.map((ind) => (
              <option key={ind} value={ind}>
                Industry: {ind}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="active">Active</option>
            <option value="onboarding">Onboarding</option>
            <option value="trial">Trial</option>
            <option value="churned">Churned</option>
          </select>
        </div>
      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredCustomers.map((customer) => {
          const statusColors = {
            active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
            onboarding: "bg-amber-500/10 text-amber-400 border-amber-500/30",
            trial: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
            churned: "bg-rose-500/10 text-rose-400 border-rose-500/30"
          };

          return (
            <div
              key={customer.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors">
                      {customer.name}
                    </h3>
                    <p className="text-xs text-slate-400">{customer.industry} • {customer.size}</p>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                      statusColors[customer.status] || statusColors.active
                    }`}
                  >
                    {customer.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-slate-300 mb-4">
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{customer.contactEmail}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>{customer.contactPhone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <a
                      href={customer.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:underline truncate"
                    >
                      {customer.website}
                    </a>
                  </div>
                </div>

                {/* Active Products Pills */}
                <div className="mb-4">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block mb-1">
                    Deployed Products
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {customer.activeProducts.map((p) => (
                      <span
                        key={p}
                        className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-indigo-300 font-medium"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Onboarding progress bar if in onboarding */}
                {customer.status === "onboarding" && (
                  <div className="mb-4 space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Onboarding Progress</span>
                      <span className="text-amber-400 font-bold">{customer.onboardingProgress}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${customer.onboardingProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Card Footer */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Spend</span>
                  <span className="font-bold text-white">${customer.totalSpend.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingCustomer(customer);
                      setIsEditModalOpen(true);
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    title="Edit Customer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setActiveCustomerDetail(customer)}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 text-xs font-semibold flex items-center gap-1 transition"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>360° Profile</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Customer 360° Detail Drawer / Modal */}
      {activeCustomerDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                  {activeCustomerDetail.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">{activeCustomerDetail.name}</h3>
                  <p className="text-xs text-slate-400">
                    Account Manager: {activeCustomerDetail.accountManager} • Country: {activeCustomerDetail.country}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveCustomerDetail(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-300">
              {/* Top Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Status</span>
                  <p className="text-sm font-bold text-white capitalize mt-0.5">{activeCustomerDetail.status}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Total Revenue</span>
                  <p className="text-sm font-bold text-emerald-400 mt-0.5">${activeCustomerDetail.totalSpend.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Joined On</span>
                  <p className="text-sm font-bold text-white mt-0.5">
                    {new Date(activeCustomerDetail.joinedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Next Renewal</span>
                  <p className="text-sm font-bold text-cyan-400 mt-0.5">
                    {activeCustomerDetail.renewalDate || "Quarterly"}
                  </p>
                </div>
              </div>

              {/* Company Info & Notes */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 space-y-2">
                <h4 className="font-bold text-white uppercase text-[11px] tracking-wider">
                  Operational Notes & Architecture
                </h4>
                <p className="text-slate-300 leading-relaxed">{activeCustomerDetail.notes}</p>
              </div>

              {/* Deployed Products & Onboarding Shortcut */}
              <div className="space-y-2">
                <h4 className="font-bold text-white uppercase text-[11px] tracking-wider">
                  Active Ecosystem Subscriptions
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activeCustomerDetail.activeProducts.map((prod) => (
                    <div
                      key={prod}
                      className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 flex items-center justify-between"
                    >
                      <span className="font-semibold text-white">{prod}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                        Operational
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  onClick={() => {
                    setActiveCustomerDetail(null);
                    setActiveModule("onboarding");
                  }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                >
                  View Customer Onboarding Pipeline →
                </button>
                <button
                  onClick={() => setActiveCustomerDetail(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700"
                >
                  Close Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Create Customer Modal */}
      {isEditModalOpen && editingCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">
                {editingCustomer.id ? "Edit Customer Record" : "Add Enterprise Customer"}
              </h3>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Company Name</label>
                <input
                  type="text"
                  required
                  value={editingCustomer.name}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Industry</label>
                <input
                  type="text"
                  value={editingCustomer.industry}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, industry: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Contact Email</label>
                <input
                  type="email"
                  required
                  value={editingCustomer.contactEmail}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, contactEmail: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Contact Phone</label>
                <input
                  type="text"
                  value={editingCustomer.contactPhone}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, contactPhone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Account Manager</label>
                <input
                  type="text"
                  value={editingCustomer.accountManager}
                  onChange={(e) => setEditingCustomer({ ...editingCustomer, accountManager: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Status</label>
                <select
                  value={editingCustomer.status}
                  onChange={(e) =>
                    setEditingCustomer({
                      ...editingCustomer,
                      status: e.target.value as CustomerCompany["status"]
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                >
                  <option value="active">Active</option>
                  <option value="onboarding">Onboarding</option>
                  <option value="trial">Trial</option>
                  <option value="churned">Churned</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 text-xs">Operational Notes</label>
              <textarea
                rows={3}
                value={editingCustomer.notes || ""}
                onChange={(e) => setEditingCustomer({ ...editingCustomer, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md"
              >
                Save Customer Record
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
