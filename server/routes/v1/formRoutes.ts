/** Form (marketing forms) CRUD + submissions listing (Phase 9 MVP slice — docs/FORMS_ARCHITECTURE.md). */
import { Router } from "express";
import { formService } from "../../services/formService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createFormSchema, updateFormSchema, listFormsQuerySchema, listFormSubmissionsQuerySchema } from "../../schemas/formSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("forms.read"),
  asyncHandler(async (req, res) => {
    const query = listFormsQuerySchema.parse(req.query);
    const { rows, total } = await formService.listForms(
      req.user!.organizationId,
      { search: query.search, status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { forms: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("forms.read"),
  asyncHandler(async (req, res) => {
    const form = await formService.getForm(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { form });
  })
);

router.post(
  "/",
  requirePermission("forms.create"),
  asyncHandler(async (req, res) => {
    const input = createFormSchema.parse(req.body);
    const form = await formService.createForm(req.user!, input, requestMeta(req));
    sendSuccess(res, { form }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("forms.update"),
  asyncHandler(async (req, res) => {
    const input = updateFormSchema.parse(req.body);
    const form = await formService.updateForm(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { form });
  })
);

router.delete(
  "/:id",
  requirePermission("forms.delete"),
  asyncHandler(async (req, res) => {
    await formService.deleteForm(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Form deleted." });
  })
);

router.get(
  "/:id/submissions",
  requirePermission("forms.read"),
  asyncHandler(async (req, res) => {
    const query = listFormSubmissionsQuerySchema.parse(req.query);
    const { rows, total } = await formService.listSubmissions(req.user!.organizationId, req.params.id!, query.page, query.limit);
    sendSuccess(res, { submissions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

export default router;
