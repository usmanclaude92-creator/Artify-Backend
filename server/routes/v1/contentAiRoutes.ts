/** AI writer for the CMS editors. Returns text only; the editor saves it through the normal post/product endpoints. */
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { aiExecutionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { contentAiService, TONES } from "../../services/contentAiService";

const router = Router();
router.use(authenticateToken);

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId });
const brief = z.string().trim().min(10, "Describe what to write in at least a sentence.").max(4000);
const postSchema = z.object({ brief, tone: z.enum(TONES).optional(), length: z.enum(["short", "medium", "long"]).optional(), language: z.string().trim().max(40).optional(), currentTitle: z.string().trim().max(200).optional() });
const productSchema = z.object({ brief, name: z.string().trim().max(200).optional(), itemType: z.enum(["PRODUCT", "SERVICE", "SOLUTION"]).optional(), tone: z.enum(TONES).optional(), language: z.string().trim().max(40).optional() });

router.post("/post", requirePermission("content.create"), aiExecutionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await contentAiService.writePost(req.user!, postSchema.parse(req.body), meta(req)));
}));
router.post("/product", requirePermission("products.create"), aiExecutionLimiter, asyncHandler(async (req, res) => {
  sendSuccess(res, await contentAiService.writeProduct(req.user!, productSchema.parse(req.body), meta(req)));
}));

export default router;
