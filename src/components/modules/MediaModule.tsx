import React, { useState } from "react";
import {
  FolderArchive,
  Search,
  Upload,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Plus,
  X
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { MediaAsset } from "../../types";

export const MediaModule: React.FC = () => {
  const { mediaAssets, saveMediaAsset, deleteMediaAsset } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  // New Asset State
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newCategory, setNewCategory] = useState("Brand & Logos");

  const categories = ["All", ...Array.from(new Set(mediaAssets.map((m) => m.category)))];

  const filteredAssets = mediaAssets.filter((asset) => {
    const matchSearch =
      asset.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      asset.fileName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = selectedCategory === "All" || asset.category === selectedCategory;
    return matchSearch && matchCat;
  });

  const handleCopyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateAsset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newUrl) return;

    const newAsset: MediaAsset = {
      id: `media-${Date.now()}`,
      title: newTitle,
      fileName: newTitle.toLowerCase().replace(/[^a-z0-9]/g, "-") + ".png",
      url: newUrl,
      fileType: "image/png",
      fileSizeKb: 420,
      category: newCategory,
      createdAt: new Date().toISOString()
    };

    saveMediaAsset(newAsset);
    setIsUploadOpen(false);
    setNewTitle("");
    setNewUrl("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FolderArchive className="w-5 h-5 text-indigo-400" />
            <span>Digital Asset & Media Management</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Centralized repository for high-resolution brand assets, product mockups, architecture diagrams, and brochures.
          </p>
        </div>
        <button
          onClick={() => setIsUploadOpen(true)}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Upload className="w-4 h-4" />
          <span>Upload Digital Asset</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search assets by filename or title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              Category: {c}
            </option>
          ))}
        </select>
      </div>

      {/* Media Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredAssets.map((asset) => (
          <div
            key={asset.id}
            className="rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition overflow-hidden flex flex-col justify-between group shadow-sm"
          >
            <div>
              <div className="h-44 bg-slate-950 flex items-center justify-center overflow-hidden p-2 relative">
                <img
                  src={asset.url}
                  alt={asset.title}
                  className="max-h-full max-w-full object-contain group-hover:scale-105 transition duration-300"
                  referrerPolicy="no-referrer"
                />
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded bg-slate-900/80 text-[10px] text-slate-400 font-mono border border-slate-800">
                  {asset.fileSizeKb} KB
                </span>
              </div>

              <div className="p-4">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block mb-0.5">
                  {asset.category}
                </span>
                <h4 className="text-sm font-bold text-white truncate">{asset.title}</h4>
                <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
                  {asset.fileName}
                </p>
              </div>
            </div>

            <div className="p-3 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={() => handleCopyUrl(asset.url, asset.id)}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-semibold"
              >
                {copiedId === asset.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy URL</span>
                  </>
                )}
              </button>

              <button
                onClick={() => deleteMediaAsset(asset.id)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateAsset}
            className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Upload Digital Asset</h3>
              <button
                type="button"
                onClick={() => setIsUploadOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Asset Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Artify Sols Dark Logo Vector"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Public URL / Hosted Asset Link</label>
                <input
                  type="url"
                  required
                  placeholder="https://..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                >
                  <option value="Brand & Logos">Brand & Logos</option>
                  <option value="Product UI">Product UI</option>
                  <option value="Architecture Diagrams">Architecture Diagrams</option>
                  <option value="Customer Case Studies">Customer Case Studies</option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsUploadOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md"
              >
                Register Asset
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
