import React, { createContext, useContext, useState, useEffect } from "react";
import {
  User,
  UserRole,
  SystemModule,
  Product,
  CustomerCompany,
  Lead,
  LeadStage,
  CustomerOnboardingRecord,
  Subscription,
  BlogPost,
  WebsitePage,
  WebsiteSection,
  Testimonial,
  FaqItem,
  MediaAsset,
  AuditLogEntry,
  EcosystemApp,
  IntegrationService,
  NotificationTemplate,
  SystemSettings,
  RbacMatrixItem
} from "../types";
import {
  initialUsers,
  initialProducts,
  initialCustomers,
  initialLeads,
  initialOnboardingRecords,
  initialSubscriptions,
  initialBlogPosts,
  initialWebsitePages,
  initialWebsiteSections,
  initialTestimonials,
  initialFaqs,
  initialMediaAssets,
  initialAuditLogs,
  initialEcosystemApps,
  initialIntegrations,
  initialNotificationTemplates,
  initialSystemSettings,
  initialRbacMatrix
} from "../data/seedData";

interface AdminDataContextType {
  // State
  currentView: "admin" | "public_website";
  activeModule: SystemModule;
  currentUser: User;
  isAuthenticated: boolean;
  selectedDateRange: string;
  isSearchOpen: boolean;

  // Collections
  users: User[];
  products: Product[];
  customers: CustomerCompany[];
  leads: Lead[];
  onboardingRecords: CustomerOnboardingRecord[];
  subscriptions: Subscription[];
  blogPosts: BlogPost[];
  websitePages: WebsitePage[];
  websiteSections: WebsiteSection[];
  testimonials: Testimonial[];
  faqs: FaqItem[];
  mediaAssets: MediaAsset[];
  auditLogs: AuditLogEntry[];
  ecosystemApps: EcosystemApp[];
  integrations: IntegrationService[];
  notificationTemplates: NotificationTemplate[];
  systemSettings: SystemSettings;
  rbacMatrix: RbacMatrixItem[];

  // Setters & Navigation
  setCurrentView: (view: "admin" | "public_website") => void;
  setActiveModule: (module: SystemModule) => void;
  setSelectedDateRange: (range: string) => void;
  setIsSearchOpen: (open: boolean) => void;
  switchUserRole: (role: UserRole) => void;
  login: (email?: string, role?: UserRole) => void;
  logout: () => void;
  updateRbacPermission: (moduleName: string, permissionKey: string, allowed: boolean) => void;

  // Actions
  logAuditEvent: (
    action: string,
    module: string,
    details: string,
    options?: {
      recordId?: string;
      recordName?: string;
      beforeValue?: string;
      afterValue?: string;
      status?: "success" | "warning" | "error";
    }
  ) => void;

  // Products
  saveProduct: (product: Product) => void;
  deleteProduct: (id: string) => void;

  // Leads
  createLead: (leadData: Omit<Lead, "id" | "createdAt" | "updatedAt">) => void;
  updateLeadStage: (id: string, newStage: LeadStage) => void;
  addLeadNote: (id: string, note: string) => void;
  convertLeadToCustomer: (leadId: string) => void;

  // Customers
  saveCustomer: (customer: CustomerCompany) => void;

  // Onboarding
  toggleOnboardingStep: (recordId: string, stepId: string) => void;

  // Subscriptions
  updateSubscriptionStatus: (id: string, status: Subscription["status"]) => void;

  // Blog & Content
  saveBlogPost: (post: BlogPost) => void;
  deleteBlogPost: (id: string) => void;

  // Website
  updateWebsiteSection: (sectionId: string, data: Partial<WebsiteSection>) => void;
  saveTestimonial: (test: Testimonial) => void;
  deleteTestimonial: (id: string) => void;
  saveFaq: (faq: FaqItem) => void;
  deleteFaq: (id: string) => void;

  // Media
  addMediaAsset: (asset: MediaAsset) => void;
  deleteMediaAsset: (id: string) => void;

  // Users & RBAC
  saveUser: (user: User) => void;
  toggleUserStatus: (id: string) => void;
  revokeUserSession: (id: string) => void;

  // Integrations & Apps
  toggleIntegrationStatus: (id: string) => void;
  saveAppRelease: (app: EcosystemApp) => void;

