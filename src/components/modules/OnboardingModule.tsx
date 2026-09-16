import React, { useState } from "react";
import {
  Rocket,
  Search,
  CheckCircle2,
  Clock,
  ChevronRight,
  UserCheck,
  Calendar,
  AlertCircle,
  Building2,
  X,
  FileCheck2
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { CustomerOnboardingRecord } from "../../types";

export const OnboardingModule: React.FC = () => {
  const { onboardingRecords, toggleOnboardingStep } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const filteredRecords = onboardingRecords.filter((rec) => {
    const customer = rec.customerName || "";
    const product = rec.productName || "";
    const staff = rec.assignedStaff || rec.assignedLead || "";
    const term = searchTerm.toLowerCase();
    return (
      customer.toLowerCase().includes(term) ||
      product.toLowerCase().includes(term) ||
      staff.toLowerCase().includes(term)
    );
  });

  const selectedRecord = onboardingRecords.find((r) => r.id === selectedRecordId) || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Rocket className="w-5 h-5 text-amber-400" />
            <span>Customer Onboarding Lifecycle Engine</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Oversee technical deployment milestones, data migration schedules, and organizational go-live readiness.
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search account, product, or implementation lead..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span className="font-bold text-amber-400">{onboardingRecords.length}</span> Active Deployments
        </div>
      </div>

      {/* Onboarding Cards */}
      <div className="space-y-4">
        {filteredRecords.map((rec) => {
          const steps = rec.steps || (rec.milestones as any[]) || [];
          const staffName = rec.assignedStaff || rec.assignedLead || "Unassigned Lead";
          const productName = rec.productName || "Enterprise Suite";
          const targetDate = rec.targetCompletionDate || (rec as any).targetGoLive || "TBD";

          return (
            <div
              key={rec.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700/80 transition shadow-sm"
            >
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-base font-bold text-white">{rec.customerName}</span>
                    <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[10px] font-semibold">
                      {productName}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
                      {rec.currentStage}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Implementation Lead: <span className="text-slate-200 font-medium">{staffName}</span> • Target Go-Live:{" "}
                    <span className="text-amber-400 font-medium">{targetDate}</span>
                  </p>
                </div>

                <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className="w-32 md:w-44 text-right">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">Overall Progress</span>
                      <span className="text-amber-400 font-bold">{rec.progressPercentage}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all duration-300"
                        style={{ width: `${rec.progressPercentage}%` }}
                      ></div>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedRecordId(rec.id)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold shrink-0 transition"
                  >
                    View Milestones ({steps.length})
                  </button>
                </div>
              </div>

              {/* Outstanding Requirements preview if any */}
              {rec.outstandingRequirements && rec.outstandingRequirements.length > 0 && (
                <div className="mb-3 p-2.5 rounded-xl bg-amber-950/20 border border-amber-800/30 flex items-start gap-2 text-xs text-amber-300">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-semibold text-amber-200">Pending Prerequisites:</span>
                    <ul className="list-disc list-inside text-amber-300/90 text-[11px]">
                      {rec.outstandingRequirements.map((req, i) => (
                        <li key={i}>{req}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Milestones Flow Steps */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 pt-3 border-t border-slate-800/80">
                {steps.map((step, idx) => {
                  const isDone = Boolean(step.isCompleted || (step as any).status === "completed");
                  return (
                    <button
                      key={step.id}
                      onClick={() => toggleOnboardingStep(rec.id, step.id)}
                      className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between ${
                        isDone
                          ? "bg-emerald-950/20 border-emerald-800/30 text-emerald-300"
                          : "bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <span className="text-[10px] text-slate-400 block font-mono">
                          Step {idx + 1}
                        </span>
                        <p className="text-xs font-semibold truncate">{step.title}</p>
                      </div>
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Milestone Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">
                  {selectedRecord.customerName} — Milestones
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedRecord.productName || "Enterprise Deployment"} Roadmap
                </p>
              </div>
              <button
                onClick={() => setSelectedRecordId(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(selectedRecord.steps || (selectedRecord.milestones as any[]) || []).map((step, idx) => {
                const isDone = Boolean(step.isCompleted || (step as any).status === "completed");
                return (
                  <div
                    key={step.id}
                    className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-xs font-bold text-white">
                        {idx + 1}. {step.title}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{step.description}</p>
                      {step.completedAt && (
                        <span className="text-[10px] text-emerald-400 block mt-1">
                          Completed: {new Date(step.completedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => toggleOnboardingStep(selectedRecord.id, step.id)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold shrink-0 transition ${
                        isDone
                          ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                          : "bg-slate-700 hover:bg-slate-600 text-slate-200"
                      }`}
                    >
                      {isDone ? "Completed ✓" : "Mark Done"}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedRecordId(null)}
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
