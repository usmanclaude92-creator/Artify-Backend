/**
 * Frontend permission helper + extensible navigation config (Phase 4 §7/§27).
 *
 * IMPORTANT: this is UX only. Hiding a nav item or button never substitutes
 * for backend authorization — every action below still calls a route
 * protected by `requirePermission`/`requireRole` server-side (§28). This
 * module exists so the UI doesn't show entry points a user's own token
 * would be rejected for, not to be the source of truth for what's allowed.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  KeyRound,
  Building2,
  ScrollText,
  MonitorSmartphone,
  Settings,
  TrendingUp,
  Contact2,
  Briefcase,
  ClipboardCheck,
  Hourglass,
  Layers,
  UsersRound,
  Package,
  Boxes,
  FileText,
  Newspaper,
  FolderTree,
  UserSquare2,
  Image as ImageIcon,
  FileSignature,
  Repeat,
  Receipt,
  Wallet,
  UserCircle,
  Sparkles,
  Cpu,
  Wrench,
  MessageSquareText,
  Workflow,
  History,
  Gauge,
  ShieldAlert,
  Bot,
  Search,
  ArrowRightLeft,
  Target,
  ClipboardList,
  LayoutTemplate,
  PanelsTopLeft,
  Wand2,
  Globe,
  Palette,
  Menu,
  Home,
} from "lucide-react";
import { DashboardPage } from "../components/modules/DashboardPage";

// Phase 13 — every other page is fetched on demand (React.lazy) rather than
// bundled into the initial Control Center chunk. Dashboard alone stays
// eager: AppShell redirects "/" to "/dashboard" and it requires no
// permission, so it's guaranteed to render for every signed-in user —
// lazy-loading it would just trade one unavoidable fetch for another
// with an extra loading flash. `lazyPage` centralizes the
// `.then((m) => ({ default: m.X }))` boilerplate every one of these named
// (not default) exports needs to work with React.lazy.
function lazyPage<T extends ComponentType>(loader: () => Promise<Record<string, unknown>>, exportName: string): LazyExoticComponent<T> {
  return lazy(() => loader().then((m) => ({ default: m[exportName] as T })));
}

const UsersPage = lazyPage(() => import("../components/modules/UsersPage"), "UsersPage");
const RolesPage = lazyPage(() => import("../components/modules/RolesPage"), "RolesPage");
const PermissionsPage = lazyPage(() => import("../components/modules/PermissionsPage"), "PermissionsPage");
const OrganizationsPage = lazyPage(() => import("../components/modules/OrganizationsPage"), "OrganizationsPage");
const AuditLogPage = lazyPage(() => import("../components/modules/AuditLogPage"), "AuditLogPage");
const SecurityPage = lazyPage(() => import("../components/modules/SecurityPage"), "SecurityPage");
const SettingsPage = lazyPage(() => import("../components/modules/SettingsPage"), "SettingsPage");
const CrmDashboardPage = lazyPage(() => import("../components/modules/CrmDashboardPage"), "CrmDashboardPage");
const LeadsPage = lazyPage(() => import("../components/modules/LeadsPage"), "LeadsPage");
const ClientsPage = lazyPage(() => import("../components/modules/ClientsPage"), "ClientsPage");
const ContactsPage = lazyPage(() => import("../components/modules/ContactsPage"), "ContactsPage");
const OnboardingPage = lazyPage(() => import("../components/modules/OnboardingPage"), "OnboardingPage");
const WorkspacesPage = lazyPage(() => import("../components/modules/WorkspacesPage"), "WorkspacesPage");
const ProductsPage = lazyPage(() => import("../components/modules/ProductsPage"), "ProductsPage");
const ProductTaxonomyPage = lazyPage(() => import("../components/modules/ProductTaxonomyPage"), "ProductTaxonomyPage");
const TemplatesPage = lazyPage(() => import("../components/modules/TemplatesPage"), "TemplatesPage");
const TemplatePartsPage = lazyPage(() => import("../components/modules/TemplatePartsPage"), "TemplatePartsPage");
const NavigationMenusPage = lazyPage(() => import("../components/modules/NavigationMenusPage"), "NavigationMenusPage");
const HomepageManagerPage = lazyPage(() => import("../components/modules/HomepageManagerPage"), "HomepageManagerPage");
const PagesPage = lazyPage(() => import("../components/modules/PagesPage"), "PagesPage");
const SiteEditorPage = lazyPage(() => import("../components/modules/SiteEditorPage"), "SiteEditorPage");
const SiteIdentityPage = lazyPage(() => import("../components/modules/SiteIdentityPage"), "SiteIdentityPage");
const GlobalStylesPage = lazyPage(() => import("../components/modules/GlobalStylesPage"), "GlobalStylesPage");
const PostsPage = lazyPage(() => import("../components/modules/PostsPage"), "PostsPage");
const CmsTaxonomyPage = lazyPage(() => import("../components/modules/CmsTaxonomyPage"), "CmsTaxonomyPage");
const AuthorsPage = lazyPage(() => import("../components/modules/AuthorsPage"), "AuthorsPage");
const MediaLibraryPage = lazyPage(() => import("../components/modules/MediaLibraryPage"), "MediaLibraryPage");
const ContractsPage = lazyPage(() => import("../components/modules/ContractsPage"), "ContractsPage");
const SubscriptionsPage = lazyPage(() => import("../components/modules/SubscriptionsPage"), "SubscriptionsPage");
const InvoicesPage = lazyPage(() => import("../components/modules/InvoicesPage"), "InvoicesPage");
const PaymentsPage = lazyPage(() => import("../components/modules/PaymentsPage"), "PaymentsPage");
const ClientPortalPage = lazyPage(() => import("../components/modules/ClientPortalPage"), "ClientPortalPage");
const SeoIssuesPage = lazyPage(() => import("../components/modules/SeoIssuesPage"), "SeoIssuesPage");
const RedirectsPage = lazyPage(() => import("../components/modules/RedirectsPage"), "RedirectsPage");
const OpportunitiesPage = lazyPage(() => import("../components/modules/OpportunitiesPage"), "OpportunitiesPage");
const FormsPage = lazyPage(() => import("../components/modules/FormsPage"), "FormsPage");
const AiOverviewPage = lazyPage(() => import("../components/modules/ai/AiOverviewPage"), "AiOverviewPage");
const AiProvidersPage = lazyPage(() => import("../components/modules/ai/AiProvidersPage"), "AiProvidersPage");
const AiToolsPage = lazyPage(() => import("../components/modules/ai/AiToolsPage"), "AiToolsPage");
const AiPromptsPage = lazyPage(() => import("../components/modules/ai/AiPromptsPage"), "AiPromptsPage");
const AiWorkflowsPage = lazyPage(() => import("../components/modules/ai/AiWorkflowsPage"), "AiWorkflowsPage");
const AiExecutionsPage = lazyPage(() => import("../components/modules/ai/AiExecutionsPage"), "AiExecutionsPage");
const AiUsagePage = lazyPage(() => import("../components/modules/ai/AiUsagePage"), "AiUsagePage");
const AiApprovalsPage = lazyPage(() => import("../components/modules/ai/AiApprovalsPage"), "AiApprovalsPage");
const AiCopilotPage = lazyPage(() => import("../components/modules/ai/AiCopilotPage"), "AiCopilotPage");

export function hasPermission(permissions: readonly string[] | undefined, key: string): boolean {
  return !!permissions?.includes(key);
}

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  /** Any one of these permissions is enough to show the item; empty means always visible to an authenticated user. */
  requiresAnyPermission?: string[];
  component: ComponentType | LazyExoticComponent<ComponentType>;
  /** Groups items under a heading in the sidebar (§22/§31) — purely presentational. */
  section: "Platform" | "CRM" | "Onboarding" | "Workspaces" | "Products" | "Website" | "CMS" | "SEO" | "Marketing" | "Commercial" | "AI" | "Client Portal";
}

