/**
 * Reports area (Phase 15 §9 — docs/ANALYTICS_ARCHITECTURE.md). Reuses the
 * `reports.read`/`reports.export` RBAC keys seeded since early phases
 * (never wired to a real route until now) rather than inventing new ones.
 * Each of the 9 named report types is a real aggregation from
 * analyticsReportingService — never a fabricated figure — and each
 * section within a report is `null` when the caller lacks the underlying
 * domain permission (same convention as /analytics/overview).
 */
import { Router } from "express";
import { analyticsReportingService } from "../../services/analyticsReportingService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { sendCsv, toCsv } from "../../utils/csv";
import { reportQuerySchema, REPORT_TYPES, type ReportType } from "../../schemas/analyticsSchemas";
import { NotFoundError } from "../../core/errors";

const router = Router();

router.use(authenticateToken);

function assertReportType(value: string): ReportType {
  if ((REPORT_TYPES as readonly string[]).includes(value)) return value as ReportType;
  throw new NotFoundError("Unknown report type.");
}

/**
 * Flattens an arbitrary report payload into CSV rows — a generic
 * key/value projection, since each of the 9 report types has its own
 * shape (reuses the existing data layer rather than building a dedicated
 * report-builder, per the brief's "do not build an unnecessarily complex
 * report-builder" guidance).
 */
function reportToCsvRows(data: unknown): { header: string[]; rows: unknown[][] } {
  if (Array.isArray(data)) {
    if (data.length === 0) return { header: ["(no data)"], rows: [] };
    const first = data[0];
    if (first && typeof first === "object") {
      const header = Object.keys(first as Record<string, unknown>);
      return { header, rows: data.map((row) => header.map((k) => (row as Record<string, unknown>)[k])) };
    }
    return { header: ["value"], rows: data.map((v) => [v]) };
  }
  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    return { header: ["field", "value"], rows: entries.map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v]) };
  }
  return { header: ["value"], rows: [[data]] };
}

router.get(
  "/:type",
  requirePermission("reports.read"),
  asyncHandler(async (req, res) => {
    const type = assertReportType(req.params.type!);
    const query = reportQuerySchema.parse(req.query);
    const report = await analyticsReportingService.getReport(req.user!.organizationId, req.user!.role.permissions, type, query);
    sendSuccess(res, { type, range: { from: query.from ?? null, to: query.to ?? null }, report });
  })
);

router.get(
  "/:type/export",
  requirePermission("reports.export"),
  asyncHandler(async (req, res) => {
    const type = assertReportType(req.params.type!);
    const query = reportQuerySchema.parse(req.query);
    const report = await analyticsReportingService.getReport(req.user!.organizationId, req.user!.role.permissions, type, query);
    const { header, rows } = reportToCsvRows(report);
    sendCsv(res, `${type}.csv`, toCsv(header, rows));
  })
);

export default router;
