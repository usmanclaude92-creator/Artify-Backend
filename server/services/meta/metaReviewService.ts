/**
 * Meta App Review demo workspace (Step 15). A separate, isolated organization with clearly fictional sample data and one reviewer login, so Meta's reviewers
 * can open Control Center without ever seeing real customer data. The reviewer connects THEIR OWN Meta test Page/Instagram account to exercise the live
 * permissions; the sample inbox and posts only illustrate the screens. SUPER_ADMIN seeds and removes it; removal deletes the organization and everything in it.
 * The reviewer password is generated once, shown once and stored only as a hash.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../../db/prisma";
import { ConflictError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { hashPassword } from "../../utils/password";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

export const REVIEW_ORG_SLUG = "meta-review-demo";
export const REVIEWER_EMAIL = "meta-reviewer@artifysols.com";

const SAMPLE = {
  accounts: [
    { provider: "meta_facebook", externalAccountId: "demo-facebook-page", displayName: "Sample Page (demo data)", handle: null },
    { provider: "meta_instagram", externalAccountId: "demo-instagram-account", displayName: "Sample Instagram (demo data)", handle: "sample_demo" },
  ],
  conversations: [
    { acct: 0, type: "DM" as const, thread: "dm:demo-1", name: "Sample Customer A", intent: "question", sentiment: "neutral", msgs: ["Hi, are you open on Saturdays?", "Sample reply: Yes, 9 to 2 on Saturdays."] },
    { acct: 0, type: "COMMENT" as const, thread: "c:demo-2", name: "Sample Customer B", intent: "praise", sentiment: "positive", msgs: ["Loved the new menu, thank you!"] },
    { acct: 1, type: "MENTION" as const, thread: "p:demo-3", name: "Sample Customer C", intent: "mention", sentiment: "positive", msgs: ["Great evening at @sample_demo with friends"] },
    { acct: 1, type: "DM" as const, thread: "dm:demo-4", name: "Sample Customer D", intent: "complaint", sentiment: "negative", msgs: ["My order arrived late, who can help?"] },
  ],
  posts: [
    { title: "Sample post: weekend opening hours", body: "Sample content for review only: we are open 9 to 2 this Saturday.", status: "DRAFT" as const },
    { title: "Sample post: new menu announcement", body: "Sample content for review only: our new menu starts Monday.", status: "PENDING_APPROVAL" as const },
  ],
};

async function findOrg() { return prisma.organization.findUnique({ where: { slug: REVIEW_ORG_SLUG } }); }

export const metaReviewService = {
  async status() {
    const org = await findOrg();
    if (!org) return { seeded: false as const };
    const [accounts, conversations, posts, users] = await Promise.all([
      prisma.socialAccount.count({ where: { organizationId: org.id } }), prisma.socialConversation.count({ where: { organizationId: org.id } }),
      prisma.socialPost.count({ where: { organizationId: org.id } }), prisma.user.count({ where: { organizationId: org.id } }),
    ]);
    return { seeded: true as const, organizationId: org.id, reviewerEmail: REVIEWER_EMAIL, counts: { accounts, conversations, posts, users }, createdAt: org.createdAt.toISOString() };
  },

  /** Creates the demo workspace once. Returns the one-time reviewer password; calling it again never reveals or resets anything. */
  async seed(actor: SanitizedUser, meta: RequestMeta = {}) {
    if (await findOrg()) throw new ConflictError("The Meta review demo workspace already exists. Remove it first to recreate it with a new password.");
    if (await prisma.user.findUnique({ where: { email: REVIEWER_EMAIL } })) throw new ConflictError(`A user with ${REVIEWER_EMAIL} already exists.`);
    const password = randomBytes(15).toString("base64url");
    const passwordHash = await hashPassword(password);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    const org = await prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({ data: { name: "Meta Review Demo", slug: REVIEW_ORG_SLUG, type: "CLIENT", status: "ACTIVE" } });
      const u = await tx.user.create({ data: { organizationId: o.id, email: REVIEWER_EMAIL, passwordHash, firstName: "Meta", lastName: "Reviewer", roleId: role.id, emailVerifiedAt: new Date() } });
      await tx.organizationMembership.create({ data: { userId: u.id, organizationId: o.id, roleId: role.id } });
      const accounts = [];
      for (const a of SAMPLE.accounts) accounts.push(await tx.socialAccount.create({ data: { organizationId: o.id, ...a, status: "DISCONNECTED", lastError: "Sample account for the Meta App Review demo. Connect your own test account to try live actions." } }));
      for (const c of SAMPLE.conversations) {
        const conv = await tx.socialConversation.create({ data: { organizationId: o.id, socialAccountId: accounts[c.acct]!.id, providerThreadId: c.thread, type: c.type, participantExternalId: `demo-${c.thread}`, participantName: c.name, intent: c.intent, sentiment: c.sentiment, isRead: false } });
        for (const [i, body] of c.msgs.entries()) {
          await tx.socialMessage.create({ data: { conversationId: conv.id, organizationId: o.id, socialAccountId: accounts[c.acct]!.id, direction: i === 0 ? "INBOUND" : "OUTBOUND", authorKind: i === 0 ? "CUSTOMER" : "PAGE", body, providerMessageId: `demo-${c.thread}-${i}`, sendStatus: i === 0 ? "RECEIVED" : "SENT" } });
        }
      }
      for (const p of SAMPLE.posts) {
        const post = await tx.socialPost.create({ data: { organizationId: o.id, title: p.title, body: p.body, status: p.status, createdById: u.id } });
        await tx.socialPostTarget.create({ data: { postId: post.id, socialAccountId: accounts[0]!.id } });
      }
      return o;
    });
    await auditLogRepository.record({ organizationId: actor.organizationId, actorUserId: actor.id, actorType: "USER", action: "META_REVIEW_DEMO_SEEDED", resourceType: "organization", resourceId: org.id, ipAddress: meta.ip, userAgent: meta.userAgent });
    return { organizationId: org.id, reviewerEmail: REVIEWER_EMAIL, reviewerPassword: password, note: "Shown once. Give it to Meta only in the App Review submission form." };
  },

  /** Deletes the demo organization, its reviewer user and everything the reviewer created in it. */
  async remove(actor: SanitizedUser, meta: RequestMeta = {}) {
    const org = await findOrg();
    if (!org) throw new ConflictError("The Meta review demo workspace does not exist.");
    await prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { organizationId: org.id } });
      await tx.user.deleteMany({ where: { organizationId: org.id } }); // sessions + memberships cascade; users are RESTRICT on the organization
      await tx.organization.delete({ where: { id: org.id } }); // social accounts, conversations, posts… cascade
    });
    await auditLogRepository.record({ organizationId: actor.organizationId, actorUserId: actor.id, actorType: "USER", action: "META_REVIEW_DEMO_REMOVED", resourceType: "organization", resourceId: org.id, ipAddress: meta.ip, userAgent: meta.userAgent });
    return { removed: true };
  },
};
