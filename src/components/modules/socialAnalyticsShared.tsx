/** Shared pieces for Social Analytics / Audience / Overview. Rule: a number we do not have is "—" with its reason, never 0 and never an empty chart. */
import React from "react";
import { TrendingDown, TrendingUp, Info } from "lucide-react";
import type { AnalyticsKpi, AnalyticsRange } from "../../lib/api";
import { Card, Input, Select } from "../ui/ui";

export const fmtNumber = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
export const fmtDay = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
/** Last N completed UTC days (ending yesterday). */
export function presetRange(days: number, now = new Date()): AnalyticsRange {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(today.getTime() - 86_400_000);
  return { from: dayStr(new Date(to.getTime() - (days - 1) * 86_400_000)), to: dayStr(to) };
}
export const defaultRange = (): AnalyticsRange => presetRange(28);

type Preset = "7" | "28" | "90" | "custom";
export const RangePicker: React.FC<{ value: AnalyticsRange; onChange: (r: AnalyticsRange) => void }> = ({ value, onChange }) => {
  const [preset, setPreset] = React.useState<Preset>("28");
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
        Period
        <Select value={preset} aria-label="Period" onChange={(e) => { const p = e.target.value as Preset; setPreset(p); if (p !== "custom") onChange(presetRange(Number(p))); }}>
          <option value="7">Last 7 days</option>
          <option value="28">Last 28 days</option>
          <option value="90">Last 90 days</option>
          <option value="custom">Custom…</option>
        </Select>
      </label>
      {preset === "custom" && (
        <>
          <label className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>From<Input type="date" aria-label="From date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} /></label>
          <label className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>To<Input type="date" aria-label="To date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} /></label>
        </>
      )}
    </div>
  );
};

/** "Not available yet" with the reason, instead of an empty chart. */
export const NotAvailable: React.FC<{ title?: string; reason: string }> = ({ title = "Not available yet", reason }) => (
  <div className="rounded-xl p-3 flex gap-2 items-start text-xs" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }} role="note">
    <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
    <span><strong style={{ color: "var(--text-primary)" }}>{title}.</strong> {reason}</span>
  </div>
);

export const KpiCard: React.FC<{ kpi: AnalyticsKpi; selected?: boolean; onSelect?: () => void }> = ({ kpi, selected, onSelect }) => {
  const partial = kpi.kind === "flow" && kpi.current !== null && kpi.daysWithData < kpi.daysInRange;
  const body = (
    <>
      <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>{kpi.label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <p className="text-2xl font-bold" style={{ color: kpi.current === null ? "var(--text-muted)" : "var(--text-primary)" }}>{fmtNumber(kpi.current)}</p>
        {kpi.changePct !== null && (
          <span className="text-[11px] font-semibold flex items-center gap-0.5" style={{ color: kpi.changePct >= 0 ? "var(--success)" : "var(--danger)" }} aria-label={`${kpi.changePct >= 0 ? "Up" : "Down"} ${Math.abs(kpi.changePct)} percent versus the previous period`}>
            {kpi.changePct >= 0 ? <TrendingUp className="w-3 h-3" aria-hidden="true" /> : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
            {Math.abs(kpi.changePct)}%
          </span>
        )}
      </div>
      {kpi.current === null ? (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{kpi.unavailableReason ?? "Not available yet."}</p>
      ) : (
        <>
          {kpi.kind === "level" && kpi.netChange && <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>{kpi.netChange.value >= 0 ? "+" : "−"}{fmtNumber(Math.abs(kpi.netChange.value))} since {fmtDay(kpi.netChange.fromDate)}</p>}
          {partial && <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{kpi.daysWithData} of {kpi.daysInRange} days have data</p>}
          {kpi.changePct === null && kpi.compareNote && <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{kpi.compareNote}</p>}
        </>
      )}
    </>
  );
  return onSelect ? (
    <button type="button" onClick={onSelect} aria-pressed={!!selected} aria-label={`${kpi.label} details`} className="text-left rounded-2xl p-4 border w-full" style={{ borderColor: selected ? "var(--accent)" : "var(--border)", background: "var(--bg-surface)" }}>{body}</button>
  ) : (
    <Card className="p-4">{body}</Card>
  );
};

/** Small accessible SVG line chart. Missing days (null) leave a gap; with no numbers at all it shows "not available" instead of an empty plot. */
export const TrendChart: React.FC<{ series: Array<{ date: string; value: number | null }>; label: string; emptyReason?: string }> = ({ series, label, emptyReason }) => {
  const known = series.filter((p) => p.value !== null) as Array<{ date: string; value: number }>;
  if (known.length === 0) return <NotAvailable reason={emptyReason ?? "No numbers have been collected for this period yet."} />;
  const W = 640, H = 170, PX = 36, PY = 16;
  const max = Math.max(...known.map((p) => p.value));
  const min = Math.min(0, ...known.map((p) => p.value));
  const span = max - min || 1;
  const x = (i: number) => PX + (series.length === 1 ? (W - 2 * PX) / 2 : (i * (W - 2 * PX)) / (series.length - 1));
  const y = (v: number) => H - PY - ((v - min) / span) * (H - 2 * PY);
  const segments: string[] = [];
  let cur = "";
  series.forEach((p, i) => {
    if (p.value === null) { if (cur) segments.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;
  });
  if (cur) segments.push(cur);
  const desc = `${label}: ${known.length} of ${series.length} days have data, from ${fmtNumber(Math.min(...known.map((p) => p.value)))} to ${fmtNumber(max)}.`;
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc} className="w-full h-auto" style={{ maxHeight: 220 }}>
        <title>{desc}</title>
        <line x1={PX} x2={W - PX} y1={H - PY} y2={H - PY} stroke="var(--border)" />
        <text x={PX - 6} y={y(max) + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{fmtNumber(max)}</text>
        <text x={PX - 6} y={H - PY + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{fmtNumber(min)}</text>
        {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {series.map((p, i) => p.value === null ? null : (
          <circle key={p.date} cx={x(i)} cy={y(p.value)} r={series.length > 45 ? 1.5 : 3} fill="var(--accent)"><title>{`${fmtDay(p.date)}: ${fmtNumber(p.value)}`}</title></circle>
        ))}
        <text x={PX} y={H - 2} fontSize="10" fill="var(--text-muted)">{fmtDay(series[0]!.date)}</text>
        <text x={W - PX} y={H - 2} textAnchor="end" fontSize="10" fill="var(--text-muted)">{fmtDay(series[series.length - 1]!.date)}</text>
      </svg>
    </figure>
  );
};

export const providerLabel = (provider: string): string => (provider === "meta_instagram" ? "Instagram" : provider === "meta_facebook" ? "Facebook Page" : provider === "linkedin" ? "LinkedIn" : provider);
