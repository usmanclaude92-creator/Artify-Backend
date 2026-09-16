import React, { useState } from "react";
import {
  Globe,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Layers,
  Sparkles,
  CheckCircle2,
  ChevronRight,
  Building2,
  Users,
  Smartphone,
  ExternalLink,
  Lock,
  MessageSquare,
  HelpCircle,
  Laptop,
  Bot,
  Network,
  Activity,
  Zap,
  BarChart3,
  Server,
  Code,
  ShieldAlert,
  Sliders,
  Check
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { Lead, ProductCategory } from "../../types";

export const PublicWebsiteView: React.FC = () => {
  const {
    products,
    websiteSections,
    testimonials,
    faqs,
    createLead,
    setCurrentView,
    systemSettings
  } = useAdminData();

  const [leadCompany, setLeadCompany] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("Artify Swarm™");
  const [leadMessage, setLeadMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const heroSection = websiteSections.find((s) => s.sectionKey === "hero");
  const adaptiveSection = websiteSections.find((s) => s.sectionKey === "adaptive_philosophy");
  const productsSection = websiteSections.find((s) => s.sectionKey === "products_grid");

  const categories: string[] = [
    "All",
    "Autonomous AI Agents",
    "Enterprise AI & RAG",
    "Integration & Data Mesh",
    "Executive Analytics BI",
    "AI Business Suite",
    "Enterprise ERP"
  ];

  const filteredProducts = products.filter((p) => {
    if (selectedCategory === "All") return true;
    return p.category === selectedCategory;
  });

  const handleLeadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadCompany || !leadName || !leadEmail) return;

    createLead({
      companyName: leadCompany,
      name: leadName,
      email: leadEmail,
      phone: leadPhone || "+1 (800) 555-0199",
      productInterest: selectedProduct,
      stage: "New",
      estimatedValue: 64000,
      leadSource: "Website Contact",
      notes: [leadMessage || "Requesting custom enterprise architectural demonstration."],
      assignedStaff: "Jessica Sterling"
    });

    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Admin Return Bar */}
      <div className="sticky top-0 z-50 bg-indigo-950/90 backdrop-blur border-b border-indigo-800/60 px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="font-semibold text-indigo-200">
            Live Preview Mode: artifysols.com
          </span>
          <span className="text-slate-400 hidden sm:inline">
            — Content dynamically rendered from Super Admin database
          </span>
        </div>
        <button
          onClick={() => setCurrentView("admin")}
          className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition flex items-center gap-1.5 shadow-sm"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Return to Super Admin Control Center</span>
        </button>
      </div>

      {/* Website Navigation */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur sticky top-8 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center font-black text-white text-lg shadow-lg shadow-indigo-500/20">
              A
            </div>
            <div>
              <span className="text-lg font-black tracking-tight text-white">
                {systemSettings.companyName}
              </span>
              <span className="text-[10px] text-cyan-400 block -mt-1 font-mono uppercase tracking-wider">
                Enterprise Ecosystem
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-300">
            <a href="#products" className="hover:text-indigo-400 transition">Solutions</a>
            <a href="#architecture" className="hover:text-indigo-400 transition">Kernel V3 Architecture</a>
            <a href="#industries" className="hover:text-indigo-400 transition">Industries</a>
            <a href="#philosophy" className="hover:text-indigo-400 transition">Adaptive Philosophy</a>
            <a href="#testimonials" className="hover:text-indigo-400 transition">Testimonials</a>
            <a href="#faqs" className="hover:text-indigo-400 transition">FAQs</a>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="https://artifysols.com"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 transition"
            >
              <span>artifysols.com</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="#contact"
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center gap-1.5"
            >
              <span>Request Architecture Demo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-24 sm:py-32 border-b border-slate-900">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(99,102,241,0.25),rgba(255,255,255,0))]"></div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/60 border border-indigo-700/50 text-indigo-300 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Next-Generation Adaptive Enterprise Architecture</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight">
            {heroSection ? heroSection.title : "Software should adapt your business, not your business adapt software."}
          </h1>

          <p className="max-w-3xl mx-auto text-base sm:text-lg text-slate-300 leading-relaxed font-normal">
            {heroSection
              ? heroSection.subtitle
              : "Artify Sols delivers custom ERP, Financial, HRM, Mobile, and AI-powered operational suites that dynamically conform to your unique workflow structures—eliminating rigid software compromises."}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <a
              href="#contact"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 transition flex items-center justify-center gap-2"
            >
              <span>Explore Custom Deployment</span>
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#products"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 font-bold text-sm transition"
            >
              Browse Solutions Catalog
            </a>
          </div>

          {/* Social Proof Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-12 border-t border-slate-900/80 mt-12 text-left">
            <div>
              <p className="text-3xl font-extrabold text-white">99.99%</p>
              <p className="text-xs text-slate-400">Enterprise SLA Uptime</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-cyan-400">0%</p>
              <p className="text-xs text-slate-400">Vendor Lock-In Friction</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-indigo-400">14 Days</p>
              <p className="text-xs text-slate-400">Average Onboarding Cycle</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-emerald-400">3.8x</p>
              <p className="text-xs text-slate-400">Efficiency Multiplier</p>
            </div>
          </div>
        </div>
      </section>

      {/* Adaptive Philosophy Section */}
      <section id="philosophy" className="py-20 bg-slate-900/40 border-b border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
            <span className="text-xs font-bold font-mono uppercase text-indigo-400 tracking-wider">
              The Strategic Paradigm
            </span>
            <h2 className="text-3xl font-extrabold text-white">
              Why Traditional SaaS Breaks at Enterprise Scale
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Traditional vendors demand that your organization reshape internal hierarchies, approval policies, and supply chain realities to fit rigid software databases. We invert this model completely.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                <Cpu className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Dynamic Workflow Concurrency</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Rules and schemas adapt at runtime. Whether your billing requires multi-currency split reconciliations or custom manufacturing milestones, Artify executes them natively.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Embedded Gemini 3.8 Intelligence</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                AI is baked directly into the operational layer: automated lead qualification, fraud telemetry, predictive inventory modeling, and executive summary generation.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Sovereign Data Governance</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Multi-tenant isolation, immutable cryptographically verified audit trails, and granular RBAC matrices ensure total compliance with SOC2 and GDPR.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Solutions / Products Section */}
      <section id="products" className="py-20 border-b border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-8">
            <div>
              <span className="text-xs font-bold font-mono uppercase text-indigo-400 tracking-wider">
                Production Solutions Catalog
              </span>
              <h2 className="text-3xl font-extrabold text-white mt-1">
                AI-Native Products & Enterprise Workforces
              </h2>
            </div>
            <p className="text-xs text-slate-400 max-w-md">
              Deploy individually as specialized autonomous point-solutions or coordinate across the entire enterprise using the Artify Kernel V3.0.
            </p>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-8 scrollbar-thin">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                  selectedCategory === cat
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                    : "bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map((p) => (
              <div
                key={p.id}
                className="p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/50 transition flex flex-col justify-between group shadow-sm relative overflow-hidden"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider px-2 py-0.5 rounded-md bg-indigo-950/60 border border-indigo-800/40">
                      {p.category}
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {p.plans[0]?.priceMonthly
                        ? `$${p.plans[0].priceMonthly.toLocaleString()}/mo`
                        : "Custom Enterprise"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-bold text-white group-hover:text-indigo-300 transition">
                      {p.name}
                    </h3>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                      v{p.version}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 mt-2 mb-4 leading-relaxed line-clamp-3">
                    {p.shortDescription || p.description}
                  </p>

                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {p.platforms.map((plat) => (
                      <span
                        key={plat}
                        className="text-[10px] font-semibold text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-md border border-slate-700/50"
                      >
                        {plat}
                      </span>
                    ))}
                  </div>

                  <div className="space-y-1.5 pt-3 border-t border-slate-800/80 mb-6">
                    {p.features.slice(0, 3).map((f) => (
                      <div key={f.id} className="flex items-center gap-2 text-xs text-slate-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate">{f.title}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <a
                  href="#contact"
                  onClick={() => setSelectedProduct(p.name)}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white font-semibold text-xs text-center transition flex items-center justify-center gap-1.5"
                >
                  <span>Request Solution Demo</span>
                  <ChevronRight className="w-4 h-4" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Artify Kernel V3.0 Architecture Showcase */}
      <section id="architecture" className="py-24 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 border-b border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
            <span className="text-xs font-bold font-mono uppercase text-cyan-400 tracking-wider inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/40">
              <Cpu className="w-3.5 h-3.5" />
              <span>Foundation Architecture</span>
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Artify Kernel V3.0: The Atomic Core
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Engineered for organizations that demand high-speed autonomous execution without compromising data sovereignty, audit compliance, or latency SLAs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 hover:border-cyan-500/40 transition">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold">
                <Network className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">Agent Memory Mesh</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Episodic and working memory synchronized across all deployed swarms with millisecond vector indexing.
              </p>
              <div className="pt-2 text-[10px] font-mono text-cyan-400">
                • Sub-50ms Vector Recall
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 hover:border-indigo-500/40 transition">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">Dual-Engine LLM Router</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Intelligent fallback between Gemini 3.8 Flash, Gemini 3.8 Pro, and private fine-tuned local weights.
              </p>
              <div className="pt-2 text-[10px] font-mono text-indigo-400">
                • Zero-Downtime Hot Fallback
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 hover:border-emerald-500/40 transition">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
                <Server className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">Zero-Latency Event Spine</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                High-throughput event bus bridging legacy SQL/SAP databases with real-time webhooks and IoT telemetry.
              </p>
              <div className="pt-2 text-[10px] font-mono text-emerald-400">
                • 100M+ Monthly Events
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 hover:border-purple-500/40 transition">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white">SOC2 & Zero-Trust IAM</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Cryptographically audited action journals, biometric access tokens, and fine-grained per-tenant permissions.
              </p>
              <div className="pt-2 text-[10px] font-mono text-purple-400">
                • Immutable Audit Ledgers
              </div>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800/80 flex flex-col md:flex-row items-center justify-between gap-6 text-xs">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <div>
                <span className="font-bold text-white">Production Gateway Connected: </span>
                <span className="text-slate-400">Artify Kernel V3.0 is serving live enterprise requests at </span>
                <span className="font-mono text-cyan-400">api.artifysols.com</span>
              </div>
            </div>
            <a
              href="#contact"
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-semibold flex items-center gap-1.5 transition"
            >
              <span>Download Architectural Blueprint</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </section>

      {/* Industries Matrix Section */}
      <section id="industries" className="py-20 border-b border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
            <span className="text-xs font-bold font-mono uppercase text-emerald-400 tracking-wider">
              Tailored Sector Deployments
            </span>
            <h2 className="text-3xl font-extrabold text-white">
              Engineered for High-Compliance Global Industries
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Every vertical comes with pre-configured regulatory guardrails, specialized vector schemas, and tailored domain integrations.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: "Finance & Accounting",
                icon: BarChart3,
                desc: "Algorithmic cash forecasting, multi-currency ledger sync, and automated 3-way invoice matching.",
                tag: "ASC 606 & SOX"
              },
              {
                title: "Healthcare & Life Sciences",
                icon: ShieldCheck,
                desc: "HIPAA-sovereign vector embeddings for clinical documentation, trial records, and doctor scheduling.",
                tag: "HIPAA Certified"
              },
              {
                title: "Logistics & Fleet Ops",
                icon: Activity,
                desc: "Real-time dispatch optimization, telematics mesh, driver biometric clock-in, and route forecasting.",
                tag: "Sub-second Telemetry"
              },
              {
                title: "Manufacturing & Industrial",
                icon: Cpu,
                desc: "Predictive equipment maintenance, bill of materials dynamic graph, and supply replenishment swarms.",
                tag: "IoT & SCADA Sync"
              },
              {
                title: "Retail & E-Commerce",
                icon: Bot,
                desc: "Omnichannel inventory sync across Amazon/Shopify, and autonomous 24/7 customer support copilots.",
                tag: "Omnichannel RAG"
              },
              {
                title: "Real Estate & Construction",
                icon: Building2,
                desc: "Multi-tenant lease contract parsing, subcontractor compliance checks, and automated job costing.",
                tag: "Document AI"
              },
              {
                title: "Government & Public Sector",
                icon: Lock,
                desc: "Air-gapped on-premise deployments, zero data leakage boundaries, and citizen query portals.",
                tag: "FedRAMP Ready"
              },
              {
                title: "Professional Services",
                icon: Users,
                desc: "Dynamic resource allocation, automated utilization forecasts, and milestone billing engines.",
                tag: "Capacity AI"
              }
            ].map((ind) => {
              const IconComp = ind.icon;
              return (
                <div
                  key={ind.title}
                  className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                      <IconComp className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">
                      {ind.tag}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white">{ind.title}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">{ind.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-20 bg-slate-900/30 border-b border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold font-mono uppercase text-indigo-400 tracking-wider">
              Customer Voices
            </span>
            <h2 className="text-3xl font-extrabold text-white mt-1">
              Trusted by High-Velocity Enterprises
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div
                key={t.id}
                className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-1 text-amber-400 text-sm mb-3">
                    {"★".repeat(t.rating)}
                  </div>
                  <p className="text-xs text-slate-300 italic leading-relaxed mb-6">
                    "{t.quote}"
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-4 border-t border-slate-800">
                  <img
                    src={t.avatarUrl}
                    alt={t.authorName}
                    className="w-9 h-9 rounded-full object-cover border border-slate-700"
                  />
                  <div>
                    <h4 className="text-xs font-bold text-white">{t.authorName}</h4>
                    <p className="text-[11px] text-slate-400">
                      {t.authorTitle}, {t.companyName}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section id="faqs" className="py-20 border-b border-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <span className="text-xs font-bold font-mono uppercase text-indigo-400 tracking-wider">
              Frequently Asked Questions
            </span>
            <h2 className="text-3xl font-extrabold text-white mt-1">
              Enterprise Evaluation & Technical FAQs
            </h2>
          </div>

          <div className="space-y-4">
            {faqs.map((f) => (
              <div
                key={f.id}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2"
              >
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>{f.question}</span>
                </h4>
                <p className="text-xs text-slate-300 pl-6 leading-relaxed">{f.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact & Inbound Lead Generation Form */}
      <section id="contact" className="py-24 relative">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="p-8 sm:p-12 rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 shadow-2xl space-y-6">
            <div className="text-center max-w-xl mx-auto space-y-2">
              <span className="text-xs font-bold font-mono uppercase text-cyan-400 tracking-wider">
                Initiate Consultation
              </span>
              <h2 className="text-3xl font-extrabold text-white">
                Request an Enterprise Solution Architecture
              </h2>
              <p className="text-xs text-slate-400">
                Directly connect with our engineering architects. Submitting this form writes directly to the Super Admin CRM pipeline.
              </p>
            </div>

            {submitted ? (
              <div className="p-8 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                <h3 className="text-lg font-bold text-white">Consultation Request Received!</h3>
                <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                  Your lead inquiry for <strong>{selectedProduct}</strong> has been logged in the Artify Super Admin control plane. An assigned account architect will review your technical specifications shortly.
                </p>
                <div className="pt-3">
                  <button
                    onClick={() => setSubmitted(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700"
                  >
                    Submit Another Inquiry
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleLeadSubmit} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-400 mb-1">Company / Organization Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Apex Global Logistics"
                      value={leadCompany}
                      onChange={(e) => setLeadCompany(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Your Full Name & Title</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. David Sterling (CTO)"
                      value={leadName}
                      onChange={(e) => setLeadName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-400 mb-1">Corporate Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="d.sterling@apexlogistics.com"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Target Solution Interest</label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => setSelectedProduct(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">
                    Describe your custom workflow requirements & architecture timeline
                  </label>
                  <textarea
                    rows={4}
                    placeholder="We are migrating from an on-prem ERP and require custom automated inventory routing across 12 warehouses..."
                    value={leadMessage}
                    onChange={(e) => setLeadMessage(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-xl shadow-indigo-600/30 transition flex items-center justify-center gap-2"
                >
                  <span>Submit Architecture Evaluation Request</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Website Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-12 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">{systemSettings.companyName}</span>
            <span>•</span>
            <span className="text-slate-400">{systemSettings.tagline}</span>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://artifysols.com"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:underline font-mono"
            >
              artifysols.com
            </a>
            <span>•</span>
            <span>Support: {systemSettings.supportEmail}</span>
            <span>•</span>
            <button
              onClick={() => setCurrentView("admin")}
              className="text-indigo-400 hover:underline font-semibold"
            >
              Admin Portal
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
