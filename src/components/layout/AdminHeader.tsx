import React, { useState } from "react";
import {
  Search,
  Calendar,
  Activity,
  Bell,
  Plus,
  ExternalLink,
  RotateCcw,
  Shield,
  Menu,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";

export const AdminHeader: React.FC<{
  onToggleSidebar: () => void;
  onOpenQuickAdd?: () => void;
}> = ({ onToggleSidebar, onOpenQuickAdd }) => {
  const {
    activeModule,
    selectedDateRange,
    setSelectedDateRange,
    setIsSearchOpen,
    currentUser,
    setCurrentView,
    auditLogs,
    resetAllDataToDefaults,
    setActiveModule
  } = useAdminData();

  const [showNotifications, setShowNotifications] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const dateOptions = [
    "Today",
    "Yesterday",
    "Last 7 days",
    "Last 30 days",
    "This month",
    "Last month",
    "Custom range"
  ];

  const recentLogs = auditLogs.slice(0, 5);

  const getModuleTitle = () => {
    switch (activeModule) {
      case "dashboard":
        return "Executive Control Center & KPI Overview";
      case "customers":
        return "Customer & Client Management (360° View)";
      case "leads":
        return "Leads & Enterprise CRM Pipeline";
      case "onboarding":
        return "Customer Onboarding Lifecycle Engine";
      case "subscriptions":
        return "Subscriptions, Plans & Entitlements";
      case "products":
        return "Products & Solutions Catalog";
      case "applications":
        return "Application Ecosystem & Releases (Web/iOS/Android)";
      case "media":
        return "Digital Asset & Media Management";
      case "website":
        return "Website Content & Configurable Sections";
      case "blog":
        return "Blog / Content CMS & AI Assistance";
      case "seo":
        return "Search Engine Optimization & Metadata";
      case "ai":
        return "Enterprise AI Control Center (Gemini Orchestrator)";
      case "analytics":
        return "Website Traffic, Sessions & Conversion Funnel";
      case "notifications":
        return "Notification Engine & Communications";
      case "integrations":
        return "Integrations & API Gateways";
      case "users":
        return "User Management & Directory";
      case "governance":
        return "Governance Control & Permission Matrix";
      case "roles":
        return "Roles & RBAC Governance Matrix";
      case "security":
        return "Security, IAM & Session Controls";
      case "audit":
        return "Immutable Audit Logs & Compliance Trails";
      case "health":
        return "System Health & Infrastructure Diagnostics";
      case "reports":
        return "Centralized Enterprise Reports";
      case "settings":
        return "Administrative & Platform Settings";
      default:
        return "Artify Sols Super Admin";
    }
  };

  return (
    <header className="h-16 bg-slate-900/90 backdrop-blur border-b border-slate-800 px-4 md:px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Left section: Hamburger & Module Name */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          title="Toggle Navigation"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:block">
          <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
            <span>{getModuleTitle()}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          </h1>
          <p className="text-[11px] text-slate-400">
            Artify Sols Central Governance • artifysols.com
          </p>
        </div>
      </div>

      {/* Center / Right controls */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Global Search Button */}
        <button
          onClick={() => setIsSearchOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/80 text-xs transition"
          title="Global Administrative Search (Cmd+K)"
        >
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <span className="hidden md:inline">Quick Search...</span>
          <kbd className="hidden lg:inline-flex px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-400 font-mono">
            ⌘K
          </kbd>
        </button>

        {/* Date Filter Dropdown */}
        <div className="relative hidden md:flex items-center">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/80 text-xs text-slate-300">
            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
            <select
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer pr-1 font-medium"
            >
              {dateOptions.map((opt) => (
                <option key={opt} value={opt} className="bg-slate-900 text-slate-200">
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick Health Indicator */}
        <button
          onClick={() => setActiveModule("health")}
          className="hidden xl:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs font-semibold hover:bg-emerald-950/60 transition"
          title="System Health: 99.99% Operational"
        >
          <Activity className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
          <span>99.99% Health</span>
        </button>

        {/* Quick Add CTA */}
        {onOpenQuickAdd && (
          <button
            onClick={onOpenQuickAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Add Record</span>
          </button>
        )}

        {/* Notification Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition relative"
            title="Recent Activity & Alerts"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-500"></span>
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Recent Audit & System Stream
                </span>
                <button
                  onClick={() => {
                    setShowNotifications(false);
                    setActiveModule("audit");
                  }}
                  className="text-[11px] text-indigo-400 hover:underline"
                >
                  View All Logs
                </button>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {recentLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs hover:bg-slate-800 transition cursor-pointer"
                    onClick={() => {
                      setShowNotifications(false);
                      setActiveModule("audit");
                    }}
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span className="font-semibold text-indigo-400">{log.module}</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-slate-200 font-medium leading-snug">{log.details}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      By {log.userEmail} ({log.userRole})
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Public Website Switcher */}
        <button
          onClick={() => setCurrentView("public_website")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
          title="Open Live Website View"
        >
          <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden lg:inline">Live Website</span>
        </button>

        {/* Seed Reset Button */}
        <div className="relative">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
            title="Reset Demo Data"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {showResetConfirm && (
            <div className="absolute right-0 mt-2 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 z-50">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs mb-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>Restore Factory Demo Data?</span>
              </div>
              <p className="text-xs text-slate-300 mb-3">
                This will reset products, leads, customers, and website content to the original seed state.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    resetAllDataToDefaults();
                    setShowResetConfirm(false);
                  }}
                  className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
                >
                  Reset Data
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
