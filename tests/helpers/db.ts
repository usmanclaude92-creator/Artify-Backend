/**
 * Test-only database reset helper. Only ever points at a database/schema
 * whose connection string is distinctly marked as test data (tests/setup.ts
 * loads .env.test before this or any server/ module is imported — see that
 * file for which distinguishing marker is currently in use: a separate
 * `artify_test` database name for local Postgres, or a `?schema=test`
 * query param when pointed at a shared hosted instance). Dev data must
 * never share the exact same marker.
 *
 * Wipes tenant/transactional data only (organizations and everything that
 * hangs off them) — NOT roles/permissions/role_permissions, which are
 * reference/configuration data seeded once by tests/setup.ts
 * (seedRolesAndPermissions), matching how a real deployment treats its
 * role/permission catalog as stable configuration, not per-test fixture
 * data. If a test creates its own extra reference-data rows (e.g. a new
 * Permission to prove role_permissions is data-driven), that test is
 * responsible for cleaning up after itself — resetDb() intentionally does
 * not touch the permissions/roles tables at all.
 */
import { prisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";
import { testStorageProvider } from "../../server/storage/testStorageProvider";

function assertTestDatabase(): void {
  if (config.nodeEnv !== "test" || !config.databaseUrl.includes("test")) {
    throw new Error(
      "Refusing to reset a database that doesn't look like the dedicated test DB. " +
        "Expected NODE_ENV=test and a DATABASE_URL containing 'test' (see .env.test)."
    );
  }
}

export async function resetDb(): Promise<void> {
  assertTestDatabase();

  // The in-memory test storage provider (Phase 9) is a module-singleton —
  // wipe it alongside the database so uploaded-object state never leaks
  // between tests the way stale rows would.
  testStorageProvider.reset();

  // Break the pages/posts <-> content_revisions cycle (Page.currentRevisionId
  // and Post.currentRevisionId each point INTO content_revisions, which in
  // turn points back via pageId/postId) before deleting either side.
  await prisma.page.updateMany({ data: { currentRevisionId: null } });
  await prisma.post.updateMany({ data: { currentRevisionId: null } });
  // Phase 11 — same currentRevisionId <-> content_revisions cycle for CaseStudy.
  await prisma.caseStudy.updateMany({ data: { currentRevisionId: null } });
  // Phase 1 (Website module) — same currentRevisionId <-> revisions cycle
  // as pages/posts above, broken the same way before either side is deleted.
  await prisma.template.updateMany({ data: { currentRevisionId: null } });
  await prisma.templatePart.updateMany({ data: { currentRevisionId: null } });
  // Phase 5 — same currentRevisionId <-> revisions cycle for NavigationMenu,
  // plus Page's own new self-reference (parentId -> pages.id), both broken
  // the same way before either side is deleted.
  await prisma.navigationMenu.updateMany({ data: { currentRevisionId: null } });
  await prisma.page.updateMany({ data: { parentId: null } });

  // Delete in FK-dependency order, leaves first. organization_memberships
  // and sessions cascade automatically when their user/organization is
  // deleted (schema-level ON DELETE CASCADE), but are listed explicitly
  // for clarity and to avoid relying on delete order across unrelated
  // cascade paths.
  // payments RESTRICTs on both invoice_id and organization_id — must go
  // before invoices and before the organization cascade below (Phase 10).
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.subscriptionItem.deleteMany();
  await prisma.subscription.deleteMany();
  // products/product_modules are platform-global (no organizationId) — not
  // covered by the organization cascade below, so wiped explicitly. Must
  // come after subscription/subscriptionItem (RESTRICT/SetNull on
  // productId/productModuleId respectively).
  // Phase 10 — product_relations/product_industries/product_revisions all
  // Cascade off Product itself, but are deleted explicitly first (same
  // "clarity over relying on cascade order" rationale as elsewhere in this
  // file) since product_categories/industries below must outlive Product's
  // own delete (categoryId is SetNull, not Cascade) to be wiped cleanly.
  await prisma.productRelation.deleteMany();
  await prisma.productIndustry.deleteMany();
  await prisma.productRevision.deleteMany();
  await prisma.productModule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productCategory.deleteMany();
  await prisma.industry.deleteMany();
  // ai_providers is platform-global (no organizationId), same as products
  // above — wiped explicitly. Cascades to ai_models (onDelete: Cascade) and
  // nulls out any ai_executions/ai_usage_records provider/model references
  // (onDelete: SetNull) automatically. ai_tools is NOT wiped here — it is
  // reference/configuration data seeded once by tests/setup.ts
  // (seedAiTools), same treatment as roles/permissions above.
  await prisma.aIProvider.deleteMany();
  // contract_variations CASCADEs on contract_id, but delete explicitly for
  // clarity (same rationale as the workspace_invitation comment above).
  await prisma.contractVariation.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.contact.deleteMany();
  // opportunities RESTRICTs on client_id — must go before clients below.
  await prisma.opportunity.deleteMany();
  // form_submissions CASCADEs on form_id and RESTRICTs on organization_id
  // (SetNull on lead_id, so order relative to leads below doesn't matter) —
  // delete explicitly for clarity, same rationale as the workspace_invitation
  // comment above.
  await prisma.formSubmission.deleteMany();
  await prisma.form.deleteMany();
  // client_onboarding RESTRICTs on both client_id and organization_id —
  // must go before both clients and organizations are deleted below.
  await prisma.clientOnboarding.deleteMany();
  // workspace_invitations CASCADEs on organization_id, but delete
  // explicitly for clarity rather than relying on the later organization
  // cascade (same rationale as the comment above this function).
  await prisma.workspaceInvitation.deleteMany();
  await prisma.client.deleteMany();
  await prisma.lead.deleteMany();

  // Phase 11 — case_study_products/case_study_related_pages/case_study_related_posts
  // all Cascade off CaseStudy/Product/Page/Post, but delete explicitly for
  // clarity before any of those four are deleted (same rationale as the
  // workspace_invitation comment above).
  await prisma.caseStudyProduct.deleteMany();
  await prisma.caseStudyRelatedPage.deleteMany();
  await prisma.caseStudyRelatedPost.deleteMany();
  await prisma.caseStudy.deleteMany();

  await prisma.contentRevision.deleteMany();
  await prisma.postTag.deleteMany();
  await prisma.post.deleteMany();
  await prisma.page.deleteMany();
  // Phase 1 (Website module) — templates.organization_id RESTRICTs (same
  // convention as pages/posts above), so must go before the organization
  // cascade below. Page.templateId is already null (page.deleteMany()
  // above removes the rows entirely), so order relative to page is moot,
  // but listed right after it for locality with the rest of this section.
  await prisma.templateRevision.deleteMany();
  await prisma.template.deleteMany();
  await prisma.templatePartRevision.deleteMany();
  await prisma.templatePart.deleteMany();
  // Phase 5 — navigation_menus.organization_id RESTRICTs, same convention
  // as templates/template_parts above.
  await prisma.navigationMenuRevision.deleteMany();
  await prisma.navigationMenu.deleteMany();
  await prisma.category.deleteMany();
  await prisma.tag.deleteMany();
  // redirects CASCADEs on organization_id, but delete explicitly for
  // clarity (same rationale as the workspace_invitation comment above).
  await prisma.redirect.deleteMany();

  // media_upload_sessions CASCADEs on media_id and organization_id, but
  // delete explicitly before media_assets for clarity (same rationale as
  // the workspace_invitation comment above).
  await prisma.mediaUploadSession.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.systemSetting.deleteMany();

  // ai_approval_requests.requested_by RESTRICTs on user_id — must go before
  // the user deleteMany below (every other AI table's user FKs are SetNull
  // or cascade from organization, so only this one is order-sensitive).
  await prisma.aIApprovalRequest.deleteMany();

  // Phase 13/14/15 (imported from the Google AI Studio lineage) — unlike
  // the Phase 12 AI tables above, every one of these RESTRICTs on
  // organization_id (their own convention, preserved as imported) rather
  // than cascading, so each must be deleted explicitly before
  // organization.deleteMany() below. Listed leaves-first; several of these
  // cascade their own children automatically (workflow -> versions,
  // execution -> step executions, document -> versions/chunks/embeddings/
  // ingestion jobs, workspace -> conversations -> messages/action
  // previews), so deleting them here first makes the later deletes no-ops
  // rather than duplicating cleanup logic.
  await prisma.automationActionExecution.deleteMany();
  await prisma.automationNotification.deleteMany();
  await prisma.automationTask.deleteMany();
  await prisma.automationApproval.deleteMany();
  await prisma.automationEvent.deleteMany();
  await prisma.automationSchedule.deleteMany();
  await prisma.automationExecution.deleteMany();
  await prisma.automationWorkflow.deleteMany();

  await prisma.knowledgeSearchLog.deleteMany();
  await prisma.knowledgeIngestionJob.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.knowledgeSource.deleteMany();
  await prisma.knowledgeCollection.deleteMany();

  await prisma.copilotUsage.deleteMany();
  await prisma.copilotActionPreview.deleteMany();
  await prisma.copilotConversation.deleteMany();
  await prisma.copilotWorkspace.deleteMany();

  await prisma.webhookEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organizationMembership.deleteMany();
  await prisma.author.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}
