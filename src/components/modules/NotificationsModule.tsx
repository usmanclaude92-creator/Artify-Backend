import React, { useState } from "react";
import {
  Bell,
  Mail,
  MessageSquare,
  Send,
  CheckCircle2,
  Edit2,
  Clock,
  Sparkles,
  X
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { NotificationTemplate } from "../../types";

export const NotificationsModule: React.FC = () => {
  const { notificationTemplates, saveNotificationTemplate } = useAdminData();
  const [selectedTemplate, setSelectedTemplate] = useState<NotificationTemplate | null>(null);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastTarget, setBroadcastTarget] = useState("All Active Customers");
  const [isSent, setIsSent] = useState(false);

  const handleSendBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMessage.trim()) return;
    setIsSent(true);
    setTimeout(() => {
      setIsSent(false);
      setBroadcastMessage("");
    }, 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-400" />
            <span>Notification Engine & Transactional Communications</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure system dispatch templates, onboarding notices, and enterprise broadcast channels.
          </p>
        </div>
      </div>

      {/* Broadcast Messenger Box */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Send className="w-4 h-4 text-amber-400" />
          <span>Dispatch System Broadcast Notice</span>
        </h3>

        <form onSubmit={handleSendBroadcast} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Target Audience</label>
              <select
                value={broadcastTarget}
                onChange={(e) => setBroadcastTarget(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
              >
                <option value="All Active Customers">All Active Customers (Enterprise)</option>
                <option value="Onboarding Customers">Accounts in Active Onboarding</option>
                <option value="Trial Users">Trialing Organizations</option>
                <option value="All Super Admins">Internal Administrators</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Channel</label>
              <input
                type="text"
                readOnly
                value="In-App Notification Banner + Email Relay"
                className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-400"
              >
              </input>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">Message Content</label>
            <textarea
              rows={3}
              required
              placeholder="e.g. Scheduled maintenance: Artify Cloud instances will undergo routine kernel optimization this Sunday at 02:00 UTC."
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSent ? "Broadcast Dispatched!" : "Send Broadcast Notice"}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Templates List */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Transactional Template Library ({notificationTemplates.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {notificationTemplates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider block">
                      Channel: {tmpl.channel.toUpperCase()}
                    </span>
                    <h4 className="text-base font-bold text-white">{tmpl.name}</h4>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                      tmpl.isActive
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-slate-800 text-slate-500 border-slate-700"
                    }`}
                  >
                    {tmpl.isActive ? "Active" : "Disabled"}
                  </span>
                </div>

                <p className="text-xs text-slate-300 font-medium mb-2">
                  Subject: <span className="text-slate-100">{tmpl.subject}</span>
                </p>

                <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-[11px] text-slate-400 mb-4 whitespace-pre-wrap font-mono">
                  {tmpl.bodyTemplate}
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                  {tmpl.variables.map((v) => (
                    <span
                      key={v}
                      className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700 text-[10px] font-mono"
                    >
                      {`{{${v}}}`}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => setSelectedTemplate(tmpl)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit Template</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Template Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Edit {selectedTemplate.name}</h3>
              <button
                onClick={() => setSelectedTemplate(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Subject Line</label>
                <input
                  type="text"
                  value={selectedTemplate.subject}
                  onChange={(e) =>
                    setSelectedTemplate({ ...selectedTemplate, subject: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Message Body (Supports dynamic tags)</label>
                <textarea
                  rows={5}
                  value={selectedTemplate.bodyTemplate}
                  onChange={(e) =>
                    setSelectedTemplate({ ...selectedTemplate, bodyTemplate: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono text-xs"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setSelectedTemplate(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  saveNotificationTemplate(selectedTemplate);
                  setSelectedTemplate(null);
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md"
              >
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
