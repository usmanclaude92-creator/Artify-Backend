/**
 * Public website API (Phase 11 — docs/PUBLIC_API_ARCHITECTURE.md).
 * Mounted at /api/v1/public. No `authenticateToken` anywhere in this file
 * — every route here is intentionally reachable by an anonymous browser.
 * That is exactly why it is also the most carefully bounded route file in
 * the codebase: every response is built from an explicit public-safe
 * projection (see publicSiteService.ts/publicProductService.ts), never the
 * raw repository row, and the one write endpoint (`POST /leads`) is both
 * schema-validated and rate-limited.
 */
import { Router } from "express";
import { publicSiteService } from "../../services/publicSiteService";
import { publicProductService } from "../../services/publicProductService";
import { publicLeadService } from "../../services/publicLeadService";
import { publicFormService } from "../../services/publicFormService";
import { publicLandingService } from "../../services/landing/publicLandingService";
import { publicLandingSubmitSchema } from "../../schemas/landingSchemas";
import { NotFoundError } from "../../core/errors";
import { analyticsEventService } from "../../services/analyticsEventService";
import { publicLeadLimiter, publicAnalyticsLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  createPublicLeadSchema,
  listPublicPostsQuerySchema,
  listPublicProductsQuerySchema,
  listPublicCaseStudiesQuerySchema,
  publicRedirectLookupQuerySchema,
  publicNavigationMenuTypeSchema,
} from "../../schemas/publicSchemas";
import { publicFormSubmitSchema } from "../../schemas/formSchemas";
import { publicAnalyticsEventSchema } from "../../schemas/analyticsSchemas";

const router = Router();

// Shared-cache the anonymous read endpoints (never the POST write endpoints).
// `Vary: Origin` is already set by the CORS middleware, so the edge cache keys
// per-origin and cannot serve one origin's CORS headers to another.
router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  }
  next();
});

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  const referrerHeader = req.headers["referer"];
  return {
    ip: req.ip,
    userAgent: req.headers["user-agent"] as string | undefined,
    referrer: typeof referrerHeader === "string" ? referrerHeader.slice(0, 2000) : undefined,
  };
}

router.get(
  "/site",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { configured: publicSiteService.isConfigured() });
  })
);

router.get(
  "/site-settings",
  asyncHandler(async (_req, res) => {
    const settings = await publicSiteService.getSiteSettings();
    sendSuccess(res, { settings });
  })
);

router.get(
  "/pages/:slug",
  asyncHandler(async (req, res) => {
    const page = await publicSiteService.getPageBySlug(req.params.slug!);
    sendSuccess(res, { page });
  })
);

router.get(
  "/homepage",
  asyncHandler(async (_req, res) => {
    const page = await publicSiteService.getHomepage();
    sendSuccess(res, { page });
  })
);

router.get(
  "/navigation-menus/:type",
  asyncHandler(async (req, res) => {
    const type = publicNavigationMenuTypeSchema.parse(req.params.type);
    const menu = await publicSiteService.getNavigationMenu(type);
    sendSuccess(res, { menu });
  })
);

