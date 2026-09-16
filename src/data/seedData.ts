import {
  User,
  Product,
  CustomerCompany,
  Lead,
  CustomerOnboardingRecord,
  Subscription,
  BlogPost,
  WebsitePage,
  WebsiteSection,
  Testimonial,
  FaqItem,
  MediaAsset,
  AuditLogEntry,
  SystemHealthMetric,
  EcosystemApp,
  IntegrationService,
  NotificationTemplate,
  SystemSettings
} from "../types";

export const initialUsers: User[] = [
  {
    id: "usr-1",
    name: "Artify Chief Architect",
    email: "artifysols@gmail.com",
    phone: "+1 (800) 555-0199",
    role: "Super Admin",
    status: "active",
    department: "Executive Operations",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    createdAt: "2024-01-10T08:00:00.000Z",
    mfaEnabled: true,
    twoFactorType: "authenticator_app",
    activeSessionsCount: 2
  },
  {
    id: "usr-2",
    name: "Elena Rostova",
    email: "e.rostova@artifysols.com",
    phone: "+1 (800) 555-0142",
    role: "Admin",
    status: "active",
    department: "Product Engineering",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    createdAt: "2024-02-15T09:30:00.000Z",
    mfaEnabled: true,
    twoFactorType: "authenticator_app",
    activeSessionsCount: 1
  },
  {
    id: "usr-3",
    name: "Marcus Vance",
    email: "m.vance@artifysols.com",
    phone: "+1 (800) 555-0177",
    role: "Sales / CRM",
    status: "active",
    department: "Enterprise Growth",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 350).toISOString(),
    createdAt: "2024-03-01T11:00:00.000Z",
    mfaEnabled: false,
    activeSessionsCount: 1
  },
  {
    id: "usr-4",
    name: "Sophia Chen",
    email: "s.chen@artifysols.com",
    phone: "+1 (800) 555-0188",
    role: "Content Manager",
    status: "active",
    department: "Ecosystem Marketing",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 600).toISOString(),
    createdAt: "2024-03-12T14:20:00.000Z",
    mfaEnabled: true,
    twoFactorType: "authenticator_app",
    activeSessionsCount: 1
  },
  {
    id: "usr-5",
    name: "Devon Miller",
    email: "d.miller@artifysols.com",
    phone: "+1 (800) 555-0112",
    role: "Support Manager",
    status: "active",
    department: "Client Onboarding & Success",
    lastLoginAt: new Date(Date.now() - 1000 * 60 * 480).toISOString(),
    createdAt: "2024-04-05T10:15:00.000Z",
    mfaEnabled: false,
    activeSessionsCount: 1
  }
];

