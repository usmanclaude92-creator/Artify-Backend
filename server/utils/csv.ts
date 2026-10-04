/**
 * Shared CSV export helper (Phase 15 — docs/ANALYTICS_ARCHITECTURE.md §9).
 * Extracts the exact escaping/header convention formRoutes.ts's submissions
 * export already established as a reusable util for Phase 15's reports —
 * formRoutes.ts itself is left untouched (no refactor of a working system).
 */
import type { Response } from "express";

/** A value starting with =/+/-/@ is a classic CSV-formula-injection payload in spreadsheet apps that open this file — prefixing it with a plain quote keeps it inert text without changing what a human reading the cell sees. */
export function escapeCsvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(","));
  return lines.join("\n");
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}
