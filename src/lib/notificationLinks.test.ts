import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { notificationLink, notificationPath } from "./notificationLinks";
import { NAV_ITEMS } from "./permissions";

const ALL = Array.from(new Set(NAV_ITEMS.flatMap((i) => i.requiresAnyPermission ?? [])));

describe("notificationLink", () => {
  it.each([
    [{ type: "post_comment_pending", entityType: "post_comment" }, "/cms/comments"],
    [{ type: "approval_requested", entityType: "automation_approval" }, "/approvals"],
    [{ type: "approval_completed", entityType: "privacy_request" }, "/privacy"],
    [{ type: "approval_requested", entityType: "social_post" }, "/social/posts"],
    [{ type: "task_assigned", entityType: "automation_task" }, "/my-work"],
    [{ type: "workflow_failed", entityType: "automation_execution" }, "/automation"],
    [{ type: "lead_assigned", entityType: "lead" }, "/crm/leads"],
    [{ type: "opportunity_won", entityType: "opportunity" }, "/crm/opportunities"],
    [{ type: "onboarding_started", entityType: "client" }, "/onboarding"],
    [{ type: "FORM_SUBMITTED", entityType: null }, "/marketing/forms"],
    [{ type: "PORTAL_REGISTRATION", entityType: "organization" }, "/organizations"],
    [{ type: "system_health_alert", entityType: "system_health" }, "/system-health"],
    [{ type: "dashboard_report", entityType: "dashboard_report_delivery" }, "/scheduled-reports"],
    [{ type: "social_inbox_attention", entityType: "social_conversation" }, "/social/inbox"],
    [{ type: "social_publish_failed", entityType: "social_post" }, "/social/posts"],
    [{ type: "social_account_attention", entityType: "social_account" }, "/social/accounts"],
    [{ type: "SYSTEM_ALERT", entityType: null }, "/system-health"],
    [{ type: "WORKFLOW_UPDATE", entityType: null }, "/automation"],
    [{ type: "content_published", title: "Your case study was published" }, "/cms/case-studies"],
    [{ type: "content_published", title: "Your page was published" }, "/cms/pages"],
    [{ type: "content_published", title: "Your post was published" }, "/cms/posts"],
  ])("%j opens %s", (n, expected) => {
    expect(notificationPath(n)).toBe(expected);
    expect(notificationLink(n, ALL)?.path).toBe(expected);
  });

  it("gives no link for an unknown notification", () => {
    expect(notificationLink({ type: "something_new", entityType: null }, ALL)).toBeNull();
    expect(notificationLink({ type: "something_new", entityType: "unknown_thing" }, ALL)).toBeNull();
  });

  it("gives no link when the person cannot open the page", () => {
    expect(notificationLink({ type: "post_comment_pending", entityType: "post_comment" }, [])).toBeNull();
    expect(notificationLink({ type: "post_comment_pending", entityType: "post_comment" }, ["content.read"])?.path).toBe("/cms/comments");
  });

  it("only points at pages that exist in the sidebar", () => {
    const known = new Set(NAV_ITEMS.map((i) => i.path));
    for (const p of ["/cms/comments", "/approvals", "/my-work", "/automation", "/crm/leads", "/crm/clients", "/crm/opportunities", "/onboarding", "/marketing/forms", "/marketing/campaigns", "/marketing/landing-pages", "/cms/pages", "/cms/posts", "/cms/case-studies", "/commercial/invoices", "/commercial/payments", "/social/inbox", "/social/posts", "/social/accounts", "/privacy", "/system-health", "/scheduled-reports", "/organizations", "/users", "/products"]) {
      expect(known.has(p), p).toBe(true);
    }
  });
});

/** Every notification the backend can create must have a destination, so a new notification type cannot silently ship without a link. */
describe("backend notification coverage", () => {
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
  }
  const files = walk(path.resolve(process.cwd(), "server")).filter((f) => !f.endsWith("notificationService.ts"));
  const calls: Array<{ file: string; type: string[]; entity: string[]; title: string[] }> = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/notificationService\.notify\(\{([\s\S]*?)\}\)/g)) {
      const body = m[1]!;
      const lit = (key: string) => {
        const expr = body.match(new RegExp(`${key}:\\s*([^\\n]*?)(?:,\\s*(?:title|message|entityType|entityId|organizationId|userId|type)\\b|,?\\s*$)`, "m"))?.[1] ?? "";
        return Array.from(expr.matchAll(/(===\s*)?"([^"]*)"/g)).filter((x) => !x[1] && x[2]).map((x) => x[2]!); // skip literals that are only compared against
      };
      calls.push({ file: path.relative(process.cwd(), file), type: lit("type"), entity: lit("entityType"), title: lit("title") });
    }
  }

  it("finds the backend notification call sites", () => {
    expect(calls.length).toBeGreaterThan(15);
  });

  it("every literal type or entity the backend creates opens a page", () => {
    const missing: string[] = [];
    for (const c of calls) {
      const types = c.type.length ? c.type : [""];
      const entities = c.entity.length ? c.entity : [null];
      for (const type of types) for (const entityType of entities) {
        if (!type) continue;
        if (!notificationPath({ type, entityType, title: c.title[0] })) missing.push(`${c.file}: type=${type} entity=${entityType}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("covers the types created through variables", () => {
    for (const type of ["social_inbox_attention", "social_inbox_overdue", "approval_rejected", "approval_completed", "workflow_completed", "task_due_soon", "task_overdue", "task_commented", "onboarding_step_completed", "opportunity_lost"]) {
      expect(notificationPath({ type, entityType: null }), type).not.toBeNull();
    }
  });
});