/**
 * Extensible by design (§6): future product modules (Products, CMS, Media,
 * Subscriptions, Billing, Reports, AI) register here the same way — a nav
 * entry + a permission gate + a lazily-mounted page. Phase 5 adds the CRM
 * section (docs/CRM_ARCHITECTURE.md); none of the still-future modules are
 * built yet.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, component: DashboardPage, section: "Platform" },
  {
    id: "users",
    label: "Users",
    path: "/users",
    icon: Users,
    requiresAnyPermission: ["users.read"],
    component: UsersPage,
    section: "Platform",
  },
  {
    id: "roles",
    label: "Roles",
    path: "/roles",
    icon: ShieldCheck,
    requiresAnyPermission: ["roles.read"],
    component: RolesPage,
    section: "Platform",
  },
  {
    id: "permissions",
    label: "Permissions",
    path: "/permissions",
    icon: KeyRound,
    requiresAnyPermission: ["roles.read"],
    component: PermissionsPage,
    section: "Platform",
  },
  {
    id: "organizations",
    label: "Organizations",
    path: "/organizations",
    icon: Building2,
    requiresAnyPermission: ["organizations.read"],
    component: OrganizationsPage,
    section: "Platform",
  },
  {
    id: "audit-log",
    label: "Audit Log",
    path: "/audit-log",
    icon: ScrollText,
    requiresAnyPermission: ["audit.read"],
    component: AuditLogPage,
    section: "Platform",
  },
  { id: "security", label: "Security", path: "/security", icon: MonitorSmartphone, component: SecurityPage, section: "Platform" },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    icon: Settings,
    requiresAnyPermission: ["settings.read"],
    component: SettingsPage,
    section: "Platform",
  },
  {
    id: "crm-dashboard",
    label: "CRM Dashboard",
    path: "/crm",
    icon: TrendingUp,
    component: CrmDashboardPage,
    section: "CRM",
  },
  {
    id: "crm-leads",
    label: "Leads",
    path: "/crm/leads",
    icon: Briefcase,
    requiresAnyPermission: ["leads.read"],
    component: LeadsPage,
    section: "CRM",
  },
  {
    id: "crm-clients",
    label: "Clients",
    path: "/crm/clients",
    icon: Building2,
    requiresAnyPermission: ["clients.read"],
    component: ClientsPage,
    section: "CRM",
  },
  {
    id: "crm-contacts",
    label: "Contacts",
    path: "/crm/contacts",
    icon: Contact2,
    requiresAnyPermission: ["contacts.read"],
    component: ContactsPage,
    section: "CRM",
  },
  {
    id: "crm-opportunities",
    label: "Opportunities",
    path: "/crm/opportunities",
    icon: Target,
    requiresAnyPermission: ["opportunities.read"],
    component: OpportunitiesPage,
    section: "CRM",
  },
  {
    id: "onboarding-overview",
    label: "Overview",
    path: "/onboarding",
    icon: ClipboardCheck,
    requiresAnyPermission: ["onboarding.read"],
    component: OnboardingPage,
    section: "Onboarding",
  },
  {
    id: "onboarding-pending",
    label: "Pending Onboarding",
    path: "/onboarding/pending",
    icon: Hourglass,
    requiresAnyPermission: ["onboarding.read"],
    component: OnboardingPage,
    section: "Onboarding",
  },
  {
    id: "workspaces-all",
    label: "All Workspaces",
    path: "/workspaces",
    icon: Layers,
    requiresAnyPermission: ["workspaces.read"],
    component: WorkspacesPage,
    section: "Workspaces",
  },
  {
    id: "workspaces-members",
    label: "Members",
    path: "/workspaces/members",
    icon: UsersRound,
    requiresAnyPermission: ["workspaces.read"],
    component: WorkspacesPage,
    section: "Workspaces",
  },
  {
    id: "products-all",
    label: "All Products",
    path: "/products",
    icon: Package,
    requiresAnyPermission: ["products.read"],
    component: ProductsPage,
    section: "Products",
  },
  {
    id: "products-modules",
    label: "Product Modules",
    path: "/products/modules",
    icon: Boxes,
    requiresAnyPermission: ["product_modules.read"],
    component: ProductsPage,
    section: "Products",
  },
  // Phase 10 (Products + Services + Solutions) — same ProductsPage
  // component, route-locked to a single catalog `type` (see its own
  // `lockedType` derivation from `path`) — never a second catalog system.
  {
    id: "services-all",
    label: "Services",
    path: "/services",
    icon: Briefcase,
    requiresAnyPermission: ["products.read"],
    component: ProductsPage,
    section: "Products",
  },
  {
    id: "solutions-all",
    label: "Solutions",
    path: "/solutions",
    icon: Target,
    requiresAnyPermission: ["products.read"],
    component: ProductsPage,
    section: "Products",
  },
  {
    id: "products-taxonomy",
    label: "Categories & Industries",
    path: "/products/taxonomy",
    icon: FolderTree,
    requiresAnyPermission: ["product_categories.read", "industries.read"],
    component: ProductTaxonomyPage,
    section: "Products",
  },
  {
    id: "website-templates",
    label: "Templates",
    path: "/website/templates",
    icon: LayoutTemplate,
    requiresAnyPermission: ["templates.read"],
    component: TemplatesPage,
    section: "Website",
  },
  {
    id: "website-template-parts",
    label: "Template Parts",
    path: "/website/template-parts",
    icon: PanelsTopLeft,
    requiresAnyPermission: ["template_parts.read"],
    component: TemplatePartsPage,
    section: "Website",
  },
  {
    id: "website-navigation-menus",
    label: "Navigation Menus",
    path: "/website/navigation-menus",
    icon: Menu,
    requiresAnyPermission: ["navigation_menus.read"],
    component: NavigationMenusPage,
    section: "Website",
  },
  {
    id: "website-homepage",
    label: "Homepage",
    path: "/website/homepage",
    icon: Home,
    requiresAnyPermission: ["content.read"],
    component: HomepageManagerPage,
    section: "Website",
  },
  {
    id: "website-site-identity",
    label: "Site Identity",
    path: "/website/site-identity",
    icon: Globe,
    requiresAnyPermission: ["settings.read"],
    component: SiteIdentityPage,
    section: "Website",
  },
  {
    id: "website-global-styles",
    label: "Global Styles",
    path: "/website/global-styles",
    icon: Palette,
    requiresAnyPermission: ["settings.read"],
    component: GlobalStylesPage,
    section: "Website",
  },
  {
    id: "website-site-editor",
    label: "Site Editor",
    path: "/website/site-editor",
    icon: Wand2,
    requiresAnyPermission: ["content.update"],
    component: SiteEditorPage,
    section: "Website",
  },
  {
    id: "cms-pages",
    label: "Pages",
    path: "/cms/pages",
    icon: FileText,
    requiresAnyPermission: ["content.read"],
    component: PagesPage,
    section: "CMS",
  },
  {
    id: "cms-posts",
    label: "Blog Posts",
    path: "/cms/posts",
    icon: Newspaper,
    requiresAnyPermission: ["content.read"],
    component: PostsPage,
    section: "CMS",
  },
  {
    id: "cms-taxonomy",
    label: "Categories & Tags",
    path: "/cms/taxonomy",
    icon: FolderTree,
    requiresAnyPermission: ["content.read"],
    component: CmsTaxonomyPage,
    section: "CMS",
  },
  {
    id: "cms-authors",
    label: "Authors",
    path: "/cms/authors",
    icon: UserSquare2,
    requiresAnyPermission: ["authors.read"],
    component: AuthorsPage,
    section: "CMS",
  },
  {
    id: "cms-media",
    label: "Media Library",
    path: "/cms/media",
    icon: ImageIcon,
    requiresAnyPermission: ["media.read"],
    component: MediaLibraryPage,
    section: "CMS",
  },
  {
    id: "seo-issues",
    label: "SEO Issues",
    path: "/seo/issues",
    icon: Search,
    requiresAnyPermission: ["seo.audit.read"],
    component: SeoIssuesPage,
    section: "SEO",
  },
  {
    id: "seo-redirects",
    label: "Redirects",
    path: "/seo/redirects",
    icon: ArrowRightLeft,
    requiresAnyPermission: ["seo.redirects.read"],
    component: RedirectsPage,
    section: "SEO",
  },
  {
    id: "marketing-forms",
    label: "Forms",
    path: "/marketing/forms",
    icon: ClipboardList,
    requiresAnyPermission: ["forms.read"],
    component: FormsPage,
    section: "Marketing",
  },
  {
    id: "commercial-contracts",
    label: "Contracts",
    path: "/commercial/contracts",
    icon: FileSignature,
    requiresAnyPermission: ["contracts.read"],
    component: ContractsPage,
    section: "Commercial",
  },
  {
    id: "commercial-subscriptions",
    label: "Subscriptions",
    path: "/commercial/subscriptions",
    icon: Repeat,
    requiresAnyPermission: ["subscriptions.read"],
    component: SubscriptionsPage,
    section: "Commercial",
  },
  {
    id: "commercial-invoices",
    label: "Invoices",
    path: "/commercial/invoices",
    icon: Receipt,
    requiresAnyPermission: ["invoices.read"],
    component: InvoicesPage,
    section: "Commercial",
  },
  {
    id: "commercial-payments",
    label: "Payments",
    path: "/commercial/payments",
    icon: Wallet,
    requiresAnyPermission: ["payments.read"],
    component: PaymentsPage,
    section: "Commercial",
  },
  {
    id: "ai-overview",
    label: "Overview",
    path: "/ai",
    icon: Sparkles,
    requiresAnyPermission: ["ai.executions.read", "ai.approvals.read", "ai.usage.read"],
    component: AiOverviewPage,
    section: "AI",
  },
  {
    id: "ai-providers",
    label: "Providers & Models",
    path: "/ai/providers",
    icon: Cpu,
    requiresAnyPermission: ["ai.providers.read"],
    component: AiProvidersPage,
    section: "AI",
  },
  {
    id: "ai-tools",
    label: "Tools",
    path: "/ai/tools",
    icon: Wrench,
    requiresAnyPermission: ["ai.tools.read"],
    component: AiToolsPage,
    section: "AI",
  },
  {
    id: "ai-prompts",
    label: "Prompt Templates",
    path: "/ai/prompts",
    icon: MessageSquareText,
    requiresAnyPermission: ["ai.prompts.read"],
    component: AiPromptsPage,
    section: "AI",
  },
  {
    id: "ai-workflows",
    label: "Workflows",
    path: "/ai/workflows",
    icon: Workflow,
    requiresAnyPermission: ["ai.workflows.read"],
    component: AiWorkflowsPage,
    section: "AI",
  },
  {
    id: "ai-executions",
    label: "Executions",
    path: "/ai/executions",
    icon: History,
    requiresAnyPermission: ["ai.executions.read"],
    component: AiExecutionsPage,
    section: "AI",
  },
  {
    id: "ai-usage",
    label: "Usage & Costs",
    path: "/ai/usage",
    icon: Gauge,
    requiresAnyPermission: ["ai.usage.read"],
    component: AiUsagePage,
    section: "AI",
  },
  {
    id: "ai-approvals",
    label: "Approvals",
    path: "/ai/approvals",
    icon: ShieldAlert,
    requiresAnyPermission: ["ai.approvals.read"],
    component: AiApprovalsPage,
    section: "AI",
  },
  {
    id: "ai-copilot",
    label: "Copilot",
    path: "/ai/copilot",
    icon: Bot,
    requiresAnyPermission: ["copilot.read", "copilot.use"],
    component: AiCopilotPage,
    section: "AI",
  },
  {
    id: "client-portal",
    label: "Your Account",
    path: "/portal",
    icon: UserCircle,
    requiresAnyPermission: ["portal.dashboard.read"],
    component: ClientPortalPage,
    section: "Client Portal",
  },
];

export function visibleNavItems(permissions: readonly string[] | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.requiresAnyPermission || item.requiresAnyPermission.some((p) => hasPermission(permissions, p)));
}