export const initialProducts: Product[] = [
  {
    id: "prod-erp-1",
    name: "Artify ERP One",
    slug: "artify-erp-one",
    tagline: "Adaptive Enterprise Resource Planning Built for Dynamic Workflows",
    shortDescription: "Unified multi-company ERP synchronizing supply chain, manufacturing, procurement, and finance with zero architectural lock-in.",
    description: "Artify ERP One is engineered from the ground up on our Adaptive Core architecture. Rather than forcing your enterprise to remodel internal protocols to match rigid ERP matrices, Artify ERP One flexes around your operational rules with dynamic workflow graphs, real-time telemetry, and modular microservices.",
    category: "Enterprise ERP",
    industry: ["Manufacturing", "Supply Chain", "Wholesale Distribution", "Logistics"],
    platforms: ["Web", "Cloud", "iOS", "Android", "Desktop"],
    pricingModel: "Per Seat",
    status: "published",
    trialAvailable: true,
    trialDurationDays: 30,
    version: "3.4.1",
    updatedAt: "2024-11-20T10:00:00.000Z",
    seoTitle: "Artify ERP One | Adaptive Enterprise Resource Planning",
    seoDescription: "Discover Artify ERP One: Next-generation adaptive ERP software providing real-time multi-branch visibility, automated inventory, and custom operational pipelines.",
    screenshots: [
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=80"
    ],
    documents: [
      { name: "ERP Architecture Blueprint.pdf", url: "#", type: "PDF" },
      { name: "Security & Compliance Whitepaper.pdf", url: "#", type: "PDF" }
    ],
    features: [
      { id: "f-1", title: "Adaptive Schema Engine", description: "Define custom fields, workflows, and validation hooks without code modification.", includedInPlans: ["Starter", "Growth", "Enterprise"] },
      { id: "f-2", title: "Automated Supply Reconciliation", description: "AI-assisted vendor matching and three-way invoice reconciliation.", includedInPlans: ["Growth", "Enterprise"] },
      { id: "f-3", title: "Multi-Currency Financial Ledger", description: "Real-time consolidated balance sheet across 45+ currencies.", includedInPlans: ["Enterprise"] },
      { id: "f-4", title: "Bi-directional REST & Webhook Bus", description: "Real-time sync with third-party logistics and custom warehouse hardware.", includedInPlans: ["Growth", "Enterprise"] }
    ],
    plans: [
      {
        id: "plan-erp-growth",
        productId: "prod-erp-1",
        name: "Enterprise Growth",
        code: "ERP-GROWTH",
        priceMonthly: 1490,
        priceAnnual: 14900,
        billingInterval: "monthly",
        trialDays: 30,
        isPopular: true,
        maxUsers: 50,
        features: ["Up to 50 active seats", "Full inventory & manufacturing modules", "Automated compliance reports", "Standard API connectors", "Priority 24/7 SLA"],
        entitlements: { maxWarehouses: 10, exportAuditTrail: true, customReports: true }
      },
      {
        id: "plan-erp-corp",
        productId: "prod-erp-1",
        name: "Global Scale",
        code: "ERP-GLOBAL",
        priceMonthly: 3950,
        priceAnnual: 39500,
        billingInterval: "annual",
        trialDays: 30,
        maxUsers: 500,
        features: ["Unlimited seats & branches", "Dedicated private cloud VPC", "Custom ERP module development", "Real-time predictive AI replenishment", "Dedicated Enterprise Account Manager"],
        entitlements: { maxWarehouses: 999, exportAuditTrail: true, customReports: true, dedicatedDb: true }
      }
    ]
  },
  {
    id: "prod-hrm-2",
    name: "Artify Workforce HRM",
    slug: "artify-workforce-hrm",
    tagline: "Total Human Capital, Biometric Scheduling & Intelligent Talent Logistics",
    shortDescription: "Complete workforce command platform with GPS biometric shifts, automated payroll run, talent lifecycle, and compliance tracking.",
    description: "Designed for distributed, multi-regional teams and demanding field workforces. Features automated shift balancing, real-time overtime calculations, localized tax engines, and deep employee self-service mobile applications.",
    category: "HRM & Workforce",
    industry: ["Healthcare", "Hospitality", "Corporate Tech", "Retail & Chains"],
    platforms: ["Web", "iOS", "Android"],
    pricingModel: "Per Seat",
    status: "published",
    trialAvailable: true,
    trialDurationDays: 14,
    version: "2.8.0",
    updatedAt: "2024-11-18T14:30:00.000Z",
    seoTitle: "Artify Workforce HRM | Intelligent Human Capital & Payroll",
    seoDescription: "Streamline human resources, biometric clock-in, localized payroll processing, and employee engagement with Artify Workforce HRM.",
    screenshots: [
      "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=800&auto=format&fit=crop&q=80"
    ],
    documents: [
      { name: "HRM Implementation Guide.pdf", url: "#", type: "PDF" }
    ],
    features: [
      { id: "f-5", title: "Geofenced Mobile Clock-in", description: "Prevent buddy punching with face recognition and verified GPS coordinates.", includedInPlans: ["Starter", "Enterprise"] },
      { id: "f-6", title: "Automated Multi-Jurisdiction Payroll", description: "Direct bank file generation and auto-calculated statutory deductions.", includedInPlans: ["Growth", "Enterprise"] },
      { id: "f-7", title: "Performance 360 Review Matrix", description: "Goal tracking, peer reviews, and succession planning heatmaps.", includedInPlans: ["Enterprise"] }
    ],
    plans: [
      {
        id: "plan-hrm-biz",
        productId: "prod-hrm-2",
        name: "Business Workforce",
        code: "HRM-BIZ",
        priceMonthly: 490,
        priceAnnual: 4900,
        billingInterval: "monthly",
        trialDays: 14,
        isPopular: true,
        maxUsers: 100,
        features: ["Up to 100 employees", "Mobile employee portal (iOS/Android)", "Shift scheduling & leave engine", "Direct payroll deposit exports", "Email support"],
        entitlements: { maxDepartments: 15, documentStorageGb: 50 }
      }
    ]
  },
  {
    id: "prod-fin-3",
    name: "Artify FinCore Suite",
    slug: "artify-fincore-suite",
    tagline: "High-Frequency Corporate Billing, Ledger Reconciliation & Treasury Ops",
    shortDescription: "Automated revenue management, recurring subscription lifecycle, multi-entity tax engines, and financial governance for high-growth enterprises.",
    description: "Artify FinCore provides unyielding accounting precision. Reconcile millions of payment events across Stripe, PayPal, banking rails, and manual wire transfers within seconds.",
    category: "FinTech & Billing",
    industry: ["FinTech", "SaaS Enterprises", "E-commerce Hubs", "Financial Services"],
    platforms: ["Web", "Cloud"],
    pricingModel: "Tiered Flat",
    status: "published",
    trialAvailable: true,
    trialDurationDays: 14,
    version: "2.1.4",
    updatedAt: "2024-11-15T09:00:00.000Z",
    seoTitle: "Artify FinCore Suite | Financial Operations & Billing Engine",
    seoDescription: "Enterprise corporate billing, automated multi-currency accounting, and bank reconciliation engine designed for scalable ecosystems.",
    screenshots: [
      "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800&auto=format&fit=crop&q=80"
    ],
    documents: [],
    features: [
      { id: "f-8", title: "Real-time Banking Settlement", description: "Direct API connectors to major US and European clearing houses.", includedInPlans: ["Enterprise"] },
      { id: "f-9", title: "Adaptive Revenue Recognition (ASC 606)", description: "Auto-amortization schedules for upfront annual and usage contracts.", includedInPlans: ["Enterprise"] }
    ],
    plans: [
      {
        id: "plan-fin-pro",
        productId: "prod-fin-3",
        name: "FinTech Core Pro",
        code: "FIN-PRO",
        priceMonthly: 1250,
        priceAnnual: 12500,
        billingInterval: "monthly",
        trialDays: 14,
        maxUsers: 25,
        features: ["Up to $2M monthly processed volume", "Automated revenue recognition", "Multi-currency bank feed sync", "SOC2 compliance audit pack"],
        entitlements: { processedVolumeCap: 2000000 }
      }
    ]
  },
  {
    id: "prod-ai-4",
    name: "Artify AI Business Suite",
    slug: "artify-ai-business-suite",
    tagline: "Autonomous Agentic Workflows & Retrieval-Augmented Enterprise Intelligence",
    shortDescription: "Turn internal documentation, CRM data, and operational logs into proactive autonomous agents executing customer support, lead triage, and forecasting.",
    description: "Powered by modern LLM orchestration and Gemini multimodal capabilities. The Artify AI Suite connects securely to your private database with zero data leakage, enabling automated query synthesis, contract audits, and customer support copilots.",
    category: "AI Business Suite",
    industry: ["Cross-Industry", "Consulting", "Legal & Compliance", "Healthcare"],
    platforms: ["Web", "Cloud", "iOS", "Android"],
    pricingModel: "Usage Based",
    status: "published",
    trialAvailable: true,
    trialDurationDays: 7,
    version: "1.9.2",
    updatedAt: "2024-11-22T16:00:00.000Z",
    seoTitle: "Artify AI Business Suite | Agentic Workflows & Enterprise AI",
    seoDescription: "Deploy sovereign enterprise AI agents that adapt to your corporate knowledge base, automate repetitive tasks, and assist executive strategy.",
    screenshots: [
      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80"
    ],
    documents: [],
    features: [
      { id: "f-10", title: "Sovereign Knowledge RAG", description: "Private vector embeddings search across company PDFs, wikis, and ERP records.", includedInPlans: ["Growth", "Enterprise"] },
      { id: "f-11", title: "Autonomous Task Workers", description: "Self-executing cron agents that analyze CRM leads and draft tailored outreach.", includedInPlans: ["Enterprise"] }
    ],
    plans: [
      {
        id: "plan-ai-standard",
        productId: "prod-ai-4",
        name: "Cognitive Enterprise",
        code: "AI-COGNITIVE",
        priceMonthly: 890,
        priceAnnual: 8900,
        billingInterval: "monthly",
        trialDays: 7,
        maxUsers: 50,
        features: ["1,000,000 monthly AI reasoning tokens", "Up to 5 custom enterprise agent bots", "Full vector index of company records", "Human-in-the-loop review workbench"],
        entitlements: { tokensPerMonth: 1000000, maxAgents: 5 }
      }
    ]
  },
  {
    id: "prod-bespoke-5",
    name: "Artify Bespoke Studio",
    slug: "artify-bespoke-studio",
    tagline: "Custom Architecture, Native Mobile (iOS/Android) & Tailored Platforms",
    shortDescription: "End-to-end bespoke software engineering where Artify builds, deploys, and maintains mission-critical applications dedicated solely to your enterprise.",
    description: "When off-the-shelf software falls short, Artify Bespoke Studio steps in. We engineer custom web systems, high-performance Android & iOS applications, and embedded IoT firmware with dedicated continuous integration and lifelong maintenance.",
    category: "Bespoke Enterprise",
    industry: ["Aerospace", "Government & Public Sector", "Specialty Manufacturing", "FinTech"],
    platforms: ["Web", "iOS", "Android", "Cloud", "Desktop"],
    pricingModel: "Custom Enterprise",
    status: "published",
    trialAvailable: false,
    trialDurationDays: 0,
    version: "Continuous",
    updatedAt: "2024-11-10T12:00:00.000Z",
    seoTitle: "Artify Bespoke Studio | Tailored Enterprise Applications",
    seoDescription: "Custom software engineering built to adapt to your unique organizational architecture, from native mobile apps to private cloud clusters.",
    screenshots: [
      "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80"
    ],
    documents: [],
    features: [
      { id: "f-12", title: "Dedicated Senior Squad", description: "Full engineering pod consisting of solution architect, UX lead, and full-stack engineers.", includedInPlans: ["Custom"] }
    ],
    plans: [
      {
        id: "plan-bespoke-squad",
        productId: "prod-bespoke-5",
        name: "Dedicated Engineering Pod",
        code: "BESPOKE-POD",
        priceMonthly: 12000,
        priceAnnual: 130000,
        billingInterval: "custom",
        trialDays: 0,
        maxUsers: 9999,
        features: ["Dedicated 4-engineer squad", "Weekly milestone deployment", "Full source code ownership", "Guaranteed 99.99% uptime SLA"],
        entitlements: { dedicatedEngineers: 4 }
      }
    ]
  }
];

