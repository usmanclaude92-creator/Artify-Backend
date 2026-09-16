import React from "react";
import {
  LayoutDashboard,
  Users,
  Building2,
  Contact2,
  CreditCard,
  Rocket,
  Package,
  Smartphone,
  FolderArchive,
  Globe,
  BookOpen,
  SearchCheck,
  Bot,
  Plug,
  Bell,
  BarChart3,
  ShieldCheck,
  Shield,
  FileClock,
  Activity,
  FileSpreadsheet,
  Settings,
  ExternalLink,
  ChevronRight,
  Sparkles
} from "lucide-react";
import { useAdminData } from "../../context/AdminDataContext";
import { SystemModule, UserRole } from "../../types";

interface NavItem {
  id: SystemModule;
  label: string;
  icon: React.ElementType;
  badge?: string | number;
}

interface NavGroup {
  groupName: string;
  items: NavItem[];
}

interface AdminSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  isOpen = false,
  onClose,
  isCollapsed = false,
  onToggleCollapse
}) => {
  const { activeModule, setActiveModule, currentUser, switchUserRole, setCurrentView, leads = [], onboardingRecords = [] } = useAdminData();

  const activeLeadsCount = (leads || []).filter((l) => l.stage !== "Converted" && l.stage !== "Lost").length;
  const inProgressOnboarding = (onboardingRecords || []).filter((o) => (o.progressPercentage || 0) < 100).length;

  const navGroups: NavGroup[] = [
    {
      groupName: "Phase 1 Core Governance",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { id: "users", label: "Users", icon: Users },
        { id: "roles", label: "Roles", icon: Shield },
        { id: "audit", label: "Audit Logs", icon: FileClock }
      ]
    },
    {
      groupName: "Business & Revenue",
      items: [
        { id: "customers", label: "Customers & Clients", icon: Building2 },
        { id: "leads", label: "Leads & CRM Pipeline", icon: Contact2, badge: activeLeadsCount },
        { id: "onboarding", label: "Customer Onboarding", icon: Rocket, badge: inProgressOnboarding },
        { id: "subscriptions", label: "Subscriptions & Plans", icon: CreditCard }
      ]
    },
    {
      groupName: "Product & Ecosystem",
      items: [
        { id: "products", label: "Products & Solutions", icon: Package },
        { id: "applications", label: "Application Ecosystem", icon: Smartphone },
        { id: "media", label: "Digital Asset Media", icon: FolderArchive }
      ]
    },
    {
      groupName: "Website & Content CMS",
      items: [
        { id: "website", label: "Website Management", icon: Globe },
        { id: "blog", label: "Blog / CMS Posts", icon: BookOpen },
        { id: "seo", label: "SEO Management", icon: SearchCheck }
      ]
    },
    {
      groupName: "Intelligence & Comms",
      items: [
        { id: "ai", label: "AI Control Center", icon: Bot, badge: "Gemini" },
        { id: "analytics", label: "Traffic & Analytics", icon: BarChart3 },
        { id: "notifications", label: "Notification Engine", icon: Bell },
        { id: "integrations", label: "Integrations & APIs", icon: Plug }
      ]
    },
    {
      groupName: "Security & System",
      items: [
        { id: "security", label: "Security & IAM", icon: ShieldCheck },
        { id: "health", label: "System Health", icon: Activity },
        { id: "reports", label: "Centralized Reports", icon: FileSpreadsheet },
        { id: "settings", label: "Administrative Settings", icon: Settings }
      ]
    }
  ];

  return (
    <aside
      className={`h-screen bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 z-30 select-none ${
        isCollapsed ? "w-20" : "w-72"
      }`}
    >
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
            <span className="text-white font-black text-lg tracking-wider">A</span>
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-white text-base tracking-tight truncate">
                  ARTIFY SOLS
                </span>
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold border border-indigo-500/30">
                  SUPER ADMIN
                </span>
              </div>
              <span className="text-xs text-slate-400 truncate">Enterprise Control Center</span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navGroups.map((group) => (
          <div key={group.groupName}>
            {!isCollapsed && (
              <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                {group.groupName}
              </p>
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveModule(item.id)}
                    title={isCollapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-sm"
                        : "text-slate-300 hover:text-white hover:bg-slate-800/60 border border-transparent"
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                    {!isCollapsed && (
                      <span className="truncate flex-1 text-left">{item.label}</span>
                    )}
                    {!isCollapsed && item.badge !== undefined && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          typeof item.badge === "string"
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                            : "bg-indigo-500/20 text-indigo-300"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* User Card & Public Switcher */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/90 space-y-2">
        <button
          onClick={() => setCurrentView("public_website")}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 text-slate-200 text-xs font-semibold border border-slate-700 transition"
        >
          <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
          {!isCollapsed && <span>View Public Ecosystem Site</span>}
        </button>

        {!isCollapsed && (
          <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center text-xs font-bold">
                  {currentUser.name.charAt(0)}
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-white truncate">{currentUser.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{currentUser.email}</p>
                </div>
              </div>
            </div>

            {/* Role switch pill for RBAC testing */}
            <div className="mt-2 pt-2 border-t border-slate-700/40 flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-medium">RBAC Mode:</span>
              <select
                value={currentUser.role}
                onChange={(e) => switchUserRole(e.target.value as UserRole)}
                className="bg-slate-900 text-indigo-300 text-[11px] font-semibold rounded px-2 py-0.5 border border-slate-700 focus:outline-none focus:border-indigo-500"
              >
                <option value="Super Admin">Super Admin</option>
                <option value="Admin">Admin</option>
                <option value="Content Manager">Content Manager</option>
                <option value="Sales / CRM">Sales / CRM</option>
                <option value="Support Manager">Support Manager</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
