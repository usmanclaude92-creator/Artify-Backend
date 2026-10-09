/**
 * Phase 4 §33/§34 — permission-aware navigation is UX only, but it must
 * still correctly reflect the backend permission set, and it must be
 * IMPOSSIBLE for it to grant visibility (let alone access — enforced
 * server-side, see tests/security/authBypass.test.ts in server/) based on
 * anything other than the real `role.permissions` array from the API.
 */
import { describe, expect, it } from "vitest";
import { hasPermission, visibleNavItems, NAV_ITEMS } from "./permissions";

describe("hasPermission", () => {
  it("returns true only when the exact key is present", () => {
    expect(hasPermission(["users.read", "audit.read"], "users.read")).toBe(true);
    expect(hasPermission(["users.read"], "users.delete")).toBe(false);
  });

  it("returns false for undefined/empty permissions (never fails open)", () => {
    expect(hasPermission(undefined, "users.read")).toBe(false);
    expect(hasPermission([], "users.read")).toBe(false);
  });
});

describe("visibleNavItems", () => {
  it("always includes Dashboard, which requires no permission", () => {
    const items = visibleNavItems([]);
    expect(items.map((i) => i.id)).toContain("dashboard");
  });

  it("hides permission-gated items when the permission is absent", () => {
    const items = visibleNavItems([]);
    expect(items.map((i) => i.id)).not.toContain("users");
    expect(items.map((i) => i.id)).not.toContain("organizations");
  });

  it("shows an item once its required permission is present", () => {
    const items = visibleNavItems(["users.read"]);
    expect(items.map((i) => i.id)).toContain("users");
  });

  it("every gated nav item's permission is a real key in the Phase 3 catalog shape (dot-namespaced, module segment may be snake_case — e.g. Phase 7's product_modules.*; Phase 10's portal.* nests a further segment, e.g. portal.dashboard.read)", () => {
    for (const item of NAV_ITEMS) {
      for (const perm of item.requiresAnyPermission ?? []) {
        expect(perm).toMatch(/^[a-z]+(_[a-z]+)*(\.[a-z_]+)+$/);
      }
    }
  });

  it("no nav item is gated by a role check (e.g. 'SUPER_ADMIN') instead of a permission — §7", () => {
    for (const item of NAV_ITEMS) {
      for (const perm of item.requiresAnyPermission ?? []) {
        expect(perm).not.toMatch(/ADMIN|SUPER/i);
      }
    }
  });
});

describe("sidebar structure (Step 1 redesign)", () => {
  const EXPECTED: Record<string, string[]> = {
    Dashboard: ["/dashboard", "/my-work", "/notifications", "/approvals", "/analytics", "/reports"],
    "Website Management": [
      "/website/templates", "/website/template-parts", "/website/navigation-menus", "/website/homepage", "/website/site-identity", "/website/global-styles", "/website/site-editor",
      "/cms/pages", "/cms/posts", "/cms/case-studies", "/cms/taxonomy", "/cms/authors", "/cms/media",
      "/seo/issues", "/seo/redirects",
    ],
    CRM: ["/crm", "/crm/leads", "/crm/clients", "/crm/contacts", "/crm/opportunities", "/onboarding", "/onboarding/pending", "/marketing/forms"],
    "Social Media": ["/social", "/social/calendar", "/social/posts", "/social/compose", "/social/inbox", "/social/listening", "/social/reviews", "/social/queue", "/social/failures", "/social/analytics", "/social/audience", "/social/brand-voice", "/social/accounts"],
    Marketing: ["/marketing", "/marketing/campaigns", "/marketing/landing-pages"],
    Catalog: ["/products", "/products/modules", "/services", "/solutions", "/products/taxonomy"],
    Commercial: ["/commercial/contracts", "/commercial/subscriptions", "/commercial/invoices", "/commercial/payments"],
    "Automation & AI": ["/automation", "/ai", "/ai/providers", "/ai/tools", "/ai/prompts", "/ai/workflows", "/ai/executions", "/ai/usage", "/ai/approvals", "/ai/copilot"],
    Administration: ["/users", "/roles", "/permissions", "/organizations", "/workspaces", "/workspaces/members", "/security-center", "/system-health", "/scheduled-reports", "/meta-review", "/backups", "/privacy", "/audit-log", "/security", "/administration", "/integrations", "/settings"],
    "Client Portal": ["/portal"],
  };

  it("places every page in the specified section, in the specified order", async () => {
    const { NAV_SECTIONS, NAV_ORDER } = await import("./permissions");
    expect(NAV_SECTIONS).toEqual(Object.keys(EXPECTED));
    for (const [section, paths] of Object.entries(EXPECTED)) {
      const ordered = NAV_ITEMS.filter((i) => i.section === section).sort((a, b) => NAV_ORDER.indexOf(a.id) - NAV_ORDER.indexOf(b.id));
      expect(ordered.map((i) => i.path)).toEqual(paths);
    }
  });

  it("keeps every one of the 62 existing pages plus the new /social and /approvals pages, with unique ids and paths", () => {
    const all = Object.values(EXPECTED).flat();
    expect(all).toHaveLength(82);
    expect(NAV_ITEMS).toHaveLength(82);
    expect(new Set(NAV_ITEMS.map((i) => i.path)).size).toBe(82);
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(82);
    expect(NAV_ITEMS.map((i) => i.path).sort()).toEqual([...all].sort());
  });

  it("subheadings: Website Management and Administration only", async () => {
    const { NAV_ORDER } = await import("./permissions");
    const byOrder = (a: { id: string }, b: { id: string }) => NAV_ORDER.indexOf(a.id) - NAV_ORDER.indexOf(b.id);
    const grouped = NAV_ITEMS.filter((i) => i.group);
    expect(new Set(grouped.map((i) => i.section))).toEqual(new Set(["Website Management", "Administration"]));
    expect([...new Set(NAV_ITEMS.filter((i) => i.section === "Website Management").sort(byOrder).map((i) => i.group))]).toEqual(["Design", "Content", "SEO"]);
    expect([...new Set(NAV_ITEMS.filter((i) => i.section === "Administration").sort(byOrder).map((i) => i.group))]).toEqual(["People & access", "Security", "Operations", "Platform"]);
  });

  it("gates /social behind social.read", () => {
    expect(visibleNavItems([]).map((i) => i.path)).not.toContain("/social");
    expect(visibleNavItems(["social.read"]).map((i) => i.path)).toContain("/social");
  });
});