export const initialCustomers: CustomerCompany[] = [
  {
    id: "cust-1",
    name: "Apex Global Logistics Inc.",
    industry: "Logistics & Freight",
    size: "500-1,000 Employees",
    country: "United States",
    website: "https://apex-logistics.example.com",
    contactEmail: "procurement@apex-logistics.example.com",
    contactPhone: "+1 (312) 555-8921",
    accountManager: "Marcus Vance",
    status: "active",
    onboardingProgress: 100,
    activeProducts: ["Artify ERP One", "Artify Workforce HRM"],
    totalSpend: 56800,
    joinedAt: "2024-02-15T00:00:00.000Z",
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    notes: "Completed multi-hub warehouse deployment. Renewal scheduled for Q1.",
    renewalDate: "2025-02-15"
  },
  {
    id: "cust-2",
    name: "Zenith Health Care Networks",
    industry: "Hospital & Healthcare",
    size: "1,000-5,000 Employees",
    country: "Canada",
    website: "https://zenithhealth.example.org",
    contactEmail: "cio@zenithhealth.example.org",
    contactPhone: "+1 (416) 555-4412",
    accountManager: "Devon Miller",
    status: "active",
    onboardingProgress: 88,
    activeProducts: ["Artify Workforce HRM", "Artify AI Business Suite"],
    totalSpend: 34200,
    joinedAt: "2024-05-10T00:00:00.000Z",
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    notes: "Shift balancing and biometric mobile check-in active across 6 clinics.",
    renewalDate: "2025-05-10"
  },
  {
    id: "cust-3",
    name: "NexaTech Financial Holdings",
    industry: "FinTech & Banking",
    size: "200-500 Employees",
    country: "United Kingdom",
    website: "https://nexatech-fin.example.co.uk",
    contactEmail: "finance.ops@nexatech-fin.example.co.uk",
    contactPhone: "+44 20 7946 0912",
    accountManager: "Elena Rostova",
    status: "active",
    onboardingProgress: 94,
    activeProducts: ["Artify FinCore Suite"],
    totalSpend: 28900,
    joinedAt: "2024-07-01T00:00:00.000Z",
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    notes: "Automated billing pipeline live. Processing ~$1.4M weekly.",
    renewalDate: "2025-07-01"
  },
  {
    id: "cust-4",
    name: "Quantum Retail Group",
    industry: "Retail & Omnichannel",
    size: "50-200 Employees",
    country: "Australia",
    website: "https://quantumretail.example.com.au",
    contactEmail: "tech@quantumretail.example.com.au",
    contactPhone: "+61 2 9876 5432",
    accountManager: "Marcus Vance",
    status: "onboarding",
    onboardingProgress: 45,
    activeProducts: ["Artify ERP One"],
    totalSpend: 8900,
    joinedAt: "2024-10-18T00:00:00.000Z",
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 600).toISOString(),
    notes: "Stage 3: Data migration from legacy SAP instance in progress.",
    renewalDate: "2025-10-18"
  },
  {
    id: "cust-5",
    name: "Horizon Aero Manufacturing",
    industry: "Aerospace Precision",
    size: "500-1,000 Employees",
    country: "Germany",
    website: "https://horizon-aero.example.de",
    contactEmail: "klaus.richter@horizon-aero.example.de",
    contactPhone: "+49 30 1234 5678",
    accountManager: "Artify Chief Architect",
    status: "trial",
    onboardingProgress: 20,
    activeProducts: ["Artify Bespoke Studio"],
    totalSpend: 15000,
    joinedAt: "2024-11-05T00:00:00.000Z",
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 1200).toISOString(),
    notes: "Prototype testing for specialized CNC tool tracking telemetry.",
    renewalDate: "2024-12-05"
  }
];

