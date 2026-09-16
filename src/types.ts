export type UserRole =
  | "Super Admin"
  | "Admin"
  | "Content Manager"
  | "Support Manager"
  | "Sales / CRM"
  | "Developer / Technical"
  | "Finance"
  | "Read-Only / Auditor"
  | "Customer / Subscriber";

export type UserStatus = "active" | "suspended" | "pending_invite" | "inactive";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "publish" | "approve" | "export" | "manage" | "configure";

export type SystemModule =
  | "dashboard"
  | "website"
  | "products"
  | "blog"
  | "users"
  | "customers"
  | "leads"
  | "onboarding"
  | "subscriptions"
  | "analytics"
  | "media"
  | "seo"
  | "applications"
  | "notifications"
  | "ai"
  | "integrations"
  | "security"
  | "audit"
  | "health"
  | "reports"
  | "settings";

export interface UserPermission {
  module: SystemModule;
  actions: PermissionAction[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: "active" | "suspended" | "pending_invite" | "inactive";
  avatar?: string;
  department?: string;
  lastLoginAt?: string;
  createdAt: string;
  mfaEnabled: boolean;
  twoFactorEnabled?: boolean;
  permissions?: string[];
  twoFactorType?: "authenticator_app" | "sms" | "security_key";
  assignedCompanyId?: string;
  activeSessionsCount: number;
}

export interface ProductFeature {
  id: string;
  title: string;
  description: string;
  includedInPlans: string[];
}

export type ProductStatus = "draft" | "published" | "archived" | "coming_soon";
export type ProductCategory = "Enterprise ERP" | "HRM & Workforce" | "FinTech & Billing" | "AI Business Suite" | "Mobile Solutions" | "Bespoke Enterprise";

export interface ProductPlan {
  id: string;
  productId: string;
  name: string;
  code: string;
  priceMonthly: number;
  priceAnnual: number;
  billingInterval: "monthly" | "annual" | "custom";
  trialDays: number;
  isPopular?: boolean;
  features: string[];
  maxUsers: number;
  entitlements: Record<string, string | number | boolean>;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  shortDescription: string;
  description: string;
  category: ProductCategory;
  industry: string[];
  platforms: ("Web" | "iOS" | "Android" | "Cloud" | "Desktop")[];
  pricingModel: "Per Seat" | "Tiered Flat" | "Usage Based" | "Custom Enterprise";
  status: ProductStatus;
  trialAvailable: boolean;
  trialDurationDays: number;
  features: ProductFeature[];
  plans: ProductPlan[];
  screenshots: string[];
  documents: { name: string; url: string; type: string }[];
  seoTitle: string;
  seoDescription: string;
  version: string;
  updatedAt: string;
}

export type ContentStatus = "draft" | "in_review" | "published" | "scheduled" | "archived";
export type BlogPostStatus = ContentStatus;

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  featuredImage: string;
  authorName: string;
  authorRole: string;
  category: string;
  tags: string[];
  seoTitle: string;
  metaDescription: string;
  status: ContentStatus;
  publishedAt?: string;
  updatedAt: string;
  viewsCount: number;
  readingTimeMinutes?: number;
  isAiGenerated?: boolean;
  aiApprovedBy?: string;
}

export interface WebsitePage {
  id: string;
  title: string;
  slug: string;
  status: ContentStatus;
  lastEditedBy: string;
  updatedAt: string;
  metaTitle: string;
  metaDescription: string;
  sectionsCount: number;
  isSystemPage: boolean;
}

export interface WebsiteSection {
  id: string;
  pageId: string;
  sectionKey: "hero" | "stats" | "products_grid" | "adaptive_philosophy" | "testimonials" | "faq" | "cta_banner" | "footer";
  title: string;
  subtitle?: string;
  content: Record<string, unknown>;
  isVisible: boolean;
  orderIndex: number;
  updatedAt: string;
}

export interface Testimonial {
  id: string;
  clientName: string;
  clientTitle: string;
  companyName: string;
  companyLogo?: string;
  avatar?: string;
  quote: string;
  rating: number;
  status: "published" | "draft";
  productReferenced?: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  orderIndex: number;
  status: "published" | "draft";
}

export interface CustomerCompany {
  id: string;
  name: string;
  industry: string;
  size: string;
  country: string;
  website: string;
  contactEmail: string;
  contactPhone: string;
  accountManager: string;
  status: "active" | "onboarding" | "trial" | "churned";
  onboardingProgress: number;
  activeProducts: string[];
  totalSpend: number;
  joinedAt: string;
  lastActiveAt: string;
  notes?: string;
  renewalDate?: string;
}

export type LeadStage = "New" | "Contacted" | "Qualified" | "Proposal/Opportunity" | "Converted" | "Lost";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone?: string;
  companyName: string;
  companySize?: string;
  productInterest: string;
  leadSource: "Website Contact" | "Demo Request" | "Product Enquiry" | "Consultation" | "Newsletter" | "Inbound Phone";
  stage: LeadStage;
  assignedStaff: string;
  estimatedValue: number;
  notes: string[];
  createdAt: string;
  updatedAt: string;
  convertedCustomerId?: string;
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  isCompleted: boolean;
  completedAt?: string;
  assignedTo?: string;
  dueDate?: string;
}

