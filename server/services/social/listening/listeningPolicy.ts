/** Pure rules for listening: crisis words and when a mention/review deserves an alert. No I/O. */

/**
 * Default crisis vocabulary: legal threats, safety, fraud/security claims and public-outrage calls. Matched as whole words/phrases, case-insensitive.
 * Deterministic on purpose: it works even when the AI provider is down. Workspaces add their own words with inbox rules (keyword → URGENT).
 */
export const CRISIS_WORDS: readonly string[] = [
  "lawsuit", "lawyer", "attorney", "legal action", "sue", "suing", "scam", "scammer", "fraud", "fraudulent", "rip-off", "ripoff", "stolen", "data breach", "breach", "hacked", "leaked",
  "unsafe", "dangerous", "injury", "injured", "poison", "poisoned", "died", "death", "harassment", "harassed", "racist", "discrimination", "boycott", "illegal", "police", "consumer protection",
];

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CRISIS_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${CRISIS_WORDS.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu");

/** Crisis words found in `text` (unique, lowercase). */
export function detectCrisis(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(CRISIS_RE)) found.add(m[0].toLowerCase());
  return [...found];
}

export const CRISIS_TAG = "crisis";

export type AlertReason = "crisis" | "negative";

/** Negative sentiment or a complaint raises an alert; a crisis flag always does. */
export function alertReason(input: { crisis: boolean; sentiment?: string | null; intent?: string | null }): AlertReason | null {
  if (input.crisis) return "crisis";
  if (input.sentiment === "negative" || input.intent === "complaint") return "negative";
  return null;
}

export const ALERT_WINDOW_MS = 15 * 60_000;