export const initialLeads: Lead[] = [
  {
    id: "lead-1",
    name: "David Sterling",
    email: "d.sterling@vanguardindustrial.com",
    phone: "+1 (415) 555-7801",
    companyName: "Vanguard Industrial Machinery",
    companySize: "250-500 Employees",
    productInterest: "Artify ERP One",
    leadSource: "Demo Request",
    stage: "Proposal/Opportunity",
    assignedStaff: "Marcus Vance",
    estimatedValue: 48000,
    notes: [
      "Requested demo on dynamic multi-warehouse routing.",
      "Custom ERP architecture proposal sent on Nov 19th. Follow up next Tuesday."
    ],
    createdAt: "2024-11-12T10:14:00.000Z",
    updatedAt: "2024-11-19T16:20:00.000Z"
  },
  {
    id: "lead-2",
    name: "Amina Al-Mansoor",
    email: "amina@dubaimultiplex.ae",
    phone: "+971 4 555 9012",
    companyName: "Gulf Multiplex Logistics",
    companySize: "1,000+ Employees",
    productInterest: "Artify Workforce HRM",
    leadSource: "Website Contact",
    stage: "Qualified",
    assignedStaff: "Marcus Vance",
    estimatedValue: 62000,
    notes: [
      "Needs biometrics and mobile GPS shift verification across 8 regional depots.",
      "Security compliance packet approved by their IT director."
    ],
    createdAt: "2024-11-16T08:30:00.000Z",
    updatedAt: "2024-11-20T11:45:00.000Z"
  },
  {
    id: "lead-3",
    name: "Julian Rivera",
    email: "jrivera@novapayments.io",
    phone: "+1 (646) 555-3341",
    companyName: "Nova Payments Inc.",
    companySize: "50-100 Employees",
    productInterest: "Artify FinCore Suite",
    leadSource: "Product Enquiry",
    stage: "Contacted",
    assignedStaff: "Elena Rostova",
    estimatedValue: 24000,
    notes: [
      "Evaluating automated recurring billing reconciliation to replace Chargebee.",
      "Technical discovery call scheduled."
    ],
    createdAt: "2024-11-18T14:15:00.000Z",
    updatedAt: "2024-11-19T09:00:00.000Z"
  },
  {
    id: "lead-4",
    name: "Sarah Lindqvist",
    email: "sarah@nordicbioscience.se",
    phone: "+46 8 555 7890",
    companyName: "Nordic BioScience Labs",
    companySize: "100-250 Employees",
    productInterest: "Artify AI Business Suite",
    leadSource: "Demo Request",
    stage: "New",
    assignedStaff: "Marcus Vance",
    estimatedValue: 36000,
    notes: [
      "Submitted demo form via homepage: 'Need automated research document summarization and compliance check.'"
    ],
    createdAt: "2024-11-22T15:20:00.000Z",
    updatedAt: "2024-11-22T15:20:00.000Z"
  },
  {
    id: "lead-5",
    name: "Robert MacIntyre",
    email: "robert@highlanddistillers.co.uk",
    companyName: "Highland Spirits Group",
    productInterest: "Artify ERP One",
    leadSource: "Newsletter",
    stage: "Converted",
    assignedStaff: "Marcus Vance",
    estimatedValue: 32000,
    notes: [
      "Converted to customer: Apex Global Logistics sister subsidiary.",
      "Account setup initiated."
    ],
    createdAt: "2024-10-05T09:00:00.000Z",
    updatedAt: "2024-11-01T10:00:00.000Z",
    convertedCustomerId: "cust-1"
  }
];

export const initialOnboardingRecords: CustomerOnboardingRecord[] = [
  {
    id: "onb-1",
    customerId: "cust-4",
    customerName: "Quantum Retail Group",
    currentStage: "Onboarding",
    progressPercentage: 45,
    assignedStaff: "Devon Miller",
    startedAt: "2024-10-18T00:00:00.000Z",
    targetCompletionDate: "2024-12-15",
    outstandingRequirements: [
      "Sign-off on warehouse bin location master list",
      "Configure SSO SAML identity provider with Okta"
    ],
    steps: [
      { id: "s-1", title: "Enterprise Discovery & Scope Definition", description: "Map legacy workflow graphs to Artify adaptive schema.", isCompleted: true, completedAt: "2024-10-24T00:00:00.000Z" },
      { id: "s-2", title: "Sandbox Instance Provisioning", description: "Spin up dedicated tenant database and encrypted VPC.", isCompleted: true, completedAt: "2024-11-01T00:00:00.000Z" },
      { id: "s-3", title: "Historical Data Migration", description: "Import 480k product SKU records and active inventory balances.", isCompleted: false, assignedTo: "Devon Miller", dueDate: "2024-11-30" },
      { id: "s-4", title: "Key User Training & Dry Run", description: "Train 15 store managers and logistics coordinators.", isCompleted: false, assignedTo: "Marcus Vance", dueDate: "2024-12-07" },
      { id: "s-5", title: "Production Cutover & Signoff", description: "Switch primary transaction routing to Artify ERP One.", isCompleted: false, assignedTo: "Devon Miller", dueDate: "2024-12-15" }
    ]
  },
  {
    id: "onb-2",
    customerId: "cust-5",
    customerName: "Horizon Aero Manufacturing",
    currentStage: "Trial",
    progressPercentage: 20,
    assignedStaff: "Artify Chief Architect",
    startedAt: "2024-11-05T00:00:00.000Z",
    targetCompletionDate: "2025-01-20",
    outstandingRequirements: [
      "Hardware telemetry gateway specification sheet"
    ],
    steps: [
      { id: "s-6", title: "Technical Architecture Workshop", description: "Define low-latency protocol for machine telemetry.", isCompleted: true, completedAt: "2024-11-12T00:00:00.000Z" },
      { id: "s-7", title: "Proof-of-Concept Prototype", description: "Deliver bespoke Android telemetry dashboard.", isCompleted: false, assignedTo: "Elena Rostova", dueDate: "2024-12-05" }
    ]
  }
];

export const initialSubscriptions: Subscription[] = [
  {
    id: "sub-1",
    customerId: "cust-1",
    customerName: "Apex Global Logistics Inc.",
    productId: "prod-erp-1",
    productName: "Artify ERP One",
    planName: "Global Scale",
    status: "active",
    billingCycle: "annual",
    amount: 39500,
    currentPeriodStart: "2024-02-15T00:00:00.000Z",
    currentPeriodEnd: "2025-02-15T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    seatsAllocated: 200,
    seatsUsed: 142
  },
  {
    id: "sub-2",
    customerId: "cust-2",
    customerName: "Zenith Health Care Networks",
    productId: "prod-hrm-2",
    productName: "Artify Workforce HRM",
    planName: "Business Workforce",
    status: "active",
    billingCycle: "annual",
    amount: 14700,
    currentPeriodStart: "2024-05-10T00:00:00.000Z",
    currentPeriodEnd: "2025-05-10T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    seatsAllocated: 300,
    seatsUsed: 285
  },
  {
    id: "sub-3",
    customerId: "cust-3",
    customerName: "NexaTech Financial Holdings",
    productId: "prod-fin-3",
    productName: "Artify FinCore Suite",
    planName: "FinTech Core Pro",
    status: "active",
    billingCycle: "monthly",
    amount: 1250,
    currentPeriodStart: "2024-11-01T00:00:00.000Z",
    currentPeriodEnd: "2024-12-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    seatsAllocated: 25,
    seatsUsed: 19
  },
  {
    id: "sub-4",
    customerId: "cust-4",
    customerName: "Quantum Retail Group",
    productId: "prod-erp-1",
    productName: "Artify ERP One",
    planName: "Enterprise Growth",
    status: "trialing",
    billingCycle: "monthly",
    amount: 1490,
    currentPeriodStart: "2024-10-18T00:00:00.000Z",
    currentPeriodEnd: "2024-12-18T00:00:00.000Z",
    trialEndsAt: "2024-12-18T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    seatsAllocated: 50,
    seatsUsed: 12
  }
];

