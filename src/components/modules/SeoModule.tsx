import React, { useState } from "react";
import {
  SearchCheck,
  Globe,
  Share2,
  FileCode2,
  CheckCircle2,
  AlertTriangle,
  Save,
  ExternalLink
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";

export const SeoModule: React.FC = () => {
  const { websitePages } = useAdminData();
  const [selectedPageSlug, setSelectedPageSlug] = useState("/");
  const [metaTitle, setMetaTitle] = useState("Artify Sols | Adaptive Enterprise Software & AI Ecosystem");
  const [metaDescription, setMetaDescription] = useState(
    "Software should adapt your business, not your business adapt software. Explore Artify Sols customized enterprise ERP, HRM, FinTech, and AI suites."
  );
  const [ogImage, setOgImage] = useState("https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=630&q=80");
  const [isIndexable, setIsIndexable] = useState(true);
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <SearchCheck className="w-5 h-5 text-indigo-400" />
            <span>Search Engine Optimization & Social Sharing (SEO)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure OpenGraph tags, JSON-LD schema, canonical headers, and dynamic sitemaps for artifysols.com.
          </p>
        </div>
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Save className="w-4 h-4" />
          <span>{isSaved ? "Saved Successfully!" : "Save SEO Config"}</span>
        </button>
      </div>

      {/* SEO Health Score Banner */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
          <span className="text-[11px] text-slate-400 font-medium">Overall SEO Health</span>
          <p className="text-2xl font-extrabold text-emerald-400 mt-1">98 / 100</p>
          <span className="text-[10px] text-slate-400">Google Core Web Vitals Pass</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
          <span className="text-[11px] text-slate-400 font-medium">Indexed URLs</span>
          <p className="text-2xl font-extrabold text-white mt-1">42 Pages</p>
          <span className="text-[10px] text-slate-400">Updated in sitemap.xml</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
          <span className="text-[11px] text-slate-400 font-medium">Structured Schemas</span>
          <p className="text-2xl font-extrabold text-indigo-400 mt-1">Organization + SoftwareApp</p>
          <span className="text-[10px] text-slate-400">Rich Snippets Enabled</span>
        </div>
        <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
          <span className="text-[11px] text-slate-400 font-medium">Canonical Status</span>
          <p className="text-2xl font-extrabold text-cyan-400 mt-1">100% Enforced</p>
          <span className="text-[10px] text-slate-400">Strict HTTPS / Non-www</span>
        </div>
      </div>

      {/* Page Selector & Form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Page Meta Configuration
          </h3>

          <div>
            <label className="block text-slate-400 text-xs mb-1">Target Page</label>
            <select
              value={selectedPageSlug}
              onChange={(e) => setSelectedPageSlug(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100"
            >
              {websitePages.map((pg) => (
                <option key={pg.id} value={pg.slug}>
                  {pg.title} ({pg.slug})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Page Title ({metaTitle.length}/60 chars)</span>
              {metaTitle.length > 60 && <span className="text-amber-400">Slightly long</span>}
            </div>
            <input
              type="text"
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Meta Description ({metaDescription.length}/160 chars)</span>
            </div>
            <textarea
              rows={3}
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1">OpenGraph Share Image URL</label>
            <input
              type="text"
              value={ogImage}
              onChange={(e) => setOgImage(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="indexing"
              checked={isIndexable}
              onChange={(e) => setIsIndexable(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-indigo-500 focus:ring-0"
            />
            <label htmlFor="indexing" className="text-xs text-slate-300">
              Allow search engines to index this page (robots: index, follow)
            </label>
          </div>
        </div>

        {/* Live Search & Social Preview */}
        <div className="space-y-4">
          {/* Google Search Result Preview */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-3">
              Google Search Result Snippet
            </span>
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold">
                  A
                </div>
                <span className="text-xs text-slate-400">
                  https://artifysols.com{selectedPageSlug === "/" ? "" : selectedPageSlug}
                </span>
              </div>
              <h4 className="text-base text-indigo-400 font-medium hover:underline cursor-pointer">
                {metaTitle}
              </h4>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {metaDescription}
              </p>
            </div>
          </div>

          {/* Social Card Preview */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-3">
              Social Card Preview (Twitter / LinkedIn)
            </span>
            <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
              <img
                src={ogImage}
                alt="OG Preview"
                className="w-full h-36 object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="p-3">
                <span className="text-[10px] uppercase text-slate-500 font-mono">
                  ARTIFYSOLS.COM
                </span>
                <p className="text-xs font-bold text-white truncate mt-0.5">{metaTitle}</p>
                <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{metaDescription}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
