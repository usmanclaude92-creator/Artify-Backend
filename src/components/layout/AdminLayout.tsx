import React, { useState } from "react";
import { useAdminData } from "../../context/AdminDataContext";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import { GlobalSearchModal } from "../common/GlobalSearchModal";

// Modules
import { DashboardModule } from "../modules/DashboardModule";
import { WebsiteModule } from "../modules/WebsiteModule";
import { BlogModule } from "../modules/BlogModule";
import { ProductsModule } from "../modules/ProductsModule";
import { UsersModule } from "../modules/UsersModule";
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
import { AuditLogsModule } from "../modules/AuditLogsModule";
import { SystemHealthModule } from "../modules/SystemHealthModule";
import { ReportsModule } from "../modules/ReportsModule";
import { SettingsModule } from "../modules/SettingsModule";

export const AdminLayout: React.FC = () => {
  const { activeModule } = useAdminData();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const renderActiveModule = () => {
    switch (activeModule) {
      case "dashboard":
        return <DashboardModule />;
      case "website":
        return <WebsiteModule />;
      case "blog":
        return <BlogModule />;
      case "products":
        return <ProductsModule />;
      case "users":
        return <UsersModule />;
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
      case "audit":
        return <AuditLogsModule />;
      case "health":
        return <SystemHealthModule />;
      case "reports":
        return <ReportsModule />;
      case "settings":
        return <SettingsModule />;
      default:
        return <DashboardModule />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Sidebar */}
      <AdminSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header */}
        <AdminHeader
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onOpenSearch={() => setIsSearchOpen(true)}
        />

        {/* Scrollable Module Workspace */}
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