export const initialBlogPosts: BlogPost[] = [
  {
    id: "post-1",
    title: "Why Rigid ERP Fails: The Mathematical Case for Adaptive Architecture",
    slug: "why-rigid-erp-fails-adaptive-architecture",
    excerpt: "Legacy enterprise suites force operations into predetermined silos. Explore how graph-based adaptive schemas eliminate $2.4M in average custom rework costs.",
    content: "When software dictates how a business operates, agility dies. In traditional enterprise implementations, over 60% of engineering budget is devoured by bridging brittle database schemas with actual warehouse, supply, and payroll realities.\n\nAt Artify Sols, our core doctrine is absolute: Software should adapt to your business, not your business to software.\n\nBy leveraging asynchronous event buses and dynamic entity models, our systems allow enterprises to alter operational parameters on the fly without breaking historical audit trails.",
    featuredImage: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80",
    authorName: "Artify Chief Architect",
    authorRole: "Founder & Lead Architect",
    category: "Architecture & Strategy",
    tags: ["Enterprise Architecture", "Adaptive Software", "ERP", "Scalability"],
    seoTitle: "The Case for Adaptive Enterprise Software | Artify Insights",
    metaDescription: "Discover how adaptive architecture frees enterprises from legacy vendor lock-in and scales operational efficiency.",
    status: "published",
    publishedAt: "2024-11-10T08:00:00.000Z",
    updatedAt: "2024-11-15T10:00:00.000Z",
    viewsCount: 4210,
    isAiGenerated: false
  },
  {
    id: "post-2",
    title: "Deploying Sovereign AI Agents Within High-Compliance Enterprise Firewalls",
    slug: "deploying-sovereign-ai-agents-enterprise",
    excerpt: "A technical walkthrough of zero-data-leakage vector search and localized LLM reasoning across financial and healthcare datasets.",
    content: "Enterprises want the exponential productivity of modern generative AI, but cannot risk trade secrets or regulated records crossing uncontrolled third-party boundaries.\n\nArtify AI Business Suite solves this via sovereign edge proxies, client-side encryption before vector indexing, and rigorous RBAC permission masking.",
    featuredImage: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80",
    authorName: "Elena Rostova",
    authorRole: "Principal Systems Engineer",
    category: "AI & Automation",
    tags: ["Generative AI", "Enterprise Security", "RAG", "Gemini 3.8"],
    seoTitle: "Deploying Sovereign Enterprise AI Agents | Artify Sols",
    metaDescription: "Learn how Artify deploys zero-leakage AI copilots and autonomous agentic workflows inside private enterprise networks.",
    status: "published",
    publishedAt: "2024-11-18T12:00:00.000Z",
    updatedAt: "2024-11-18T12:00:00.000Z",
    viewsCount: 2840,
    isAiGenerated: true,
    aiApprovedBy: "Elena Rostova"
  },
  {
    id: "post-3",
    title: "Unified Biometric Scheduling: Solving Shift Fatigue in Critical Healthcare",
    slug: "unified-biometric-scheduling-healthcare",
    excerpt: "How Zenith Health eliminated 32% of unassigned clinic shifts using automated overtime balancing and geofenced mobile verification.",
    content: "When healthcare staffing systems rely on manual spreadsheets, patient outcomes suffer. By implementing Artify Workforce HRM with real-time biometric validation and mobile shift bidding, hospital networks maintain seamless 24/7 coverage with zero administrative lag.",
    featuredImage: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=800&auto=format&fit=crop&q=80",
    authorName: "Sophia Chen",
    authorRole: "Head of Content",
    category: "Case Studies",
    tags: ["Workforce Management", "Healthcare", "HR Tech", "Biometrics"],
    seoTitle: "Automated Biometric Shift Scheduling Case Study | Artify",
    metaDescription: "See how Zenith Health Networks reduced staffing gaps and overtime overruns with Artify Workforce HRM.",
    status: "in_review",
    updatedAt: "2024-11-21T15:30:00.000Z",
    viewsCount: 0,
    isAiGenerated: true
  }
];

export const initialWebsitePages: WebsitePage[] = [
  {
    id: "page-1",
    title: "Homepage / Ecosystem Portal",
    slug: "/",
    status: "published",
    lastEditedBy: "Artify Chief Architect",
    updatedAt: "2024-11-22T09:00:00.000Z",
    metaTitle: "Artify Sols — Adaptive Enterprise Ecosystem & Custom Software",
    metaDescription: "Software should adapt your business, not your business adapt software. Enterprise ERP, Workforce HRM, FinTech, AI Copilots, and Bespoke Applications.",
    sectionsCount: 7,
    isSystemPage: true
  },
  {
    id: "page-2",
    title: "Products & Solutions Catalog",
    slug: "/solutions",
    status: "published",
    lastEditedBy: "Elena Rostova",
    updatedAt: "2024-11-15T14:00:00.000Z",
    metaTitle: "Enterprise Software Solutions | Artify Sols",
    metaDescription: "Explore Artify's unified suite of ERP, HRM, FinTech, AI agents, and mobile ecosystem solutions.",
    sectionsCount: 4,
    isSystemPage: true
  },
  {
    id: "page-3",
    title: "About Artify Sols",
    slug: "/about",
    status: "published",
    lastEditedBy: "Sophia Chen",
    updatedAt: "2024-11-10T11:00:00.000Z",
    metaTitle: "About Artify Sols | Our Adaptive Software Philosophy",
    metaDescription: "Learn how Artify Sols is transforming enterprise software architecture with adaptive, customizable systems.",
    sectionsCount: 3,
    isSystemPage: false
  },
  {
    id: "page-4",
    title: "Request Demo & Contact",
    slug: "/contact",
    status: "published",
    lastEditedBy: "Marcus Vance",
    updatedAt: "2024-11-20T17:00:00.000Z",
    metaTitle: "Request an Enterprise Demo | Artify Sols",
    metaDescription: "Schedule an executive consultation or live architectural demonstration with Artify enterprise specialists.",
    sectionsCount: 2,
    isSystemPage: true
  }
];

