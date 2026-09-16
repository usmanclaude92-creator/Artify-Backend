import React, { useState } from "react";
import {
  Package,
  Search,
  Filter,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  Clock,
  Sparkles,
  Smartphone,
  Globe,
  Tag,
  Eye,
  X,
  ExternalLink,
  ChevronRight
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { Product, ProductCategory, ProductStatus } from "../../types";

export const ProductsModule: React.FC = () => {
  const { products, saveProduct, deleteProduct, setCurrentView } = useAdminData();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedStatus, setSelectedStatus] = useState<string>("All");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "features" | "plans" | "seo">("general");

  const categories: ("All" | ProductCategory)[] = [
    "All",
    "Enterprise ERP",
    "HRM & Workforce",
    "FinTech & Billing",
    "AI Business Suite",
    "Mobile Solutions",
    "Bespoke Enterprise"
  ];

  const filteredProducts = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.shortDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = selectedCategory === "All" || p.category === selectedCategory;
    const matchStatus = selectedStatus === "All" || p.status === selectedStatus;
    return matchSearch && matchCat && matchStatus;
  });

  const handleCreateNew = () => {
    const newProd: Product = {
      id: `prod-${Date.now()}`,
      name: "",
      slug: "",
      tagline: "",
      shortDescription: "",
      description: "",
      category: "Enterprise ERP",
      industry: ["Enterprise", "Operations"],
      platforms: ["Web", "Cloud"],
      pricingModel: "Per Seat",
      status: "draft",
      trialAvailable: true,
      trialDurationDays: 14,
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
      seoTitle: "",
      seoDescription: "",
      screenshots: [],
      documents: [],
      features: [
        { id: "f-new-1", title: "Adaptive Schema Engine", description: "Configurable business rules without code changes.", includedInPlans: ["Growth", "Enterprise"] }
      ],
      plans: [
        {
          id: `plan-${Date.now()}`,
          productId: `prod-${Date.now()}`,
          name: "Standard Enterprise",
          code: "STD-ENT",
          priceMonthly: 890,
          priceAnnual: 8900,
          billingInterval: "monthly",
          trialDays: 14,
          maxUsers: 25,
          features: ["Full standard access", "Email support"],
          entitlements: {}
        }
      ]
    };
    setEditingProduct(newProd);
    setActiveTab("general");
    setIsEditModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !editingProduct.name) return;
    const slug = editingProduct.slug || editingProduct.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
    saveProduct({
      ...editingProduct,
      slug,
      updatedAt: new Date().toISOString()
    });
    setIsEditModalOpen(false);
    setEditingProduct(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Package className="w-5 h-5 text-cyan-400" />
            <span>Product & Solution Management</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Database-driven catalog for Artify Sols ERP, HRM, FinTech, and AI suites. Updates publish directly to the live ecosystem website.
          </p>
        </div>
        <button
          onClick={handleCreateNew}
          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Add Product / Solution</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search products, descriptions, or categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                Category: {cat}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 focus:outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
            <option value="coming_soon">Coming Soon</option>
          </select>
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredProducts.map((product) => {
          const statusColors: Record<ProductStatus, string> = {
            published: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
            draft: "bg-amber-500/10 text-amber-400 border-amber-500/30",
            archived: "bg-slate-700 text-slate-400 border-slate-600",
            coming_soon: "bg-purple-500/10 text-purple-400 border-purple-500/30"
          };

          return (
            <div
              key={product.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between group shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider block mb-0.5">
                      {product.category}
                    </span>
                    <h3 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                      {product.name}
                    </h3>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                      statusColors[product.status]
                    }`}
                  >
                    {product.status.replace("_", " ")}
                  </span>
                </div>

                <p className="text-xs text-slate-300 line-clamp-2 mb-3 leading-relaxed">
                  {product.shortDescription}
                </p>

                {/* Platforms & Pricing Info */}
                <div className="space-y-2 mb-4 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>Supported Platforms:</span>
                    <span className="font-semibold text-slate-200">
                      {(product.platforms || []).join(", ")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Pricing Architecture:</span>
                    <span className="font-semibold text-slate-200">
                      {product.pricingModel} ({product.plans?.length || 0} tiers)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Current Release:</span>
                    <span className="font-mono text-cyan-400 font-semibold">
                      v{product.version}
                    </span>
                  </div>
                </div>

                {/* Features highlights */}
                <div className="mb-4">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block mb-1">
                    Key Adaptive Features ({product.features?.length || 0})
                  </span>
                  <div className="space-y-1">
                    {(product.features || []).slice(0, 2).map((feat) => (
                      <div key={feat.id} className="text-xs text-slate-300 flex items-center gap-1.5 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0"></span>
                        <span className="truncate">{feat.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <button
                  onClick={() => setCurrentView("public_website")}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <span>Preview Page</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingProduct(product);
                      setActiveTab("general");
                      setIsEditModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Edit Solution</span>
                  </button>
                  <button
                    onClick={() => deleteProduct(product.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                    title="Archive / Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit / Create Product Modal */}
      {isEditModalOpen && editingProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 flex flex-col max-h-[90vh]"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingProduct.id.startsWith("prod-new") || !editingProduct.name
                    ? "Add Enterprise Solution"
                    : `Edit Solution: ${editingProduct.name}`}
                </h3>
                <p className="text-xs text-slate-400">Database entity configuration</p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-2 border-b border-slate-800 pt-2 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("general")}
                className={`px-3 py-2 font-semibold border-b-2 transition ${
                  activeTab === "general"
                    ? "border-cyan-500 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                General & Description
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("features")}
                className={`px-3 py-2 font-semibold border-b-2 transition ${
                  activeTab === "features"
                    ? "border-cyan-500 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                Features ({editingProduct.features?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("plans")}
                className={`px-3 py-2 font-semibold border-b-2 transition ${
                  activeTab === "plans"
                    ? "border-cyan-500 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                Pricing Plans ({editingProduct.plans?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("seo")}
                className={`px-3 py-2 font-semibold border-b-2 transition ${
                  activeTab === "seo"
                    ? "border-cyan-500 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                SEO & Metadata
              </button>
            </div>

            {/* Tab Body */}
            <div className="py-4 overflow-y-auto flex-1 space-y-4 text-xs">
              {activeTab === "general" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Product Name</label>
                      <input
                        type="text"
                        required
                        value={editingProduct.name}
                        onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">URL Slug</label>
                      <input
                        type="text"
                        value={editingProduct.slug}
                        onChange={(e) => setEditingProduct({ ...editingProduct, slug: e.target.value })}
                        placeholder="e.g. artify-erp-one"
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Category</label>
                      <select
                        value={editingProduct.category}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            category: e.target.value as ProductCategory
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                      >
                        <option value="Enterprise ERP">Enterprise ERP</option>
                        <option value="HRM & Workforce">HRM & Workforce</option>
                        <option value="FinTech & Billing">FinTech & Billing</option>
                        <option value="AI Business Suite">AI Business Suite</option>
                        <option value="Mobile Solutions">Mobile Solutions</option>
                        <option value="Bespoke Enterprise">Bespoke Enterprise</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1">Pricing Model</label>
                      <select
                        value={editingProduct.pricingModel}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            pricingModel: e.target.value as Product["pricingModel"]
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                      >
                        <option value="Per Seat">Per Seat</option>
                        <option value="Tiered Flat">Tiered Flat</option>
                        <option value="Usage Based">Usage Based</option>
                        <option value="Custom Enterprise">Custom Enterprise</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1">Status</label>
                      <select
                        value={editingProduct.status}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            status: e.target.value as ProductStatus
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                      >
                        <option value="published">Published</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                        <option value="coming_soon">Coming Soon</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">Tagline</label>
                    <input
                      type="text"
                      value={editingProduct.tagline}
                      onChange={(e) => setEditingProduct({ ...editingProduct, tagline: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">Short Description (for cards & website)</label>
                    <textarea
                      rows={2}
                      value={editingProduct.shortDescription}
                      onChange={(e) =>
                        setEditingProduct({ ...editingProduct, shortDescription: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">Full Architectural Narrative</label>
                    <textarea
                      rows={4}
                      value={editingProduct.description}
                      onChange={(e) =>
                        setEditingProduct({ ...editingProduct, description: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                    />
                  </div>
                </div>
              )}

              {activeTab === "features" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white uppercase text-[11px]">Feature List</span>
                    <button
                      type="button"
                      onClick={() => {
                        const newF = {
                          id: `f-${Date.now()}`,
                          title: "New Adaptive Capability",
                          description: "Custom rule engine and automated reconciliation.",
                          includedInPlans: ["Growth", "Enterprise"]
                        };
                        setEditingProduct({
                          ...editingProduct,
                          features: [...editingProduct.features, newF]
                        });
                      }}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold"
                    >
                      + Add Feature
                    </button>
                  </div>

                  {editingProduct.features.map((feat, idx) => (
                    <div
                      key={feat.id}
                      className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <input
                          type="text"
                          value={feat.title}
                          onChange={(e) => {
                            const updated = [...editingProduct.features];
                            updated[idx].title = e.target.value;
                            setEditingProduct({ ...editingProduct, features: updated });
                          }}
                          className="font-bold text-white bg-slate-900 px-2 py-1 rounded border border-slate-700 w-2/3"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProduct({
                              ...editingProduct,
                              features: editingProduct.features.filter((f) => f.id !== feat.id)
                            });
                          }}
                          className="text-rose-400 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        type="text"
                        value={feat.description}
                        onChange={(e) => {
                          const updated = [...editingProduct.features];
                          updated[idx].description = e.target.value;
                          setEditingProduct({ ...editingProduct, features: updated });
                        }}
                        className="text-slate-300 bg-slate-900 px-2 py-1 rounded border border-slate-700 w-full"
                      />
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "plans" && (
                <div className="space-y-3">
                  <span className="font-bold text-white uppercase text-[11px] block">
                    Product Tier Pricing
                  </span>
                  {editingProduct.plans.map((pl, idx) => (
                    <div
                      key={pl.id}
                      className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 grid grid-cols-1 sm:grid-cols-3 gap-2"
                    >
                      <div>
                        <label className="text-[10px] text-slate-400 block">Plan Name</label>
                        <input
                          type="text"
                          value={pl.name}
                          onChange={(e) => {
                            const updated = [...editingProduct.plans];
                            updated[idx].name = e.target.value;
                            setEditingProduct({ ...editingProduct, plans: updated });
                          }}
                          className="w-full bg-slate-900 px-2 py-1 rounded border border-slate-700 text-white font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block">Monthly Price ($)</label>
                        <input
                          type="number"
                          value={pl.priceMonthly}
                          onChange={(e) => {
                            const updated = [...editingProduct.plans];
                            updated[idx].priceMonthly = Number(e.target.value);
                            setEditingProduct({ ...editingProduct, plans: updated });
                          }}
                          className="w-full bg-slate-900 px-2 py-1 rounded border border-slate-700 text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block">Max Seats</label>
                        <input
                          type="number"
                          value={pl.maxUsers}
                          onChange={(e) => {
                            const updated = [...editingProduct.plans];
                            updated[idx].maxUsers = Number(e.target.value);
                            setEditingProduct({ ...editingProduct, plans: updated });
                          }}
                          className="w-full bg-slate-900 px-2 py-1 rounded border border-slate-700 text-white"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "seo" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-slate-400 mb-1">SEO Title</label>
                    <input
                      type="text"
                      value={editingProduct.seoTitle}
                      onChange={(e) => setEditingProduct({ ...editingProduct, seoTitle: e.target.value })}
                      placeholder="e.g. Artify ERP One | Adaptive Enterprise Resource Planning"
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Meta Description</label>
                    <textarea
                      rows={3}
                      value={editingProduct.seoDescription}
                      onChange={(e) =>
                        setEditingProduct({ ...editingProduct, seoDescription: e.target.value })
                      }
                      placeholder="Search engine summary (up to 160 characters)..."
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md"
              >
                Save Solution
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
