import React, { useState } from "react";
import {
  Globe,
  Eye,
  Edit2,
  Plus,
  Trash2,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  Layers,
  Sparkles,
  HelpCircle,
  MessageSquareQuote,
  LayoutTemplate
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { WebsiteSection } from "../../types";

export const WebsiteModule: React.FC = () => {
  const {
    websitePages,
    websiteSections,
    updateWebsiteSection,
    testimonials,
    saveTestimonial,
    deleteTestimonial,
    faqs,
    saveFaq,
    deleteFaq,
    setCurrentView
  } = useAdminData();

  const [activeTab, setActiveTab] = useState<"sections" | "testimonials" | "faqs">("sections");
  const [editingSection, setEditingSection] = useState<WebsiteSection | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-400" />
            <span>Website Management & Configurable Sections</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure live website landing sections, testimonials, FAQs, and ecosystem messaging for artifysols.com.
          </p>
        </div>
        <button
          onClick={() => setCurrentView("public_website")}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <ExternalLink className="w-4 h-4" />
          <span>Preview Live Website</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-3 border-b border-slate-800 text-xs">
        <button
          onClick={() => setActiveTab("sections")}
          className={`pb-3 font-semibold border-b-2 flex items-center gap-2 transition ${
            activeTab === "sections"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Landing Sections ({websiteSections.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("testimonials")}
          className={`pb-3 font-semibold border-b-2 flex items-center gap-2 transition ${
            activeTab === "testimonials"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <MessageSquareQuote className="w-4 h-4" />
          <span>Customer Testimonials ({testimonials.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("faqs")}
          className={`pb-3 font-semibold border-b-2 flex items-center gap-2 transition ${
            activeTab === "faqs"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>Enterprise FAQs ({faqs.length})</span>
        </button>
      </div>

      {/* Tab: Sections */}
      {activeTab === "sections" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {websiteSections.map((sec) => (
              <div
                key={sec.id}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className="text-[10px] uppercase font-mono font-bold text-emerald-400">
                        Section Key: {sec.key}
                      </span>
                      <h3 className="text-base font-bold text-white">{sec.title}</h3>
                    </div>
                    <button
                      onClick={() =>
                        updateWebsiteSection({
                          ...sec,
                          isVisible: !sec.isVisible
                        })
                      }
                      className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border transition ${
                        sec.isVisible
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-slate-800 text-slate-500 border-slate-700"
                      }`}
                    >
                      {sec.isVisible ? "Visible Live" : "Hidden"}
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 mb-3">{sec.subtitle}</p>

                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Primary CTA:</span>
                      <span className="font-semibold text-white">{sec.ctaText || "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Target Route:</span>
                      <span className="font-mono text-indigo-400">{sec.ctaLink || "N/A"}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setEditingSection(sec)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Content</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Testimonials */}
      {activeTab === "testimonials" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => {
                const newT = {
                  id: `test-${Date.now()}`,
                  authorName: "New Enterprise Leader",
                  authorTitle: "VP of Technology",
                  companyName: "Global Corp",
                  quote: "Artify adapted to our custom supply chain requirements effortlessly.",
                  avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&q=80",
                  rating: 5,
                  isFeatured: true
                };
                saveTestimonial(newT);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
            >
              + Add Testimonial
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {testimonials.map((t) => (
              <div
                key={t.id}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <img
                      src={t.avatarUrl}
                      alt={t.authorName}
                      className="w-10 h-10 rounded-full object-cover border border-slate-700"
                    />
                    <div>
                      <h4 className="text-sm font-bold text-white">{t.authorName}</h4>
                      <p className="text-xs text-slate-400">
                        {t.authorTitle} • {t.companyName}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 italic mb-4">"{t.quote}"</p>
                </div>
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-amber-400 font-bold text-xs">{"★".repeat(t.rating)}</span>
                  <button
                    onClick={() => deleteTestimonial(t.id)}
                    className="text-slate-500 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: FAQs */}
      {activeTab === "faqs" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => {
                const newFaq = {
                  id: `faq-${Date.now()}`,
                  question: "How long does custom enterprise deployment take?",
                  answer: "Standard cloud deployments take 24-48 hours. Deep ERP data migration with custom workflows typically spans 2-4 weeks.",
                  category: "Deployment",
                  orderIndex: faqs.length + 1,
                  isPublished: true
                };
                saveFaq(newFaq);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
            >
              + Add FAQ Question
            </button>
          </div>

          <div className="space-y-3">
            {faqs.map((faq) => (
              <div
                key={faq.id}
                className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-bold uppercase">
                      {faq.category}
                    </span>
                    <h4 className="text-sm font-bold text-white">{faq.question}</h4>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed pl-1">{faq.answer}</p>
                </div>
                <button
                  onClick={() => deleteFaq(faq.id)}
                  className="p-1 text-slate-500 hover:text-rose-400 transition shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Section Modal */}
      {editingSection && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white">Edit Landing Section: {editingSection.title}</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Headline / Title</label>
                <input
                  type="text"
                  value={editingSection.title}
                  onChange={(e) => setEditingSection({ ...editingSection, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Subtitle / Architectural Narrative</label>
                <textarea
                  rows={3}
                  value={editingSection.subtitle}
                  onChange={(e) => setEditingSection({ ...editingSection, subtitle: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 mb-1">Primary CTA Button Label</label>
                  <input
                    type="text"
                    value={editingSection.ctaText || ""}
                    onChange={(e) => setEditingSection({ ...editingSection, ctaText: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">CTA Target Route</label>
                  <input
                    type="text"
                    value={editingSection.ctaLink || ""}
                    onChange={(e) => setEditingSection({ ...editingSection, ctaLink: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setEditingSection(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  updateWebsiteSection(editingSection);
                  setEditingSection(null);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md"
              >
                Save Section Content
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