export const initialWebsiteSections: WebsiteSection[] = [
  {
    id: "sec-hero",
    pageId: "page-1",
    sectionKey: "hero",
    title: "Software should adapt your business, not your business adapt software.",
    subtitle: "Artify Sols engineers unified enterprise ecosystems — from adaptive ERP and biometric workforce HRM to private AI copilots and high-load mobile applications.",
    isVisible: true,
    orderIndex: 1,
    updatedAt: "2024-11-22T09:00:00.000Z",
    content: {
      ctaPrimaryText: "Request Architecture Demo",
      ctaPrimaryLink: "#demo",
      ctaSecondaryText: "Explore Ecosystem Solutions",
      ctaSecondaryLink: "#solutions",
      badgeText: "ENTERPRISE ADAPTIVE SUITE 2025"
    }
  },
  {
    id: "sec-stats",
    pageId: "page-1",
    sectionKey: "stats",
    title: "Proven Scale Across Global Operations",
    isVisible: true,
    orderIndex: 2,
    updatedAt: "2024-11-20T10:00:00.000Z",
    content: {
      stats: [
        { label: "Active Enterprise Users", value: "140k+" },
        { label: "Quarterly Transactions Handled", value: "$4.8B" },
        { label: "Deployment Adaptability SLA", value: "99.99%" },
        { label: "Average Efficiency Lift", value: "3.8x" }
      ]
    }
  },
  {
    id: "sec-products",
    pageId: "page-1",
    sectionKey: "products_grid",
    title: "The Artify Enterprise Ecosystem",
    subtitle: "Modularity at its finest. Deploy one specialized solution or coordinate the entire digital enterprise from a single governance plane.",
    isVisible: true,
    orderIndex: 3,
    updatedAt: "2024-11-20T10:00:00.000Z",
    content: {
      highlightBadge: "Unified Data Fabric"
    }
  },
  {
    id: "sec-testimonials",
    pageId: "page-1",
    sectionKey: "testimonials",
    title: "Trusted by Enterprise Operational Leaders",
    subtitle: "Hear directly from CIOs, operations vice presidents, and finance directors who broke free from rigid legacy software.",
    isVisible: true,
    orderIndex: 4,
    updatedAt: "2024-11-18T10:00:00.000Z",
    content: {}
  },
  {
    id: "sec-faq",
    pageId: "page-1",
    sectionKey: "faq",
    title: "Frequently Asked Questions",
    subtitle: "Clear answers on our architecture, deployment options, migration, and custom bespoke extensions.",
    isVisible: true,
    orderIndex: 5,
    updatedAt: "2024-11-15T10:00:00.000Z",
    content: {}
  },
  {
    id: "sec-cta",
    pageId: "page-1",
    sectionKey: "cta_banner",
    title: "Ready to make software adapt to your enterprise?",
    subtitle: "Consult directly with our solution architects to design your bespoke operational blueprint.",
    isVisible: true,
    orderIndex: 6,
    updatedAt: "2024-11-22T09:00:00.000Z",
    content: {
      buttonText: "Schedule Executive Briefing",
      phoneNumber: "+1 (800) 555-ARTIFY"
    }
  }
];

export const initialTestimonials: Testimonial[] = [
  {
    id: "test-1",
    clientName: "Marcus Thorne",
    clientTitle: "VP of Global Supply Chain",
    companyName: "Apex Global Logistics",
    quote: "Switching to Artify ERP One allowed us to alter our multi-depot cross-docking rules in 48 hours without paying $200k in consultant rework fees. It's genuinely the most adaptive enterprise platform we've seen.",
    rating: 5,
    status: "published",
    productReferenced: "Artify ERP One"
  },
  {
    id: "test-2",
    clientName: "Dr. Alistair Vance",
    clientTitle: "Chief Medical Operations Officer",
    companyName: "Zenith Health Care Networks",
    quote: "Biometric clock-in and automated shift balancing with Artify Workforce HRM eliminated 30+ hours of weekly scheduling headache across our network of outpatient clinics.",
    rating: 5,
    status: "published",
    productReferenced: "Artify Workforce HRM"
  },
  {
    id: "test-3",
    clientName: "Katarina Lind",
    clientTitle: "Director of Billing Architecture",
    companyName: "NexaTech Financial",
    quote: "Artify FinCore handles our multi-entity European and US tax reconciliations with zero discrepancy. Month-end close dropped from 9 days to 4 hours.",
    rating: 5,
    status: "published",
    productReferenced: "Artify FinCore Suite"
  }
];

export const initialFaqs: FaqItem[] = [
  {
    id: "faq-1",
    question: "What does 'Software should adapt your business' actually mean in practice?",
    answer: "Most traditional enterprise suites require companies to restructure internal teams, paperwork, and approval chains to fit the software's rigid hardcoded tables. Artify's Adaptive Core uses configurable state machines, custom entity schemas, and visual workflow builders so the software conforms directly to how your best teams already operate.",
    category: "Architecture",
    orderIndex: 1,
    status: "published"
  },
  {
    id: "faq-2",
    question: "Can Artify solutions be deployed in private cloud or sovereign on-premise environments?",
    answer: "Yes. All Artify enterprise solutions support multi-tenant cloud, dedicated single-tenant VPC (AWS, GCP, Azure), or completely air-gapped sovereign Kubernetes clusters for defense and healthcare clients.",
    category: "Deployment",
    orderIndex: 2,
    status: "published"
  },
  {
    id: "faq-3",
    question: "How does Artify ensure data security and regulatory compliance?",
    answer: "We support end-to-end field-level encryption, SOC 2 Type II audit certifications, GDPR, HIPAA compliance modules, granular RBAC permissions, and immutable audit logging across every administrative action.",
    category: "Security",
    orderIndex: 3,
    status: "published"
  },
  {
    id: "faq-4",
    question: "Do you build custom native iOS and Android applications?",
    answer: "Yes. Through Artify Bespoke Studio, we build high-performance native iOS, Android, and cross-platform Flutter/React Native solutions that connect directly into your Artify ERP, HRM, or FinTech backend.",
    category: "Mobile & Apps",
    orderIndex: 4,
    status: "published"
  }
];

