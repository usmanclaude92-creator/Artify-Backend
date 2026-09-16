import React, { useState } from "react";
import {
  Contact2,
  Search,
  Filter,
  Plus,
  ArrowRight,
  CheckCircle2,
  Clock,
  DollarSign,
  UserCheck,
  Building,
  Mail,
  Phone,
  MessageSquare,
  Sparkles,
  X
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { Lead, LeadStage } from "../../types";

export const LeadsModule: React.FC = () => {
  const { leads, updateLeadStage, addLeadNote, convertLeadToCustomer, createLead, setActiveModule } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStage, setSelectedStage] = useState<string>("All");
  const [selectedSource, setSelectedSource] = useState<string>("All");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [newNoteText, setNewNoteText] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Lead Form State
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadEmail, setNewLeadEmail] = useState("");
  const [newLeadCompany, setNewLeadCompany] = useState("");
  const [newLeadProduct, setNewLeadProduct] = useState("Artify ERP One");
  const [newLeadSource, setNewLeadSource] = useState<Lead["leadSource"]>("Demo Request");
  const [newLeadValue, setNewLeadValue] = useState(35000);

  const stages: LeadStage[] = ["New", "Contacted", "Qualified", "Proposal/Opportunity", "Converted", "Lost"];

  const filteredLeads = leads.filter((lead) => {
    const matchSearch =
      lead.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStage = selectedStage === "All" || lead.stage === selectedStage;
    const matchSource = selectedSource === "All" || lead.leadSource === selectedSource;
    return matchSearch && matchStage && matchSource;
  });

  const handleCreateLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadCompany || !newLeadName || !newLeadEmail) return;

    createLead({
      name: newLeadName,
      email: newLeadEmail,
      companyName: newLeadCompany,
      productInterest: newLeadProduct,
      leadSource: newLeadSource,
      stage: "New",
      assignedStaff: "Marcus Vance",
      estimatedValue: Number(newLeadValue) || 30000,
      notes: [`Inbound enquiry created manually in Super Admin (${newLeadSource}).`]
    });

    setIsAddModalOpen(false);
    setNewLeadName("");
    setNewLeadEmail("");
    setNewLeadCompany("");
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !newNoteText.trim()) return;
    addLeadNote(selectedLead.id, newNoteText.trim());
    setNewNoteText("");
    // Update local preview
    setSelectedLead({
      ...selectedLead,
      notes: [newNoteText.trim(), ...selectedLead.notes]
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Contact2 className="w-5 h-5 text-purple-400" />
            <span>Leads & Enterprise CRM Pipeline</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Capture contact enquiries, demo requests, and consultation leads. Qualify and convert directly into active enterprise accounts.
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Capture Inbound Lead</span>
        </button>
      </div>

      {/* Pipeline Stage Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {stages.map((stg) => {
          const count = leads.filter((l) => l.stage === stg).length;
          const isCurrent = selectedStage === stg;
          return (
            <button
              key={stg}
              onClick={() => setSelectedStage(isCurrent ? "All" : stg)}
              className={`p-3 rounded-xl border text-left transition ${
                isCurrent
                  ? "bg-purple-950/40 border-purple-500/50 shadow-sm shadow-purple-500/10"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <span className="text-[11px] font-semibold text-slate-400 block truncate">{stg}</span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-extrabold text-white">{count}</span>
                {isCurrent && <span className="text-[10px] text-purple-400 font-bold">Filtered</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search company, contact name, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            <option value="All">All Stages</option>
            {stages.map((stg) => (
              <option key={stg} value={stg}>
                Stage: {stg}
              </option>
            ))}
          </select>

          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            <option value="All">All Sources</option>
            <option value="Demo Request">Demo Request</option>
            <option value="Website Contact">Website Contact</option>
            <option value="Product Enquiry">Product Enquiry</option>
            <option value="Consultation">Consultation</option>
            <option value="Newsletter">Newsletter</option>
          </select>
        </div>
      </div>

      {/* Leads Table */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/60 border-b border-slate-800 text-[11px] uppercase font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3">Company & Contact</th>
                <th className="px-4 py-3">Product Interest</th>
                <th className="px-4 py-3">Est. Value</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Current Stage</th>
                <th className="px-4 py-3">Assigned Staff</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredLeads.map((lead) => {
                const stageColors: Record<LeadStage, string> = {
                  New: "bg-blue-500/10 text-blue-400 border-blue-500/30",
                  Contacted: "bg-amber-500/10 text-amber-400 border-amber-500/30",
                  Qualified: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
                  "Proposal/Opportunity": "bg-purple-500/10 text-purple-400 border-purple-500/30",
                  Converted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                  Lost: "bg-slate-700 text-slate-400 border-slate-600"
                };

                return (
                  <tr key={lead.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-white text-sm">{lead.companyName}</p>
                      <div className="flex items-center gap-2 text-slate-400 text-[11px] mt-0.5">
                        <span>{lead.name}</span>
                        <span>•</span>
                        <span>{lead.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-medium text-slate-200">{lead.productInterest}</span>
                    </td>
                    <td className="px-4 py-3.5 font-bold text-white">
                      ${lead.estimatedValue.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-semibold">
                        {lead.leadSource}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <select
                        value={lead.stage}
                        onChange={(e) => updateLeadStage(lead.id, e.target.value as LeadStage)}
                        className={`text-[11px] font-semibold rounded-lg px-2.5 py-1 border focus:outline-none cursor-pointer ${
                          stageColors[lead.stage]
                        }`}
                      >
                        {stages.map((stg) => (
                          <option key={stg} value={stg} className="bg-slate-900 text-slate-200">
                            {stg}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300">
                      {lead.assignedStaff}
                    </td>
                    <td className="px-4 py-3.5 text-right space-x-2">
                      <button
                        onClick={() => setSelectedLead(lead)}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition"
                      >
                        Notes ({(lead.notes || []).length})
                      </button>
                      {lead.stage !== "Converted" ? (
                        <button
                          onClick={() => convertLeadToCustomer(lead.id)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold transition"
                          title="Convert to active enterprise customer"
                        >
                          Convert → Customer
                        </button>
                      ) : (
                        <span className="text-[10px] text-emerald-400 font-bold">
                          ✓ Converted
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lead Notes & Details Drawer */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">{selectedLead.companyName}</h3>
                <p className="text-xs text-slate-400">
                  Lead contact: {selectedLead.name} ({selectedLead.email})
                </p>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700">
                  <span className="text-slate-400 text-[10px] block">Product Interest</span>
                  <span className="font-semibold text-white">{selectedLead.productInterest}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700">
                  <span className="text-slate-400 text-[10px] block">Pipeline Value</span>
                  <span className="font-semibold text-emerald-400">${selectedLead.estimatedValue.toLocaleString()}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700">
                  <span className="text-slate-400 text-[10px] block">Stage</span>
                  <span className="font-semibold text-purple-400">{selectedLead.stage}</span>
                </div>
              </div>

              {/* Add Note Input */}
              <form onSubmit={handleAddNote} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Log meeting summary, follow-up call, or requirement..."
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold"
                >
                  Add Note
                </button>
              </form>

              {/* Timeline of notes */}
              <div className="space-y-2">
                <h4 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">
                  Interaction History & Notes
                </h4>
                {(!selectedLead.notes || selectedLead.notes.length === 0) ? (
                  <p className="text-xs text-slate-500">No notes recorded yet.</p>
                ) : (
                  (selectedLead.notes || []).map((n, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs text-slate-200"
                    >
                      {n}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              {selectedLead.stage !== "Converted" ? (
                <button
                  onClick={() => {
                    convertLeadToCustomer(selectedLead.id);
                    setSelectedLead(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md flex items-center gap-1.5"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Convert to Customer Account</span>
                </button>
              ) : (
                <span className="text-xs text-emerald-400 font-semibold">
                  Customer account created & linked
                </span>
              )}
              <button
                onClick={() => setSelectedLead(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Inbound Lead Creator Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateLead}
            className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Capture Enterprise Lead</h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Company Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Industrial Systems"
                  value={newLeadCompany}
                  onChange={(e) => setNewLeadCompany(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Contact Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sarah Connor"
                    value={newLeadName}
                    onChange={(e) => setNewLeadName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Contact Email</label>
                  <input
                    type="email"
                    required
                    placeholder="s.connor@example.com"
                    value={newLeadEmail}
                    onChange={(e) => setNewLeadEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Product Interest</label>
                  <select
                    value={newLeadProduct}
                    onChange={(e) => setNewLeadProduct(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  >
                    <option value="Artify ERP One">Artify ERP One</option>
                    <option value="Artify Workforce HRM">Artify Workforce HRM</option>
                    <option value="Artify FinCore Suite">Artify FinCore Suite</option>
                    <option value="Artify AI Business Suite">Artify AI Business Suite</option>
                    <option value="Artify Bespoke Studio">Artify Bespoke Studio</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Lead Source</label>
                  <select
                    value={newLeadSource}
                    onChange={(e) => setNewLeadSource(e.target.value as Lead["leadSource"])}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  >
                    <option value="Demo Request">Demo Request</option>
                    <option value="Website Contact">Website Contact</option>
                    <option value="Product Enquiry">Product Enquiry</option>
                    <option value="Consultation">Consultation</option>
                    <option value="Newsletter">Newsletter</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Estimated Deal Value ($)</label>
                <input
                  type="number"
                  value={newLeadValue}
                  onChange={(e) => setNewLeadValue(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md"
              >
                Record Inbound Lead
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
