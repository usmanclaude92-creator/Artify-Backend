/**
 * Guard for AI-written analytics text: every number in the output must already exist in the data we passed to the model.
 * Anything else (a computed, rounded or invented figure) rejects the text — no estimated numbers are ever shown.
 */
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

const variants = (n: number): string[] => {
  const out = new Set<string>();
  out.add(String(n));
  if (Number.isInteger(n)) out.add(n.toLocaleString("en-US"));
  else { out.add(n.toFixed(1)); out.add(n.toFixed(2)); }
  return [...out];
};

/** Numbers appearing anywhere in a JSON-able value (including digits inside date strings). */
export function collectAllowedNumbers(data: unknown): Set<string> {
  const allowed = new Set<string>();
  const add = (s: string) => { allowed.add(s.replace(/,/g, "")); };
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) { for (const s of variants(v)) add(s); const abs = Math.abs(v); for (const s of variants(abs)) add(s); }
    else if (typeof v === "string") for (const m of v.match(NUMBER) ?? []) add(m);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(data);
  return allowed;
}

/** Returns the numbers in `text` that are not in `allowed` (empty = text is safe). Single digits 1–5 written as list/ordinal markers are ignored. */
export function unknownNumbers(text: string, allowed: Set<string>): string[] {
  const bad: string[] = [];
  for (const m of text.match(NUMBER) ?? []) {
    const norm = m.replace(/,/g, "");
    if (!allowed.has(norm) && !allowed.has(String(Number(norm)))) bad.push(m);
  }
  return bad;
}