export const initialMediaAssets: MediaAsset[] = [
  {
    id: "med-1",
    fileName: "artify-erp-dashboard-v3.png",
    fileType: "image/png",
    fileSizeKb: 420,
    category: "Product Screenshots",
    url: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80",
    uploadedAt: "2024-11-15T10:00:00.000Z",
    dimensions: "1920x1080",
    usageCount: 4,
    usedIn: ["Homepage Hero", "ERP Landing Page", "Investor Deck"]
  },
  {
    id: "med-2",
    fileName: "artify-workforce-mobile-mockup.png",
    fileType: "image/png",
    fileSizeKb: 310,
    category: "Product Screenshots",
    url: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=800&auto=format&fit=crop&q=80",
    uploadedAt: "2024-11-12T14:30:00.000Z",
    dimensions: "1080x1920",
    usageCount: 3,
    usedIn: ["HRM Product Page", "App Store Listing"]
  },
  {
    id: "med-3",
    fileName: "artify-sols-primary-logo.svg",
    fileType: "image/svg+xml",
    fileSizeKb: 45,
    category: "Brand Logos",
    url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80",
    uploadedAt: "2024-10-01T09:00:00.000Z",
    dimensions: "Vector",
    usageCount: 12,
    usedIn: ["Site Header", "Email Templates", "Customer Portal", "Invoices"]
  },
  {
    id: "med-4",
    fileName: "adaptive-software-whitepaper-2025.pdf",
    fileType: "application/pdf",
    fileSizeKb: 1850,
    category: "Whitepapers",
    url: "#",
    uploadedAt: "2024-11-08T11:20:00.000Z",
    usageCount: 2,
    usedIn: ["Resource Library", "Lead Nurture Sequence"]
  }
];

export const initialAuditLogs: AuditLogEntry[] = [
  {
    id: "aud-1",
    timestamp: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    userId: "usr-1",
    userEmail: "artifysols@gmail.com",
    userRole: "Super Admin",
    action: "UPDATE_PRODUCT_PRICING",
    module: "Products",
    recordId: "prod-erp-1",
    recordName: "Artify ERP One",
    details: "Adjusted annual plan discount from 15% to 17% for Enterprise Growth tier",
    beforeValue: "Annual: $15,200",
    afterValue: "Annual: $14,900",
    ipAddress: "192.168.1.45",
    status: "success"
  },
  {
    id: "aud-2",
    timestamp: new Date(Date.now() - 1000 * 60 * 65).toISOString(),
    userId: "usr-4",
    userEmail: "s.chen@artifysols.com",
    userRole: "Content Manager",
    action: "PUBLISH_BLOG_POST",
    module: "Blog CMS",
    recordId: "post-2",
    recordName: "Deploying Sovereign AI Agents",
    details: "Approved human review and published article to live ecosystem site",
    beforeValue: "Status: in_review",
    afterValue: "Status: published",
    ipAddress: "10.0.4.12",
    status: "success"
  },
  {
    id: "aud-3",
    timestamp: new Date(Date.now() - 1000 * 60 * 140).toISOString(),
    userId: "usr-1",
    userEmail: "artifysols@gmail.com",
    userRole: "Super Admin",
    action: "UPDATE_ROLE_PERMISSIONS",
    module: "Security & RBAC",
    recordId: "role-sales",
    recordName: "Sales / CRM Role",
    details: "Granted 'export' capability for Lead and Customer lists",
    beforeValue: "Permissions: view, create, edit",
    afterValue: "Permissions: view, create, edit, export",
    ipAddress: "192.168.1.45",
    status: "success"
  },
  {
    id: "aud-4",
    timestamp: new Date(Date.now() - 1000 * 60 * 280).toISOString(),
    userId: "usr-3",
    userEmail: "m.vance@artifysols.com",
    userRole: "Sales / CRM",
    action: "CONVERT_LEAD_TO_CUSTOMER",
    module: "Leads & CRM",
    recordId: "lead-5",
    recordName: "Highland Spirits Group",
    details: "Promoted qualified enterprise lead to Customer Company record with preserved interaction history",
    beforeValue: "Stage: Proposal/Opportunity",
    afterValue: "Stage: Converted (Customer ID: cust-1)",
    ipAddress: "172.16.8.99",
    status: "success"
  },
  {
    id: "aud-5",
    timestamp: new Date(Date.now() - 1000 * 60 * 450).toISOString(),
    userId: "usr-2",
    userEmail: "e.rostova@artifysols.com",
    userRole: "Admin",
    action: "TRIGGER_AI_EVALUATION",
    module: "AI Control Center",
    recordId: "ai-eval-12",
    recordName: "Gemini 3.8 Flash Agent Benchmark",
    details: "Ran automated test suite across 150 standard customer support triage prompts",
    beforeValue: "Accuracy: 96.2%",
    afterValue: "Accuracy: 98.4%",
    ipAddress: "10.0.2.81",
    status: "success"
  }
];

export const initialSystemHealth: SystemHealthMetric[] = [
  {
    serviceName: "Adaptive Data Fabric (PostgreSQL / Relational)",
    category: "Core Database",
    status: "healthy",
    latencyMs: 12,
    uptimePercent: 99.99,
    lastChecked: "Just now",
    details: "Pool connection 32/100 active; replication lag < 4ms"
  },
  {
    serviceName: "Enterprise API Gateway",
    category: "API Gateway",
    status: "healthy",
    latencyMs: 18,
    uptimePercent: 99.98,
    lastChecked: "Just now",
    details: "Processing 142 req/sec; HTTP 200 rate 99.94%"
  },
  {
    serviceName: "Identity & RBAC Engine",
    category: "Auth & IAM",
    status: "healthy",
    latencyMs: 8,
    uptimePercent: 100.0,
    lastChecked: "Just now",
    details: "JWT token validation and MFA session enforcement active"
  },
  {
    serviceName: "Gemini AI Orchestrator",
    category: "AI Orchestrator",
    status: "healthy",
    latencyMs: 340,
    uptimePercent: 99.95,
    lastChecked: "Just now",
    details: "Gemini 3.8 Flash model operational; token budget 84% remaining"
  },
  {
    serviceName: "Transactional Email Relay",
    category: "Email Relay",
    status: "healthy",
    latencyMs: 95,
    uptimePercent: 99.91,
    lastChecked: "1 min ago",
    details: "DKIM, SPF, DMARC 100% pass; 0 bounce in queue"
  },
  {
    serviceName: "Asynchronous Background Workers",
    category: "Background Queue",
    status: "healthy",
    latencyMs: 4,
    uptimePercent: 100.0,
    lastChecked: "Just now",
    details: "Redis BullMQ queue depth: 2 jobs pending; 0 failed"
  }
];