router.get(
  "/posts",
  asyncHandler(async (req, res) => {
    const query = listPublicPostsQuerySchema.parse(req.query);
    const { rows, total } = await publicSiteService.listPosts(
      { search: query.search, categorySlug: query.category, tagSlug: query.tag },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { posts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/posts/:slug",
  asyncHandler(async (req, res) => {
    const post = await publicSiteService.getPostBySlug(req.params.slug!);
    sendSuccess(res, { post });
  })
);

// Phase 11 — Case Studies. Registered before "/case-studies/:slug" so the
// literal "/case-studies" list path is never swallowed by the param route.
router.get(
  "/case-studies",
  asyncHandler(async (req, res) => {
    const query = listPublicCaseStudiesQuerySchema.parse(req.query);
    const { rows, total } = await publicSiteService.listCaseStudies(
      { search: query.search, industrySlug: query.industrySlug, productSlug: query.productSlug },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { caseStudies: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/case-studies/:slug",
  asyncHandler(async (req, res) => {
    const caseStudy = await publicSiteService.getCaseStudyBySlug(req.params.slug!);
    sendSuccess(res, { caseStudy });
  })
);

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const categories = await publicSiteService.listCategories();
    sendSuccess(res, { categories });
  })
);

router.get(
  "/tags",
  asyncHandler(async (_req, res) => {
    const tags = await publicSiteService.listTags();
    sendSuccess(res, { tags });
  })
);

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const query = listPublicProductsQuerySchema.parse(req.query);
    const { rows, total } = await publicProductService.listProducts(
      { search: query.search, type: query.type, categorySlug: query.categorySlug, industrySlug: query.industrySlug },
      query.page,
      query.limit
    );
    sendSuccess(res, { products: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/product-categories",
  asyncHandler(async (_req, res) => {
    const categories = await publicProductService.listProductCategories();
    sendSuccess(res, { categories });
  })
);

router.get(
  "/industries",
  asyncHandler(async (_req, res) => {
    const industries = await publicProductService.listIndustries();
    sendSuccess(res, { industries });
  })
);

router.get(
  "/products/:slug",
  asyncHandler(async (req, res) => {
    const product = await publicProductService.getProductBySlug(req.params.slug!);
    sendSuccess(res, { product });
  })
);

router.get(
  "/products/:slug/modules",
  asyncHandler(async (req, res) => {
    const modules = await publicProductService.getProductModules(req.params.slug!);
    sendSuccess(res, { modules });
  })
);

router.get(
  "/redirects",
  asyncHandler(async (req, res) => {
    const query = publicRedirectLookupQuerySchema.parse(req.query);
    const redirect = await publicSiteService.getRedirectForPath(query.path);
    sendSuccess(res, { redirect });
  })
);

router.post(
  "/leads",
  publicLeadLimiter,
  asyncHandler(async (req, res) => {
    const input = createPublicLeadSchema.parse(req.body);
    await publicLeadService.createLead(input, requestMeta(req));
    // Always the same response whether the submission was real or
    // silently discarded as a honeypot hit (§8) — a bot must not be able
    // to distinguish the two from the response alone.
    sendSuccess(res, { message: "Thank you — your message has been received. We'll be in touch shortly." }, 201);
  })
);

// Phase 9 (full — Forms + Landing Pages + Conversion) — the public site's
// actual form renderer needs the field definitions to draw real inputs;
// the MVP slice only ever shipped the submit endpoint. Read-only, no rate
// limit (same class as every other public GET in this file), ACTIVE-only
// (an archived form 404s, same contract /submit already has).
router.get(
  "/forms/by-id/:id",
  asyncHandler(async (req, res) => {
    const form = await publicFormService.getFormForRender({ id: req.params.id! });
    sendSuccess(res, { form });
  })
);

router.get(
  "/forms/:slug",
  asyncHandler(async (req, res) => {
    const form = await publicFormService.getFormForRender({ slug: req.params.slug! });
    sendSuccess(res, { form });
  })
);

// Phase 9 (MVP slice, docs/FORMS_ARCHITECTURE.md) — same rate limiter as
// /leads: both are anonymous, IP-keyed write endpoints in the same abuse
// class, so they share one budget rather than each getting a near-duplicate.
router.post(
  "/forms/:slug/submit",
  publicLeadLimiter,
  asyncHandler(async (req, res) => {
    const input = publicFormSubmitSchema.parse(req.body);
    const { successMessage } = await publicFormService.submit(req.params.slug!, input, requestMeta(req));
    sendSuccess(res, { message: successMessage }, 201);
  })
);

// Step 12 — landing pages. Only LIVE revisions (or a valid preview token) are ever returned; 410 once a page was taken offline.
router.get("/landing", asyncHandler(async (_req, res) => {
  sendSuccess(res, { pages: await publicLandingService.listIndexable() });
}));
router.get("/landing-preview/:token", asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  sendSuccess(res, { page: await publicLandingService.getPreview(req.params.token!) });
}));
router.get("/landing/:slug", asyncHandler(async (req, res) => {
  const found = await publicLandingService.getBySlug(req.params.slug!);
  if (found.kind === "ok") { sendSuccess(res, { page: found.page }); return; }
  if (found.kind === "gone") { res.status(410).json({ success: false, error: { code: "GONE", message: "This landing page is no longer available." } }); return; }
  if (found.kind === "redirect") { sendSuccess(res, { redirect: { toPath: found.toPath } }); return; }
  throw new NotFoundError("Landing page not found.");
}));
router.post("/landing/:slug/submit", publicLeadLimiter, asyncHandler(async (req, res) => {
  const input = publicLandingSubmitSchema.parse(req.body);
  const out = await publicLandingService.submit(req.params.slug!, input, requestMeta(req));
  sendSuccess(res, out, 201);
}));

// Phase 15 (Analytics + Reporting, docs/ANALYTICS_ARCHITECTURE.md §3) — the
// public site's page-view/CTA beacon. Fire-and-forget from the caller's
// point of view: always 201/accepted, even when the platform has no
// configured public-website organization (recordPublicEvent no-ops rather
// than erroring a visitor's page load over an analytics beacon).
router.post(
  "/analytics/events",
  publicAnalyticsLimiter,
  asyncHandler(async (req, res) => {
    const input = publicAnalyticsEventSchema.parse(req.body);
    await analyticsEventService.recordPublicEvent({ ...input, referrer: input.referrer ?? requestMeta(req).referrer });
    sendSuccess(res, { recorded: true }, 201);
  })
);

export default router;
