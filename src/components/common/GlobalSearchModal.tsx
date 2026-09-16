import React, { useState, useMemo, useEffect } from "react";
import {
  Search,
  X,
  Package,
  Building2,
  Contact2,
  BookOpen,
  Globe,
  Users,
  ArrowRight,
  Sparkles
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { SystemModule } from "../../types";

interface SearchResult {
  id: string;
  type: "Product" | "Customer" | "Lead" | "Blog" | "Page" | "User" | "Module";
  title: string;
  subtitle: string;
  targetModule: SystemModule;
  icon: React.ElementType;
}

export const GlobalSearchModal: React.FC = () => {
  const {
    isSearchOpen,
    setIsSearchOpen,
    products,
    customers,
    leads,
    blogPosts,
    websitePages,
    users,
    setActiveModule
  } = useAdminData();

  const [query, setQuery] = useState("");

  useEffect(() => {
    if (isSearchOpen) {
      setQuery("");
    }
  }, [isSearchOpen]);

  const results: SearchResult[] = useMemo(() => {
    if (!query.trim()) {
      return [
        { id: "mod-dash", type: "Module", title: "Executive Dashboard", subtitle: "KPIs, revenue, conversion funnel", targetModule: "dashboard", icon: Sparkles },
        { id: "mod-cust", type: "Module", title: "Customer & Client 360", subtitle: "Active enterprise accounts & contracts", targetModule: "customers", icon: Building2 },
        { id: "mod-lead", type: "Module", title: "Leads & CRM Pipeline", subtitle: "Demo requests and conversion stages", targetModule: "leads", icon: Contact2 },
        { id: "mod-prod", type: "Module", title: "Products & Solutions", subtitle: "ERP, HRM, FinTech, AI Suite", targetModule: "products", icon: Package },
        { id: "mod-ai", type: "Module", title: "AI Control Center", subtitle: "Gemini 3.8 models, prompts, quotas", targetModule: "ai", icon: Sparkles },
        { id: "mod-audit", type: "Module", title: "Immutable Audit Logs", subtitle: "Administrative activity compliance", targetModule: "audit", icon: Sparkles }
      ];
    }

    const q = query.toLowerCase();
    const list: SearchResult[] = [];

    // Products
    products.forEach((p) => {
      if (p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.tagline.toLowerCase().includes(q)) {
        list.push({
          id: p.id,
          type: "Product",
          title: p.name,
          subtitle: `${p.category} • Status: ${p.status}`,
          targetModule: "products",
          icon: Package
        });
      }
    });

    // Customers
    customers.forEach((c) => {
      if (c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q) || c.contactEmail.toLowerCase().includes(q)) {
        list.push({
          id: c.id,
          type: "Customer",
          title: c.name,
          subtitle: `${c.industry} • Account Manager: ${c.accountManager}`,
          targetModule: "customers",
          icon: Building2
        });
      }
    });

    // Leads
    leads.forEach((l) => {
      if (l.companyName.toLowerCase().includes(q) || l.name.toLowerCase().includes(q) || l.productInterest.toLowerCase().includes(q)) {
        list.push({
          id: l.id,
          type: "Lead",
          title: l.companyName,
          subtitle: `Contact: ${l.name} • Interest: ${l.productInterest} [Stage: ${l.stage}]`,
          targetModule: "leads",
          icon: Contact2
        });
      }
    });

    // Blog
    blogPosts.forEach((b) => {
      if (b.title.toLowerCase().includes(q) || b.category.toLowerCase().includes(q) || b.tags.some(t => t.toLowerCase().includes(q))) {
        list.push({
          id: b.id,
          type: "Blog",
          title: b.title,
          subtitle: `By ${b.authorName} • Status: ${b.status}`,
          targetModule: "blog",
          icon: BookOpen
        });
      }
    });

    // Website Pages
    websitePages.forEach((pg) => {
      if (pg.title.toLowerCase().includes(q) || pg.slug.toLowerCase().includes(q)) {
        list.push({
          id: pg.id,
          type: "Page",
          title: pg.title,
          subtitle: `Route: ${pg.slug} • Sections: ${pg.sectionsCount}`,
          targetModule: "website",
          icon: Globe
        });
      }
    });

    // Users
    users.forEach((u) => {
      if (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)) {
        list.push({
          id: u.id,
          type: "User",
          title: u.name,
          subtitle: `${u.email} • Role: ${u.role}`,
          targetModule: "users",
          icon: Users
        });
      }
    });

    return list.slice(0, 12);
  }, [query, products, customers, leads, blogPosts, websitePages, users]);

  if (!isSearchOpen) return null;

  const handleSelect = (item: SearchResult) => {
    setActiveModule(item.targetModule);
    setIsSearchOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-start justify-center pt-20 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Search Input Bar */}
        <div className="p-4 border-b border-slate-800 flex items-center gap-3 bg-slate-900/90">
          <Search className="w-5 h-5 text-indigo-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, customers, CRM leads, CMS posts, pages..."
            className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-sm focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsSearchOpen(false)}
            className="px-2 py-1 rounded bg-slate-800 text-[11px] text-slate-400 hover:text-white border border-slate-700"
          >
            ESC
          </button>
        </div>

        {/* Search Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              No matching records found for "{query}".
            </div>
          ) : (
            results.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={`${item.type}-${item.id}`}
                  onClick={() => handleSelect(item)}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-800/80 transition flex items-center justify-between group border border-transparent hover:border-slate-700/50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-slate-100 group-hover:text-indigo-300 transition-colors truncate">
                          {item.title}
                        </span>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 shrink-0">
                          {item.type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">{item.subtitle}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-1 transition shrink-0 ml-2" />
                </button>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2.5 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
          <span>Global Search Engine</span>
          <span>Press Enter to select • Esc to close</span>
        </div>
      </div>
    </div>
  );
};
