/**
 * Pure helpers for Meta's insights responses (Facebook Pages + Instagram). No network here, so every shape is unit-tested with hand-written fixtures
 * (tests/fixtures/insights/). Principle: a value we cannot read is NULL with a reason, never 0.
 * Sources and the [ ] items still to verify live: docs/SOCIAL_ANALYTICS.md §1.
 */
import { SocialPublishError } from "../publishing/publishErrors";
import type { AudienceBucket, DailyPoint } from "./types";

const DAY_MS = 86_400_000;

export const dayString = (d: Date): string => d.toISOString().slice(0, 10);
export const startOfUtcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
export const unixSeconds = (d: Date): number => Math.floor(d.getTime() / 1000);
/** Parses "YYYY-MM-DD" as a UTC day. */
export const parseDay = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/**
 * Meta's daily values carry an `end_time` that closes the day's window (typically 07:00/08:00 UTC, i.e. midnight Pacific, or 00:00 UTC).
 * The value describes the 24 hours BEFORE it, so the day it belongs to is the UTC date of (end_time − 24 h). [ ] confirm against the dashboard live.
 */
export function endTimeToDay(endTime: string): string | null {
  const t = Date.parse(endTime);
  return Number.isFinite(t) ? dayString(new Date(t - DAY_MS)) : null;
}

/** Splits [from, to] (UTC days, inclusive) into chunks of at most `maxDays` days. */
export function chunkRange(from: Date, to: Date, maxDays: number): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  let cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  while (cursor.getTime() <= end.getTime()) {
    const chunkEnd = new Date(Math.min(addDays(cursor, maxDays - 1).getTime(), end.getTime()));
    out.push({ from: cursor, to: chunkEnd });
    cursor = addDays(chunkEnd, 1);
  }
  return out;
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `data[0].values[]` → one point per returned day. A non-numeric value (breakdown object, missing) is null, never 0. Empty `data` → null (no series). */
export function parseSeries(json: unknown): DailyPoint[] | null {
  const data = asObj(json)?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const values = asObj(data[0])?.values;
  if (!Array.isArray(values)) return null;
  const byDay = new Map<string, number | null>();
  for (const v of values) {
    const o = asObj(v);
    const day = typeof o?.end_time === "string" ? endTimeToDay(o.end_time) : null;
    if (!day) continue;
    byDay.set(day, num(o?.value));
  }
  return [...byDay.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

/** `data[0].total_value.value` (the `metric_type=total_value` shape). */
export function parseTotalValue(json: unknown): number | null {
  const data = asObj(json)?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  return num(asObj(asObj(data[0])?.total_value)?.value);
}

/** A lifetime/single value from either shape: `values[0].value` or `total_value.value`. */
export function parseSingleValue(json: unknown): number | null {
  const data = asObj(json)?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = asObj(data[0]);
  const values = first?.values;
  if (Array.isArray(values) && values.length > 0) {
    const v = num(asObj(values[0])?.value);
    if (v !== null) return v;
  }
  return num(asObj(first?.total_value)?.value);
}

/** New demographics shape: `total_value.breakdowns[0].results[] = { dimension_values: [...], value }`. */
export function parseBreakdown(json: unknown): AudienceBucket[] | null {
  const data = asObj(json)?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const breakdowns = asObj(asObj(data[0])?.total_value)?.breakdowns;
  if (!Array.isArray(breakdowns) || breakdowns.length === 0) return null;
  const results = asObj(breakdowns[0])?.results;
  if (!Array.isArray(results)) return null;
  const out: AudienceBucket[] = [];
  for (const r of results) {
    const o = asObj(r);
    const dims = Array.isArray(o?.dimension_values) ? (o!.dimension_values as unknown[]).map(String) : [];
    const value = num(o?.value);
    if (dims.length && value !== null) out.push({ key: dims.join(" · "), value });
  }
  return out.length ? out.sort((a, b) => b.value - a.value) : null;
}

/** Legacy lifetime shape: `values[0].value = { "US": 12, "GB": 3 }` (audience_country, audience_city, audience_gender_age, audience_locale). */
export function parseLifetimeMap(json: unknown): AudienceBucket[] | null {
  const data = asObj(json)?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const values = asObj(data[0])?.values;
  const map = Array.isArray(values) && values.length ? asObj(asObj(values[0])?.value) : null;
  if (!map) return null;
  const out = Object.entries(map).flatMap(([key, v]) => (num(v) !== null ? [{ key, value: v as number }] : []));
  return out.length ? out.sort((a, b) => b.value - a.value) : null;
}

/** A safe, short note from a classified Graph failure (already redacted by errorFromGraph). */
export const noteFrom = (err: unknown, fallback = "Meta rejected the request."): string => (err instanceof SocialPublishError ? err.message : fallback).replace(/\s+/g, " ").slice(0, 240);

/** Permanent = the network answered "no" for THIS metric (invalid/deprecated/under threshold). Auth and transient failures are rethrown by callers. */
export const isMetricRefusal = (err: unknown): boolean => err instanceof SocialPublishError && err.kind === "permanent";

/** Auth-class failure on an insights call = the Insights permission is missing/revoked (or the token is bad, which the health job handles). */
export const isPermissionFailure = (err: unknown): boolean => err instanceof SocialPublishError && err.kind === "auth";