export interface CustomerOnboardingRecord {
  id: string;
  customerId: string;
  customerName: string;
  productName?: string;
  assignedLead?: string;
  assignedArchitect?: string;
  currentStage: "Visitor" | "Lead" | "Registered User" | "Trial" | "Customer" | "Subscription" | "Onboarding" | "Active Customer" | string;
  progressPercentage: number;
  assignedStaff: string;
  startedAt: string;
  targetCompletionDate: string;
  steps: OnboardingStep[];
  milestones?: {
    id: string;
    title: string;
    description: string;
    status: "pending" | "in_progress" | "completed";
    completedAt?: string;
  }[];
  outstandingRequirements: string[];
}

export interface Subscription {
  id: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  planName: string;
  status: "active" | "trialing" | "past_due" | "cancelled" | "expired";
  billingCycle: "monthly" | "annual";
  amount: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  seatsAllocated: number;
  seatsUsed: number;
  trialEndsAt?: string;
}

export interface MediaAsset {
  id: string;
  title?: string;
  fileName: string;
  fileType: "image/png" | "image/jpeg" | "image/svg+xml" | "application/pdf" | "video/mp4" | string;
  fileSizeKb: number;
  category: "Product Screenshots" | "Brand Logos" | "Blog Covers" | "Marketing Assets" | "Whitepapers" | string;
  url: string;
  uploadedAt?: string;
  createdAt?: string;
  dimensions?: string;
  usageCount?: number;
  usedIn?: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  userRole: string;
  action: string;
  module: string;
  recordId?: string;
  recordName?: string;
  details: string;
  beforeValue?: string;
  afterValue?: string;
  ipAddress: string;
  status: "success" | "warning" | "error";
}

export interface SystemHealthMetric {
  serviceName: string;
  category: "Core Database" | "API Gateway" | "Auth & IAM" | "Blob Storage" | "Email Relay" | "Background Queue" | "AI Orchestrator";
  status: "healthy" | "warning" | "error";
  latencyMs: number;
  uptimePercent: number;
  lastChecked: string;
  details: string;
}

export interface EcosystemApp {
  id: string;
  name?: string;
  appName?: string;
  productId?: string;
  platform: "Web App" | "Android App" | "iOS App" | "Desktop App" | "Web" | "Android" | "iOS" | "Cloud Runtime";
  version?: string;
  currentVersion?: string;
  buildNumber?: number;
  releaseStatus: "Production" | "Beta" | "In Review" | "Planned" | "Deprecated";
  storeUrl?: string;
  downloadUrl?: string;
  downloadCount?: number;
  activeInstalls: number;
  minOsVersion?: string;
  lastReleasedAt?: string;
  releasedAt?: string;
  releaseNotes: string;
}

export interface IntegrationService {
  id: string;
  name: string;
  category: "Payment Gateway" | "Email Provider" | "SMS & Messaging" | "Analytics" | "AI Provider" | "Cloud Storage";
  status: "connected" | "disconnected" | "error" | "pending_config";
  iconName: string;
  description: string;
  environment: "Production" | "Sandbox";
  lastSyncAt?: string;
  apiKeyMasked?: string;
  webhookUrl?: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  channel: "email" | "in_app" | "push" | "sms";
  category: "Welcome" | "Trial Expiry" | "Subscription Renewal" | "Security Alert" | "Product Release";
  subject: string;
  bodyTemplate: string;
  availableVariables: string[];
  isActive: boolean;
  updatedAt: string;
}

export interface SystemSettings {
  companyName: string;
  tagline: string;
  supportEmail: string;
  salesEmail: string;
  contactPhone: string;
  headquartersAddress: string;
  portalUrl: string;
  maintenanceMode: boolean;
  allowPublicRegistrations: boolean;
  requireMfaForAdmins: boolean;
  sessionTimeoutMinutes: number;
  maxFailedLoginAttempts: number;
  defaultTrialDays: number;
  enableAiFeatures: boolean;
  primaryAiModel: string;
  aiMonthlyTokenBudget: number;
  defaultCurrency: string;
  domain?: string;
  positioningStatement?: string;
  timezone?: string;
  dateFormat?: string;
}

export type AppRelease = EcosystemApp;
export type AppPlatform = "Web App" | "Android App" | "iOS App" | "Desktop App" | "Web" | "Android" | "iOS" | "Cloud Runtime";

export type OnboardingRecord = CustomerOnboardingRecord;
export type HealthMetric = SystemHealthMetric;
export type IntegrationConfig = IntegrationService;

export interface AiFeatureConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  isEnabled: boolean;
  tokensUsedThisMonth: number;
  requiresHumanReview: boolean;
}
