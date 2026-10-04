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

// Phase 9 (Forms + Landing Pages + Conversion) — "export where the
// existing architecture supports it": the data layer already fully
// supports this (formRepository.listSubmissions), so this is a second
// serialization of the same real rows, not a new export subsystem. Every
// row is a genuine submission; nothing here is generated/sampled.
router.get(
  "/:id/submissions/export",
  requirePermission("forms.read"),
  asyncHandler(async (req, res) => {
    const form = await formService.getForm(req.user!.organizationId, req.params.id!);
    const { rows } = await formService.listSubmissions(req.user!.organizationId, req.params.id!, 1, 10000);
    const fieldKeys = (form.fields as unknown as { key: string }[]).map((f) => f.key);
    const header = ["submittedAt", ...fieldKeys, "utmSource", "utmMedium", "utmCampaign", "utmTerm", "utmContent", "landingPagePath", "referrer", "consentGiven", "leadId"];
    // Every cell below but the date/leadId is attacker-controllable (form
    // field values, UTM params, referrer). A value starting with
    // =/+/-/@ is a classic CSV-formula-injection payload in spreadsheet
    // apps that open this file — prefixing it with a plain quote keeps it
    // inert text without changing what a human reading the cell sees.
    const escapeCsv = (v: unknown) => {
      let s = String(v ?? "");
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [header.map(escapeCsv).join(",")];
    for (const row of rows) {
      const data = row.data as Record<string, string | string[]>;
      const cells = [
        row.createdAt.toISOString(),
        ...fieldKeys.map((k) => (Array.isArray(data[k]) ? (data[k] as string[]).join("; ") : data[k] ?? "")),
        row.utmSource,
        row.utmMedium,
        row.utmCampaign,
        row.utmTerm,
        row.utmContent,
        row.landingPagePath,
        row.referrer,
        row.consentGiven === null || row.consentGiven === undefined ? "" : String(row.consentGiven),
        row.leadId,
      ];
      lines.push(cells.map(escapeCsv).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${form.slug}-submissions.csv"`);
    res.send(lines.join("\n"));
  })
);

export default router;
