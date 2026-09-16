import React, { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Shield,
  FileClock,
  ChevronRight,
  Sparkles,
  CheckCircle2
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import { GlobalSearchModal } from "../common/GlobalSearchModal";

// Phase 1 Core Views & Modules
import { DashboardView } from "../dashboard/DashboardView";
import { GovernanceControlModule } from "../governance/GovernanceControlModule";
import { RolesModule } from "../modules/RolesModule";
import { UsersModule } from "../modules/UsersModule";
import { AuditLogsModule } from "../modules/AuditLogsModule";

// Other Ecosystem Modules
import { WebsiteModule } from "../modules/WebsiteModule";
import { BlogModule } from "../modules/BlogModule";
import { ProductsModule } from "../modules/ProductsModule";
import { CustomersModule } from "../modules/CustomersModule";
import { LeadsModule } from "../modules/LeadsModule";
import { OnboardingModule } from "../modules/OnboardingModule";
import { SubscriptionsModule } from "../modules/SubscriptionsModule";
import { AnalyticsModule } from "../modules/AnalyticsModule";
import { MediaModule } from "../modules/MediaModule";
import { SeoModule } from "../modules/SeoModule";
import { ApplicationsModule } from "../modules/ApplicationsModule";
import { AiControlCenterModule } from "../modules/AiControlCenterModule";
import { IntegrationsModule } from "../modules/IntegrationsModule";
import { SecurityModule } from "../modules/SecurityModule";
import { SystemHealthModule } from "../modules/SystemHealthModule";
import { ReportsModule } from "../modules/ReportsModule";
import { SettingsModule } from "../modules/SettingsModule";

export const AdminLayout: React.FC = () => {
  const { activeModule, setActiveModule, currentUser } = useAdminData();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Phase 1 primary navigation links
  const phase1NavLinks = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "governance", label: "Governance Control", icon: Shield },
    { id: "audit", label: "Audit Logs", icon: FileClock }
  ] as const;

  const renderActiveModule = () => {
    switch (activeModule) {
      case "dashboard":
        return <DashboardView />;
      case "users":
        return <UsersModule />;
      case "governance":
      case "roles":
        return <GovernanceControlModule />;
      case "audit":
        return <AuditLogsModule />;
      case "website":
        return <WebsiteModule />;
      case "blog":
        return <BlogModule />;
      case "products":
        return <ProductsModule />;
      case "customers":
        return <CustomersModule />;
      case "leads":
        return <LeadsModule />;
      case "onboarding":
        return <OnboardingModule />;
      case "subscriptions":
        return <SubscriptionsModule />;
      case "analytics":
        return <AnalyticsModule />;
      case "media":
        return <MediaModule />;
      case "seo":
        return <SeoModule />;
      case "applications":
        return <ApplicationsModule />;
      case "ai":
        return <AiControlCenterModule />;
      case "integrations":
        return <IntegrationsModule />;
      case "security":
        return <SecurityModule />;
      case "health":
        return <SystemHealthModule />;
      case "reports":
        return <ReportsModule />;
      case "settings":
        return <SettingsModule />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Sidebar Navigation */}
      <AdminSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Main Content Area Shell */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header with Search, Role Persona, and Status */}
        <AdminHeader
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onOpenSearch={() => setIsSearchOpen(true)}
        />

        {/* Phase 1 Fast Navigation Strip */}
        <div className="bg-slate-900/60 border-b border-slate-800/80 px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between overflow-x-auto gap-4 scrollbar-none">
          <div className="flex items-center gap-1 sm:gap-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider hidden sm:inline mr-1">
              Phase 1:
            </span>
            {phase1NavLinks.map((link) => {
              const Icon = link.icon;
              const isActive = activeModule === link.id;
              return (
                <button
                  key={link.id}
                  onClick={() => setActiveModule(link.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap ${
                    isActive
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/80"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{link.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
            <span className="hidden md:inline text-[11px]">
              Ecosystem Status: <strong className="text-emerald-400 font-semibold">Protected</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-slate-300">
              RBAC: {currentUser.role}
            </span>
          </div>
        </div>

        {/* Scrollable Content Area Shell */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-950">
          <div className="max-w-7xl mx-auto pb-12">
            {renderActiveModule()}
          </div>
        </main>
      </div>

      {/* Global Spotlight Search Modal */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />
    </div>
  );
};
