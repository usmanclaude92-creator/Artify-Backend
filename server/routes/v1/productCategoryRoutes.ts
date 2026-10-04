/** Phase 10 (Products + Services + Solutions) — platform-global catalog category taxonomy CRUD. */
import { Router } from "express";
import { productCategoryService } from "../../services/productCategoryService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createProductCategorySchema, listProductCategoriesQuerySchema, updateProductCategorySchema } from "../../schemas/productCategorySchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("product_categories.read"),
  asyncHandler(async (req, res) => {
    const query = listProductCategoriesQuerySchema.parse(req.query);
    const categories = await productCategoryService.list(query.search);
    sendSuccess(res, { categories });
  })
);

router.post(
  "/",
  requirePermission("product_categories.manage"),
  asyncHandler(async (req, res) => {
    const input = createProductCategorySchema.parse(req.body);
    const category = await productCategoryService.create(req.user!, input, requestMeta(req));
    sendSuccess(res, { category }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("product_categories.manage"),
  asyncHandler(async (req, res) => {
    const input = updateProductCategorySchema.parse(req.body);
    const category = await productCategoryService.update(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { category });
  })
);

router.delete(
  "/:id",
  requirePermission("product_categories.manage"),
  asyncHandler(async (req, res) => {
    await productCategoryService.delete(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Category deleted." });
  })
);

export default router;