export const initialEcosystemApps: EcosystemApp[] = [
  {
    id: "app-1",
    name: "Artify ERP Web Command Center",
    productId: "prod-erp-1",
    platform: "Web App",
    currentVersion: "3.4.1",
    releaseStatus: "Production",
    storeUrl: "https://erp.artifysols.com",
    downloadCount: 14200,
    activeInstalls: 9400,
    lastReleasedAt: "2024-11-20T00:00:00.000Z",
    releaseNotes: "Added dynamic inventory batch tracking and multi-warehouse routing rules."
  },
  {
    id: "app-2",
    name: "Artify Workforce Mobile (Android)",
    productId: "prod-hrm-2",
    platform: "Android App",
    currentVersion: "2.8.0",
    releaseStatus: "Production",
    storeUrl: "https://play.google.com/store/apps/details?id=com.artifysols.workforce",
    downloadCount: 48000,
    activeInstalls: 36200,
    lastReleasedAt: "2024-11-18T00:00:00.000Z",
    releaseNotes: "Optimized offline biometric GPS clock-in for remote job sites."
  },
  {
    id: "app-3",
    name: "Artify Workforce Mobile (iOS)",
    productId: "prod-hrm-2",
    platform: "iOS App",
    currentVersion: "2.8.0",
    releaseStatus: "Production",
    storeUrl: "https://apps.apple.com/app/artify-workforce/id18492019",
    downloadCount: 39500,
    activeInstalls: 31000,
    lastReleasedAt: "2024-11-18T00:00:00.000Z",
    releaseNotes: "FaceID biometric integration and push shift schedule notifications."
  },
  {
    id: "app-4",
    name: "Artify FinCore Treasury Tablet Edition",
    productId: "prod-fin-3",
    platform: "Desktop App",
    currentVersion: "2.1.4",
    releaseStatus: "Production",
    storeUrl: "https://desktop.artifysols.com/fincore",
    downloadCount: 5200,
    activeInstalls: 4100,
    lastReleasedAt: "2024-11-15T00:00:00.000Z",
    releaseNotes: "High-density ledger view for CFO multi-screen desks."
  }
];

export const initialIntegrations: IntegrationService[] = [
  {
    id: "int-1",
    name: "Stripe Enterprise Billing",
    category: "Payment Gateway",
    status: "connected",
    iconName: "CreditCard",
    description: "Credit card, ACH direct debit, and recurring subscription automated billing.",
    environment: "Production",
    lastSyncAt: "3 mins ago",
    apiKeyMasked: "sk_live_51M8...99Xy",
    webhookUrl: "https://api.artifysols.com/webhooks/stripe"
  },
  {
    id: "int-2",
    name: "Google Gemini 3.8 Flash Engine",
    category: "AI Provider",
    status: "connected",
    iconName: "Sparkles",
    description: "Multimodal AI inference, reasoning copilot, and agentic workflows.",
    environment: "Production",
    lastSyncAt: "Just now",
    apiKeyMasked: "AIzaSy...71pQ"
  },
  {
    id: "int-3",
    name: "SendGrid Enterprise Relay",
    category: "Email Provider",
    status: "connected",
    iconName: "Mail",
    description: "Transactional notifications, welcome sequences, and security alerts.",
    environment: "Production",
    lastSyncAt: "12 mins ago",
    apiKeyMasked: "SG.88...Kp1"
  },
  {
    id: "int-4",
    name: "Twilio Communications",
    category: "SMS & Messaging",
    status: "connected",
    iconName: "MessageSquare",
    description: "MFA 2FA SMS tokens, urgent shift alerts, and customer notifications.",
    environment: "Production",
    lastSyncAt: "45 mins ago",
    apiKeyMasked: "AC_77...B89"
  },
  {
    id: "int-5",
    name: "Google Analytics 4 & BigQuery",
    category: "Analytics",
    status: "connected",
    iconName: "BarChart3",
    description: "Aggregated privacy-conscious visitor flow, campaign attribution, and funnels.",
    environment: "Production",
    lastSyncAt: "5 mins ago",
    apiKeyMasked: "G-ARTIFY...01"
  },
  {
    id: "int-6",
    name: "Google Cloud Storage VPC",
    category: "Cloud Storage",
    status: "connected",
    iconName: "HardDrive",
    description: "Encrypted binary object storage for PDFs, customer contracts, and media.",
    environment: "Production",
    lastSyncAt: "Just now",
    apiKeyMasked: "artify-enterprise-assets-gcs"
  }
];

export const initialNotificationTemplates: NotificationTemplate[] = [
  {
    id: "notif-1",
    name: "Enterprise Demo Confirmation",
    channel: "email",
    category: "Welcome",
    subject: "Artify Sols — Your Architecture Consultation is Confirmed",
    bodyTemplate: "Dear {{lead_name}},\n\nThank you for requesting an architectural deep-dive into {{product_interest}}.\n\nOur Solutions Architect {{assigned_staff}} has reserved your slot for {{meeting_time}}.\n\nBest regards,\nArtify Sols Executive Team",
    availableVariables: ["lead_name", "product_interest", "assigned_staff", "meeting_time"],
    isActive: true,
    updatedAt: "2024-11-15T09:00:00.000Z"
  },
  {
    id: "notif-2",
    name: "Subscription Renewal Notice",
    channel: "email",
    category: "Subscription Renewal",
    subject: "Artify Sols — Upcoming Subscription Renewal for {{company_name}}",
    bodyTemplate: "Hello {{contact_name}},\n\nThis is a courtesy notice that your {{product_name}} ({{plan_name}}) subscription will renew on {{renewal_date}} for ${{amount}}.\n\nNo action is required if your billing details are up to date.",
    availableVariables: ["company_name", "contact_name", "product_name", "plan_name", "renewal_date", "amount"],
    isActive: true,
    updatedAt: "2024-11-10T11:00:00.000Z"
  },
  {
    id: "notif-3",
    name: "Security Alert: New Super Admin Login",
    channel: "email",
    category: "Security Alert",
    subject: "Security Alert: Super Admin Login Detected from {{ip_address}}",
    bodyTemplate: "A login to Artify Sols Super Admin Control Center occurred for account {{user_email}} from IP {{ip_address}} at {{timestamp}}.\n\nIf this was not you, revoke all active sessions immediately in Security & Access Control.",
    availableVariables: ["user_email", "ip_address", "timestamp"],
    isActive: true,
    updatedAt: "2024-11-01T08:00:00.000Z"
  }
];

export const initialSystemSettings: SystemSettings = {
  companyName: "Artify Sols",
  tagline: "Software should adapt your business, not your business adapt software.",
  supportEmail: "support@artifysols.com",
  salesEmail: "sales@artifysols.com",
  contactPhone: "+1 (800) 555-ARTIFY",
  headquartersAddress: "100 Enterprise Boulevard, Suite 500, Austin, TX 78701",
  portalUrl: "https://artifysols.com",
  maintenanceMode: false,
  allowPublicRegistrations: true,
  requireMfaForAdmins: true,
  sessionTimeoutMinutes: 60,
  maxFailedLoginAttempts: 5,
  defaultTrialDays: 14,
  enableAiFeatures: true,
  primaryAiModel: "gemini-3.8-flash",
  aiMonthlyTokenBudget: 5000000,
  defaultCurrency: "USD"
};
