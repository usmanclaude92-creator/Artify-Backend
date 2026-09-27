/** Redirect CRUD (Phase 5 — docs/SEO_ARCHITECTURE.md). */
import { Router } from "express";
import { redirectService } from "../../services/redirectService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createRedirectSchema, updateRedirectSchema, listRedirectsQuerySchema } from "../../schemas/redirectSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("seo.redirects.read"),
  asyncHandler(async (req, res) => {
    const query = listRedirectsQuerySchema.parse(req.query);
    const { rows, total } = await redirectService.listRedirects(
      req.user!.organizationId,
      { search: query.search },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { redirects: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("seo.redirects.read"),
  asyncHandler(async (req, res) => {
    const redirect = await redirectService.getRedirect(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { redirect });
  })
);

router.post(
  "/",
  requirePermission("seo.redirects.create"),
  asyncHandler(async (req, res) => {
    const input = createRedirectSchema.parse(req.body);
    const redirect = await redirectService.createRedirect(req.user!, input, requestMeta(req));
    sendSuccess(res, { redirect }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("seo.redirects.update"),
  asyncHandler(async (req, res) => {
    const input = updateRedirectSchema.parse(req.body);
    const redirect = await redirectService.updateRedirect(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { redirect });
  })
);

router.delete(
  "/:id",
  requirePermission("seo.redirects.delete"),
  asyncHandler(async (req, res) => {
    await redirectService.deleteRedirect(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Redirect deleted." });
  })
);

export default router;
