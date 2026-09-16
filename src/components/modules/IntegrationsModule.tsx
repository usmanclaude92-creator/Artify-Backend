import React, { useState } from "react";
import {
  Plug,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
  Settings2,
  KeyRound,
  X
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { IntegrationConfig } from "../../types";

export const IntegrationsModule: React.FC = () => {
  const { integrations, updateIntegration } = useAdminData();
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationConfig | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleToggle = (intg: IntegrationConfig) => {
    updateIntegration({
      ...intg,
      status: intg.status === "connected" ? "disconnected" : "connected",
      lastSyncAt: new Date().toISOString()
    });
  };

  const handleTestConnection = (intg: IntegrationConfig) => {
    setIsTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setIsTesting(false);
      setTestResult("Handshake successful (HTTP 200 • Latency: 42ms)");
    }, 1200);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Plug className="w-5 h-5 text-indigo-400" />
            <span>Integrations, Webhooks & API Gateways</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage payment gateways, email relays, SMS dispatchers, analytics pipelines, and AI cloud endpoints.
          </p>
        </div>
      </div>

      {/* Integrations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {integrations.map((intg) => {
          const statusColors = {
            connected: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
            disconnected: "bg-slate-700 text-slate-400 border-slate-600",
            error: "bg-rose-500/10 text-rose-400 border-rose-500/30"
          };

          return (
            <div
              key={intg.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between group shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">
                      {intg.category}
                    </span>
                    <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors">
                      {intg.providerName}
                    </h3>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                      statusColors[intg.status]
                    }`}
                  >
                    {intg.status}
                  </span>
                </div>

                <p className="text-xs text-slate-300 mb-4">{intg.description}</p>

                <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-[11px] text-slate-400 space-y-1.5 mb-4">
                  <div className="flex justify-between">
                    <span>Mode:</span>
                    <span className="font-semibold text-white">
                      {intg.isTestMode ? "Sandbox / Test" : "Live Production"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last Telemetry Sync:</span>
                    <span className="text-slate-300">
                      {new Date(intg.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => setSelectedIntegration(intg)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>Configure</span>
                </button>
                <button
                  onClick={() => handleToggle(intg)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                    intg.status === "connected"
                      ? "text-rose-400 hover:bg-rose-500/10"
                      : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30"
                  }`}
                >
                  {intg.status === "connected" ? "Disconnect" : "Connect Gateway"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Configuration Modal */}
      {selectedIntegration && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">
                Configure {selectedIntegration.providerName}
              </h3>
              <button
                onClick={() => {
                  setSelectedIntegration(null);
                  setTestResult(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Webhook Endpoint URL</label>
                <input
                  type="text"
                  readOnly
                  value={`https://artifysols.com/api/webhooks/${selectedIntegration.providerName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Environment Mode</label>
                <select
                  value={selectedIntegration.isTestMode ? "test" : "live"}
                  onChange={(e) =>
                    setSelectedIntegration({
                      ...selectedIntegration,
                      isTestMode: e.target.value === "test"
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                >
                  <option value="test">Sandbox / Testing</option>
                  <option value="live">Live Production</option>
                </select>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => handleTestConnection(selectedIntegration)}
                  disabled={isTesting}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-400 border border-slate-700 font-semibold flex items-center gap-1.5"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isTesting ? "animate-spin" : ""}`} />
                  <span>{isTesting ? "Testing Handshake..." : "Ping API Gateway"}</span>
                </button>
                {testResult && (
                  <p className="text-emerald-400 text-[11px] mt-2 font-mono">
                    ✓ {testResult}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => {
                  setSelectedIntegration(null);
                  setTestResult(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Close
              </button>
              <button
                onClick={() => {
                  updateIntegration(selectedIntegration);
                  setSelectedIntegration(null);
                  setTestResult(null);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
