/** Phase 10 (Products + Services + Solutions) — platform-global industry taxonomy CRUD. Mirrors productCategoryRoutes.ts exactly. */
import { Router } from "express";
import { industryService } from "../../services/industryService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createIndustrySchema, listIndustriesQuerySchema, updateIndustrySchema } from "../../schemas/industrySchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("industries.read"),
  asyncHandler(async (req, res) => {
    const query = listIndustriesQuerySchema.parse(req.query);
    const industries = await industryService.list(query.search);
    sendSuccess(res, { industries });
  })
);

router.post(
  "/",
  requirePermission("industries.manage"),
  asyncHandler(async (req, res) => {
    const input = createIndustrySchema.parse(req.body);
    const industry = await industryService.create(req.user!, input, requestMeta(req));
    sendSuccess(res, { industry }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("industries.manage"),
  asyncHandler(async (req, res) => {
    const input = updateIndustrySchema.parse(req.body);
    const industry = await industryService.update(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { industry });
  })
);

router.delete(
  "/:id",
  requirePermission("industries.manage"),
  asyncHandler(async (req, res) => {
    await industryService.delete(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Industry deleted." });
  })
);

export default router;