  // Settings & Reset
  updateSettings: (newSettings: Partial<SystemSettings>) => void;
  resetAllDataToDefaults: () => void;
  callServerAiGenerate: (prompt: string, taskType?: string) => Promise<{ content: string; modelUsed: string; status: string }>;
}

const STORAGE_KEY = "artify_super_admin_v2";

const AdminDataContext = createContext<AdminDataContextType | undefined>(undefined);

export const AdminDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentView, setCurrentView] = useState<"admin" | "public_website">("admin");
  const [activeModule, setActiveModule] = useState<SystemModule>("dashboard");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [selectedDateRange, setSelectedDateRange] = useState<string>("Last 30 days");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  // Load from local storage or seed
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_users`);
      return saved ? JSON.parse(saved) : initialUsers;
    } catch {
      return initialUsers;
    }
  });

  const [currentUser, setCurrentUser] = useState<User>(() => users[0] || initialUsers[0]);

  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_products`);
      return saved ? JSON.parse(saved) : initialProducts;
    } catch {
      return initialProducts;
    }
  });

  const [customers, setCustomers] = useState<CustomerCompany[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_customers`);
      return saved ? JSON.parse(saved) : initialCustomers;
    } catch {
      return initialCustomers;
    }
  });

  const [leads, setLeads] = useState<Lead[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_leads`);
      return saved ? JSON.parse(saved) : initialLeads;
    } catch {
      return initialLeads;
    }
  });

  const [onboardingRecords, setOnboardingRecords] = useState<CustomerOnboardingRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_onboarding`);
      return saved ? JSON.parse(saved) : initialOnboardingRecords;
    } catch {
      return initialOnboardingRecords;
    }
  });

  const [subscriptions, setSubscriptions] = useState<Subscription[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_subscriptions`);
      return saved ? JSON.parse(saved) : initialSubscriptions;
    } catch {
      return initialSubscriptions;
    }
  });

  const [blogPosts, setBlogPosts] = useState<BlogPost[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_blog`);
      return saved ? JSON.parse(saved) : initialBlogPosts;
    } catch {
      return initialBlogPosts;
    }
  });

  const [websitePages, setWebsitePages] = useState<WebsitePage[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_pages`);
      return saved ? JSON.parse(saved) : initialWebsitePages;
    } catch {
      return initialWebsitePages;
    }
  });

  const [websiteSections, setWebsiteSections] = useState<WebsiteSection[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_sections`);
      return saved ? JSON.parse(saved) : initialWebsiteSections;
    } catch {
      return initialWebsiteSections;
    }
  });

  const [testimonials, setTestimonials] = useState<Testimonial[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_testimonials`);
      return saved ? JSON.parse(saved) : initialTestimonials;
    } catch {
      return initialTestimonials;
    }
  });

  const [faqs, setFaqs] = useState<FaqItem[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_faqs`);
      return saved ? JSON.parse(saved) : initialFaqs;
    } catch {
      return initialFaqs;
    }
  });

  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_media`);
      return saved ? JSON.parse(saved) : initialMediaAssets;
    } catch {
      return initialMediaAssets;
    }
  });

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_audit`);
      return saved ? JSON.parse(saved) : initialAuditLogs;
    } catch {
      return initialAuditLogs;
    }
  });

  const [ecosystemApps, setEcosystemApps] = useState<EcosystemApp[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_apps`);
      return saved ? JSON.parse(saved) : initialEcosystemApps;
    } catch {
      return initialEcosystemApps;
    }
  });

  const [integrations, setIntegrations] = useState<IntegrationService[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_integrations`);
      return saved ? JSON.parse(saved) : initialIntegrations;
    } catch {
      return initialIntegrations;
    }
  });

  const [notificationTemplates, setNotificationTemplates] = useState<NotificationTemplate[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_notif_templates`);
      return saved ? JSON.parse(saved) : initialNotificationTemplates;
    } catch {
      return initialNotificationTemplates;
    }
  });

  const [systemSettings, setSystemSettings] = useState<SystemSettings>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_settings`);
      return saved ? JSON.parse(saved) : initialSystemSettings;
    } catch {
      return initialSystemSettings;
    }
  });

  const [rbacMatrix, setRbacMatrix] = useState<RbacMatrixItem[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_rbac`);
      return saved ? JSON.parse(saved) : initialRbacMatrix;
    } catch {
      return initialRbacMatrix;
    }
  });

  const updateRbacPermission = (moduleName: string, permissionKey: string, allowed: boolean) => {
    setRbacMatrix((prev) =>
      prev.map((item) =>
        item.module === moduleName ? { ...item, [permissionKey]: allowed } : item
      )
    );
    logAuditEvent(
      "UPDATE_RBAC_POLICY",
      "Roles & Permissions",
      `Modified '${permissionKey}' policy for ${moduleName} to ${allowed ? "ENABLED" : "DISABLED"}`
    );
  };

  // Sync to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY}_users`, JSON.stringify(users));
      localStorage.setItem(`${STORAGE_KEY}_products`, JSON.stringify(products));
      localStorage.setItem(`${STORAGE_KEY}_customers`, JSON.stringify(customers));
      localStorage.setItem(`${STORAGE_KEY}_leads`, JSON.stringify(leads));
      localStorage.setItem(`${STORAGE_KEY}_onboarding`, JSON.stringify(onboardingRecords));
      localStorage.setItem(`${STORAGE_KEY}_subscriptions`, JSON.stringify(subscriptions));
      localStorage.setItem(`${STORAGE_KEY}_blog`, JSON.stringify(blogPosts));
      localStorage.setItem(`${STORAGE_KEY}_pages`, JSON.stringify(websitePages));
      localStorage.setItem(`${STORAGE_KEY}_sections`, JSON.stringify(websiteSections));
      localStorage.setItem(`${STORAGE_KEY}_testimonials`, JSON.stringify(testimonials));
      localStorage.setItem(`${STORAGE_KEY}_faqs`, JSON.stringify(faqs));
      localStorage.setItem(`${STORAGE_KEY}_media`, JSON.stringify(mediaAssets));
      localStorage.setItem(`${STORAGE_KEY}_audit`, JSON.stringify(auditLogs));
      localStorage.setItem(`${STORAGE_KEY}_apps`, JSON.stringify(ecosystemApps));
      localStorage.setItem(`${STORAGE_KEY}_integrations`, JSON.stringify(integrations));
      localStorage.setItem(`${STORAGE_KEY}_notif_templates`, JSON.stringify(notificationTemplates));
      localStorage.setItem(`${STORAGE_KEY}_settings`, JSON.stringify(systemSettings));
    } catch (e) {
      console.warn("Storage sync warning", e);
    }
  }, [
    users,
    products,
    customers,
    leads,
    onboardingRecords,
    subscriptions,
    blogPosts,
    websitePages,
    websiteSections,
    testimonials,
    faqs,
    mediaAssets,
    auditLogs,
    ecosystemApps,
    integrations,
    notificationTemplates,
    systemSettings
  ]);

  // Keyboard shortcut for Command palette (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Central audit logging
  const logAuditEvent = (
    action: string,
    module: string,
    details: string,
    options?: {
      recordId?: string;
      recordName?: string;
      beforeValue?: string;
      afterValue?: string;
      status?: "success" | "warning" | "error";
    }
  ) => {
    const newEntry: AuditLogEntry = {
      id: `aud-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      action,
      module,
      recordId: options?.recordId,
      recordName: options?.recordName,
      details,
      beforeValue: options?.beforeValue,
      afterValue: options?.afterValue,
      ipAddress: "127.0.0.1",
      status: options?.status || "success"
    };

    setAuditLogs((prev) => [newEntry, ...prev]);

    // Send to backend server asynchronously
    fetch("/api/audit-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        module,
        details,
        userEmail: currentUser.email,
        status: options?.status || "success"
      })
    }).catch(() => {
      // Non-blocking telemetry
    });
  };

  // Role Switcher for testing RBAC
  const switchUserRole = (role: UserRole) => {
    const matching = users.find((u) => u.role === role);
    if (matching) {
      setCurrentUser(matching);
    } else {
      const tempUser: User = {
        ...currentUser,
        role,
        name: `Artify (${role})`
      };
      setCurrentUser(tempUser);
    }
    logAuditEvent("SWITCH_ACTIVE_ROLE", "Security & IAM", `Active administrative persona changed to ${role}`);
  };

  const login = (email?: string, role?: UserRole) => {
    setIsAuthenticated(true);
    if (email) {
      const match = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (match) setCurrentUser(match);
    } else if (role) {
      switchUserRole(role);
    }
    logAuditEvent("USER_LOGIN", "Authentication", `User ${currentUser.email} authenticated to Super Admin`);
  };

  const logout = () => {
    setIsAuthenticated(false);
    logAuditEvent("USER_LOGOUT", "Authentication", `User ${currentUser.email} logged out from control center`);
  };

  // Product Actions
  const saveProduct = (product: Product) => {
    const existing = products.find((p) => p.id === product.id);
    if (existing) {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? product : p)));
      logAuditEvent("UPDATE_PRODUCT", "Products", `Updated product configuration for '${product.name}'`, {
        recordId: product.id,
        recordName: product.name,
        beforeValue: `Status: ${existing.status}, Pricing: ${existing.pricingModel}`,
        afterValue: `Status: ${product.status}, Pricing: ${product.pricingModel}`
      });
    } else {
      setProducts((prev) => [product, ...prev]);
      logAuditEvent("CREATE_PRODUCT", "Products", `Created new enterprise solution '${product.name}'`, {
        recordId: product.id,
        recordName: product.name
      });
    }
  };

  const deleteProduct = (id: string) => {
    const item = products.find((p) => p.id === id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    logAuditEvent("DELETE_PRODUCT", "Products", `Archived/deleted product ${item?.name || id}`, {
      recordId: id,
      recordName: item?.name
    });
  };

  // Lead Actions
  const createLead = (leadData: Omit<Lead, "id" | "createdAt" | "updatedAt">) => {
    const newLead: Lead = {
      ...leadData,
      id: `lead-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setLeads((prev) => [newLead, ...prev]);
    logAuditEvent("CREATE_LEAD", "Leads & CRM", `New enquiry received from ${newLead.companyName} (${newLead.leadSource})`, {
      recordId: newLead.id,
      recordName: newLead.companyName
    });
  };

  const updateLeadStage = (id: string, newStage: LeadStage) => {
    const target = leads.find((l) => l.id === id);
    if (!target) return;
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, stage: newStage, updatedAt: new Date().toISOString() } : l))
    );
    logAuditEvent("UPDATE_LEAD_STAGE", "Leads & CRM", `Lead ${target.companyName} transitioned to stage ${newStage}`, {
      recordId: id,
      recordName: target.companyName,
      beforeValue: target.stage,
      afterValue: newStage
    });
  };

  const addLeadNote = (id: string, note: string) => {
    const target = leads.find((l) => l.id === id);
    if (!target) return;
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, notes: [note, ...l.notes], updatedAt: new Date().toISOString() } : l))
    );
    logAuditEvent("ADD_LEAD_NOTE", "Leads & CRM", `Added note to lead ${target.companyName}`);
  };

  const convertLeadToCustomer = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === "Converted") return;

    // Create customer record
    const newCustomer: CustomerCompany = {
      id: `cust-${Date.now()}`,
      name: lead.companyName,
      industry: "Enterprise",
      size: lead.companySize || "100-500 Employees",
      country: "Global",
      website: `https://${lead.companyName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
      contactEmail: lead.email,
      contactPhone: lead.phone || "+1 (800) 555-0000",
      accountManager: lead.assignedStaff || currentUser.name,
      status: "onboarding",
      onboardingProgress: 15,
      activeProducts: [lead.productInterest],
      totalSpend: lead.estimatedValue,
      joinedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      notes: `Converted from lead (${lead.leadSource}). Notes: ${lead.notes.join("; ")}`
    };

    setCustomers((prev) => [newCustomer, ...prev]);

    // Mark lead as converted
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? {
              ...l,
              stage: "Converted",
              convertedCustomerId: newCustomer.id,
              updatedAt: new Date().toISOString()
            }
          : l
      )
    );

    // Create onboarding record
    const newOnb: CustomerOnboardingRecord = {
      id: `onb-${Date.now()}`,
      customerId: newCustomer.id,
      customerName: newCustomer.name,
      currentStage: "Customer",
      progressPercentage: 20,
      assignedStaff: newCustomer.accountManager,
      startedAt: new Date().toISOString(),
      targetCompletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      outstandingRequirements: ["Kickoff meeting schedule", "Security questionnaire signoff"],
      steps: [
        { id: "st-1", title: "Enterprise Solution Architecture Review", description: "Validate client network specifications.", isCompleted: true, completedAt: new Date().toISOString() },
        { id: "st-2", title: "Sandbox Instance Provisioning", description: "Deploy dedicated tenant cluster.", isCompleted: false, dueDate: "Next week" },
        { id: "st-3", title: "Key User Training & Cutover", description: "Admin training session.", isCompleted: false }
      ]
    };
    setOnboardingRecords((prev) => [newOnb, ...prev]);

    logAuditEvent("CONVERT_LEAD_TO_CUSTOMER", "Leads & CRM", `Converted lead ${lead.companyName} into customer ${newCustomer.name}`, {
      recordId: lead.id,
      recordName: lead.companyName,
      afterValue: `New Customer ID: ${newCustomer.id}`
    });
  };

  // Customer Actions
  const saveCustomer = (customer: CustomerCompany) => {
    const existing = customers.find((c) => c.id === customer.id);
    if (existing) {
      setCustomers((prev) => prev.map((c) => (c.id === customer.id ? customer : c)));
      logAuditEvent("UPDATE_CUSTOMER", "Customers", `Updated profile for customer ${customer.name}`, {
        recordId: customer.id,
        recordName: customer.name
      });
    } else {
      setCustomers((prev) => [customer, ...prev]);
      logAuditEvent("CREATE_CUSTOMER", "Customers", `Created enterprise customer ${customer.name}`, {
        recordId: customer.id,
        recordName: customer.name
      });
    }
  };

  // Onboarding Step Toggle
  const toggleOnboardingStep = (recordId: string, stepId: string) => {
    setOnboardingRecords((prev) =>
      prev.map((rec) => {
        if (rec.id !== recordId) return rec;
        const currentSteps = rec.steps || [];
        const updatedSteps = currentSteps.map((s) => {
          if (s.id !== stepId) return s;
          const nextVal = !s.isCompleted;
          return {
            ...s,
            isCompleted: nextVal,
            completedAt: nextVal ? new Date().toISOString() : undefined
          };
        });
        const completedCount = updatedSteps.filter((s) => s.isCompleted).length;
        const total = updatedSteps.length;
        const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
        return {
          ...rec,
          steps: updatedSteps,
          progressPercentage: pct,
          currentStage: pct === 100 ? "Active Customer" : "Onboarding"
        };
      })
    );
    logAuditEvent("UPDATE_ONBOARDING", "Onboarding", `Updated milestone in customer onboarding record ${recordId}`);
  };

  // Subscriptions
  const updateSubscriptionStatus = (id: string, status: Subscription["status"]) => {
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) return;
    setSubscriptions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status } : s))
    );
    logAuditEvent("UPDATE_SUBSCRIPTION", "Subscriptions", `Changed subscription status of ${sub.productName} for ${sub.customerName} to ${status}`, {
      recordId: id,
      recordName: sub.productName,
      beforeValue: sub.status,
      afterValue: status
    });
  };

  // Blog & Content
  const saveBlogPost = (post: BlogPost) => {
    const existing = blogPosts.find((b) => b.id === post.id);
    if (existing) {
      setBlogPosts((prev) => prev.map((b) => (b.id === post.id ? post : b)));
      logAuditEvent("UPDATE_BLOG_POST", "Blog CMS", `Updated article '${post.title}' (Status: ${post.status})`, {
        recordId: post.id,
        recordName: post.title,
        beforeValue: existing.status,
        afterValue: post.status
      });
    } else {
      setBlogPosts((prev) => [post, ...prev]);
      logAuditEvent("CREATE_BLOG_POST", "Blog CMS", `Created article draft '${post.title}'`, {
        recordId: post.id,
        recordName: post.title
      });
    }
  };

  const deleteBlogPost = (id: string) => {
    const post = blogPosts.find((b) => b.id === id);
    setBlogPosts((prev) => prev.filter((b) => b.id !== id));
    logAuditEvent("DELETE_BLOG_POST", "Blog CMS", `Deleted article ${post?.title || id}`, {
      recordId: id,
      recordName: post?.title
    });
  };

  // Website Management
  const updateWebsiteSection = (sectionId: string, data: Partial<WebsiteSection>) => {
    setWebsiteSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, ...data, updatedAt: new Date().toISOString() } : s))
    );
    logAuditEvent("UPDATE_WEBSITE_SECTION", "Website Management", `Modified section '${sectionId}'`, {
      recordId: sectionId
    });
  };

  const saveTestimonial = (test: Testimonial) => {
    const existing = testimonials.find((t) => t.id === test.id);
    if (existing) {
      setTestimonials((prev) => prev.map((t) => (t.id === test.id ? test : t)));
    } else {
      setTestimonials((prev) => [test, ...prev]);
    }
    logAuditEvent("SAVE_TESTIMONIAL", "Website Management", `Updated testimonial for ${test.clientName} (${test.companyName})`);
  };

  const deleteTestimonial = (id: string) => {
    setTestimonials((prev) => prev.filter((t) => t.id !== id));
    logAuditEvent("DELETE_TESTIMONIAL", "Website Management", `Deleted testimonial id ${id}`);
  };

  const saveFaq = (faq: FaqItem) => {
    const existing = faqs.find((f) => f.id === faq.id);
    if (existing) {
      setFaqs((prev) => prev.map((f) => (f.id === faq.id ? faq : f)));
    } else {
      setFaqs((prev) => [faq, ...prev]);
    }
    logAuditEvent("SAVE_FAQ", "Website Management", `Updated FAQ '${faq.question.slice(0, 30)}...'`);
  };

  const deleteFaq = (id: string) => {
    setFaqs((prev) => prev.filter((f) => f.id !== id));
    logAuditEvent("DELETE_FAQ", "Website Management", `Deleted FAQ id ${id}`);
  };

  // Media
  const addMediaAsset = (asset: MediaAsset) => {
    setMediaAssets((prev) => [asset, ...prev]);
    logAuditEvent("UPLOAD_MEDIA", "Digital Assets", `Uploaded asset ${asset.fileName} (${asset.fileType})`, {
      recordId: asset.id,
      recordName: asset.fileName
    });
  };

  const deleteMediaAsset = (id: string) => {
    const asset = mediaAssets.find((m) => m.id === id);
    setMediaAssets((prev) => prev.filter((m) => m.id !== id));
    logAuditEvent("DELETE_MEDIA", "Digital Assets", `Removed asset ${asset?.fileName || id}`);
  };

  // User & RBAC
  const saveUser = (user: User) => {
    const existing = users.find((u) => u.id === user.id);
    if (existing) {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
      logAuditEvent("UPDATE_USER", "Users & RBAC", `Updated user ${user.name} (${user.role})`, {
        recordId: user.id,
        recordName: user.name,
        beforeValue: `Role: ${existing.role}, Status: ${existing.status}`,
        afterValue: `Role: ${user.role}, Status: ${user.status}`
      });
    } else {
      setUsers((prev) => [user, ...prev]);
      logAuditEvent("CREATE_USER", "Users & RBAC", `Invited administrative user ${user.name} (${user.role})`, {
        recordId: user.id,
        recordName: user.name
      });
    }
  };

  const toggleUserStatus = (id: string) => {
    const u = users.find((item) => item.id === id);
    if (!u) return;
    const nextStatus = u.status === "active" ? "suspended" : "active";
    setUsers((prev) => prev.map((item) => (item.id === id ? { ...item, status: nextStatus } : item)));
    logAuditEvent("TOGGLE_USER_STATUS", "Security & IAM", `Changed status of ${u.name} to ${nextStatus}`, {
      recordId: id,
      recordName: u.name,
      afterValue: nextStatus
    });
  };

  const revokeUserSession = (id: string) => {
    const u = users.find((item) => item.id === id);
    if (!u) return;
    setUsers((prev) => prev.map((item) => (item.id === id ? { ...item, activeSessionsCount: 0 } : item)));
    logAuditEvent("REVOKE_SESSIONS", "Security & IAM", `Revoked all active sessions for ${u.name}`, {
      recordId: id,
      recordName: u.name
    });
  };

  // Integrations & Apps
  const toggleIntegrationStatus = (id: string) => {
    const item = integrations.find((i) => i.id === id);
    if (!item) return;
    const next = item.status === "connected" ? "disconnected" : "connected";
    setIntegrations((prev) => prev.map((i) => (i.id === id ? { ...i, status: next } : i)));
    logAuditEvent("TOGGLE_INTEGRATION", "Integrations", `Toggled status of integration ${item.name} to ${next}`, {
      recordId: id,
      recordName: item.name
    });
  };

  const saveAppRelease = (app: EcosystemApp) => {
    setEcosystemApps((prev) => prev.map((a) => (a.id === app.id ? app : a)));
    logAuditEvent("RELEASE_APP_BUILD", "Applications", `Deployed build ${app.currentVersion} for ${app.name} (${app.platform})`, {
      recordId: app.id,
      recordName: app.name
    });
  };

  // Settings
  const updateSettings = (newSettings: Partial<SystemSettings>) => {
    setSystemSettings((prev) => ({ ...prev, ...newSettings }));
    logAuditEvent("UPDATE_SYSTEM_SETTINGS", "Settings", "Updated global system and enterprise configuration parameters");
  };

  const resetAllDataToDefaults = () => {
    setUsers(initialUsers);
    setCurrentUser(initialUsers[0]);
    setProducts(initialProducts);
    setCustomers(initialCustomers);
    setLeads(initialLeads);
    setOnboardingRecords(initialOnboardingRecords);
    setSubscriptions(initialSubscriptions);
    setBlogPosts(initialBlogPosts);
    setWebsitePages(initialWebsitePages);
    setWebsiteSections(initialWebsiteSections);
    setTestimonials(initialTestimonials);
    setFaqs(initialFaqs);
    setMediaAssets(initialMediaAssets);
    setAuditLogs(initialAuditLogs);
    setEcosystemApps(initialEcosystemApps);
    setIntegrations(initialIntegrations);
    setNotificationTemplates(initialNotificationTemplates);
    setSystemSettings(initialSystemSettings);

    try {
      localStorage.clear();
    } catch {}

    logAuditEvent("RESET_DATASET", "Settings", "Restored factory enterprise demo dataset");
  };

  // AI Generation via backend endpoint
  const callServerAiGenerate = async (prompt: string, taskType = "Content Generation") => {
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, taskType })
      });
      const data = await res.json();
      logAuditEvent("AI_AGENT_PROMPT", "AI Control Center", `Ran AI copilot synthesis (${taskType})`);
      return data;
    } catch (err) {
      console.error("AI Error:", err);
      return {
        content: `Artify Enterprise Intelligence: Analysis completed for "${prompt.slice(0, 80)}...". All architectural modules validated.`,
        modelUsed: "local-enterprise-agent",
        status: "fallback"
      };
    }
  };

  return (
    <AdminDataContext.Provider
      value={{
        currentView,
        activeModule,
        currentUser,
        selectedDateRange,
        isSearchOpen,
        users,
        products,
        customers,
        leads,
        onboardingRecords,
        subscriptions,
        blogPosts,
        websitePages,
        websiteSections,
        testimonials,
        faqs,
        mediaAssets,
        auditLogs,
        ecosystemApps,
        integrations,
        notificationTemplates,
        systemSettings,
        rbacMatrix,
        updateRbacPermission,
        isAuthenticated,
        setCurrentView,
        setActiveModule,
        setSelectedDateRange,
        setIsSearchOpen,
        switchUserRole,
        login,
        logout,
        logAuditEvent,
        saveProduct,
        deleteProduct,
        createLead,
        updateLeadStage,
        addLeadNote,
        convertLeadToCustomer,
        saveCustomer,
        toggleOnboardingStep,
        updateSubscriptionStatus,
        saveBlogPost,
        deleteBlogPost,
        updateWebsiteSection,
        saveTestimonial,
        deleteTestimonial,
        saveFaq,
        deleteFaq,
        addMediaAsset,
        deleteMediaAsset,
        saveUser,
        toggleUserStatus,
        revokeUserSession,
        toggleIntegrationStatus,
        saveAppRelease,
        updateSettings,
        resetAllDataToDefaults,
        callServerAiGenerate
      }}
    >
      {children}
    </AdminDataContext.Provider>
  );
};

export const useAdminData = () => {
  const context = useContext(AdminDataContext);
  if (!context) {
    throw new Error("useAdminData must be used within an AdminDataProvider");
  }
  return context;
};
