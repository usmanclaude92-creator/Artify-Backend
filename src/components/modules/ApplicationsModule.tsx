import React, { useState } from "react";
import {
  Smartphone,
  Globe,
  Plus,
  Download,
  ExternalLink,
  CheckCircle2,
  Clock,
  Edit2,
  Trash2,
  X,
  AlertCircle
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { AppRelease, AppPlatform } from "../../types";

export const ApplicationsModule: React.FC = () => {
  const { appReleases, saveAppRelease, deleteAppRelease } = useAdminData();
  const [selectedPlatform, setSelectedPlatform] = useState<string>("All");
  const [editingRelease, setEditingRelease] = useState<AppRelease | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const filteredReleases = appReleases.filter((rel) => {
    return selectedPlatform === "All" || rel.platform === selectedPlatform;
  });

  const handleOpenAdd = () => {
    const newR: AppRelease = {
      id: `app-${Date.now()}`,
      appName: "Artify ERP Mobile",
      platform: "Android",
      version: "2.4.0",
      buildNumber: 120,
      releaseStatus: "Beta",
      releaseNotes: "Integrated barcode scanner for warehouse inventory and offline sync.",
      downloadUrl: "https://artifysols.com/downloads/android-beta.apk",
      minOsVersion: "Android 10+",
      activeInstalls: 450,
      releasedAt: new Date().toISOString()
    };
    setEditingRelease(newR);
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRelease || !editingRelease.appName) return;
    saveAppRelease(editingRelease);
    setIsModalOpen(false);
    setEditingRelease(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-cyan-400" />
            <span>Application Ecosystem & Releases</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage native Android, iOS, Web App, and Cloud runtime builds, store links, and enterprise binary distributions.
          </p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Publish New App Release</span>
        </button>
      </div>

      {/* Platform Filter */}
      <div className="flex gap-2 border-b border-slate-800 pb-3 text-xs">
        {["All", "Web", "Android", "iOS", "Cloud Runtime"].map((plat) => (
          <button
            key={plat}
            onClick={() => setSelectedPlatform(plat)}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              selectedPlatform === plat
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            {plat}
          </button>
        ))}
      </div>

      {/* Releases Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredReleases.map((rel) => {
          const statusColors = {
            Production: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
            Beta: "bg-amber-500/10 text-amber-400 border-amber-500/30",
            "In Review": "bg-purple-500/10 text-purple-400 border-purple-500/30",
            Deprecated: "bg-slate-700 text-slate-400 border-slate-600"
          };

          return (
            <div
              key={rel.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between group shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider block">
                      {rel.platform} Build #{rel.buildNumber}
                    </span>
                    <h3 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                      {rel.appName}
                    </h3>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                      statusColors[rel.releaseStatus]
                    }`}
                  >
                    {rel.releaseStatus}
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-xl font-extrabold text-white font-mono">v{rel.version}</span>
                  <span className="text-xs text-slate-400">Min OS: {rel.minOsVersion}</span>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs text-slate-300 mb-4">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
                    Release Notes:
                  </span>
                  <p className="leading-relaxed">{rel.releaseNotes}</p>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-4">
                  <span>Active Device Installs:</span>
                  <span className="font-bold text-white">{rel.activeInstalls.toLocaleString()}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <a
                  href={rel.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download / Store</span>
                </a>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingRelease(rel);
                      setIsModalOpen(true);
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteAppRelease(rel.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Release Modal */}
      {isModalOpen && editingRelease && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Application Ecosystem Release</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Application Name</label>
                  <input
                    type="text"
                    required
                    value={editingRelease.appName}
                    onChange={(e) =>
                      setEditingRelease({ ...editingRelease, appName: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Target Platform</label>
                  <select
                    value={editingRelease.platform}
                    onChange={(e) =>
                      setEditingRelease({
                        ...editingRelease,
                        platform: e.target.value as AppPlatform
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  >
                    <option value="Web">Web Application</option>
                    <option value="Android">Android</option>
                    <option value="iOS">iOS</option>
                    <option value="Cloud Runtime">Cloud Runtime</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Version String</label>
                  <input
                    type="text"
                    required
                    value={editingRelease.version}
                    onChange={(e) =>
                      setEditingRelease({ ...editingRelease, version: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Build Number</label>
                  <input
                    type="number"
                    value={editingRelease.buildNumber}
                    onChange={(e) =>
                      setEditingRelease({
                        ...editingRelease,
                        buildNumber: Number(e.target.value)
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Release Stage</label>
                  <select
                    value={editingRelease.releaseStatus}
                    onChange={(e) =>
                      setEditingRelease({
                        ...editingRelease,
                        releaseStatus: e.target.value as AppRelease["releaseStatus"]
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  >
                    <option value="Production">Production</option>
                    <option value="Beta">Beta</option>
                    <option value="In Review">In Review</option>
                    <option value="Deprecated">Deprecated</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Download / Store URL</label>
                <input
                  type="text"
                  value={editingRelease.downloadUrl}
                  onChange={(e) =>
                    setEditingRelease({ ...editingRelease, downloadUrl: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Release Notes</label>
                <textarea
                  rows={3}
                  value={editingRelease.releaseNotes}
                  onChange={(e) =>
                    setEditingRelease({ ...editingRelease, releaseNotes: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md"
              >
                Save Release Build
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
