/** Pure inbox policy: triage parsing/fallbacks, deterministic prefilters, rule routing, SLA, retention, auto-reply eligibility, redaction. No I/O. */
import { z } from "zod";

export const INTENTS = ["question", "lead", "complaint", "praise", "spam", "support_request", "other"] as const;
export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Intent = (typeof INTENTS)[number];
export type Sentiment = (typeof SENTIMENTS)[number];
export type Priority = (typeof PRIORITIES)[number];

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };
export const maxPriority = (a: Priority, b: Priority): Priority => (PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b);

export const triageSchema = z.object({
  intent: z.string().transform((v) => v.trim().toLowerCase().replace(/[\s-]+/g, "_")),
  sentiment: z.string().transform((v) => v.trim().toLowerCase()),
  priority: z.string().transform((v) => v.trim().toUpperCase()),
  language: z.string().trim().max(10).optional().nullable(),
  spamScore: z.coerce.number().min(0).max(1).optional(),
  category: z.string().trim().max(60).optional().nullable(),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

export interface Triage {
  intent: Intent;
  sentiment: Sentiment;
  priority: Priority;
  language: string | null;
  spamScore: number;
  category: string | null;
  confidence: number | null;
  source: "AI" | "RULE_PREFILTER" | "FALLBACK";
  flaggedForHuman: boolean;
}

/** Safe default when the model is unavailable or returns something unusable: a human looks at it. */
export function fallbackTriage(partial: Partial<Triage> = {}): Triage {
  return { intent: "other", sentiment: "neutral", priority: "NORMAL", language: null, spamScore: 0, category: null, confidence: null, source: "FALLBACK", flaggedForHuman: true, ...partial };
}

/** Parses model output into a validated Triage; ANY problem yields the human-review fallback (never throws). */
export function parseTriage(text: string): Triage {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    return triageFromRaw(triageSchema.parse(JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned)));
  } catch {
    return fallbackTriage();
  }
}

/** Normalises an already-validated model result: unknown labels become safe defaults and flag the item for a human. */
export function triageFromRaw(raw: z.infer<typeof triageSchema>): Triage {
  try {
    const intent = (INTENTS as readonly string[]).includes(raw.intent) ? (raw.intent as Intent) : "other";
    const sentiment = (SENTIMENTS as readonly string[]).includes(raw.sentiment) ? (raw.sentiment as Sentiment) : "neutral";
    const priority = (PRIORITIES as readonly string[]).includes(raw.priority) ? (raw.priority as Priority) : "NORMAL";
    const unrecognised = (intent === "other" && raw.intent !== "other") || !(SENTIMENTS as readonly string[]).includes(raw.sentiment);
    return finalizeTriage({ intent, sentiment, priority, language: raw.language ?? null, spamScore: raw.spamScore ?? (intent === "spam" ? 0.9 : 0), category: raw.category ?? null, confidence: raw.confidence ?? null, source: "AI", flaggedForHuman: unrecognised });
  } catch {
    return fallbackTriage();
  }
}

/** Business rules applied on top of any classification: complaints / negative sentiment are ALWAYS for humans. */
export function finalizeTriage(t: Triage): Triage {
  const out = { ...t };
  if (out.spamScore >= 0.8 && out.intent !== "spam") out.intent = "spam";
  if (out.intent === "complaint") out.priority = maxPriority(out.priority, "HIGH");
  if (out.intent === "complaint" || out.sentiment === "negative") out.flaggedForHuman = true;
  if (out.intent === "spam") { out.flaggedForHuman = false; out.priority = "LOW"; }
  return out;
}

const SPAM_PATTERNS: RegExp[] = [
  /\b(free|buy|cheap)\s+(followers|likes|subscribers)\b/i,
  /\b(crypto|bitcoin|forex|nft)\b.*\b(invest|profit|earn|double)\b/i,
  /\b(earn|make)\s+\$?\d{2,}.{0,20}\b(day|week|hour|from home)\b/i,
  /\b(dm|message|whatsapp|telegram)\s+(me|us)\s+(to|for)\s+(earn|win|claim)\b/i,
  /\bclick (the )?link in (my )?(bio|profile)\b/i,
  /\b(you(?:'|’)ve|you have) (won|been selected)\b/i,
];

export interface PrefilterResult {
  spam: boolean;
  spamScore: number;
  bannedWordHit: boolean;
}

/** Deterministic checks that run BEFORE any model call. */
export function prefilter(text: string, bannedWords: string[] = []): PrefilterResult {
  const links = (text.match(/https?:\/\/\S+/gi) ?? []).length;
  let score = 0;
  if (SPAM_PATTERNS.some((p) => p.test(text))) score += 0.85;
  if (links >= 3) score += 0.5;
  else if (links === 2) score += 0.2;
  if (/(.)\1{9,}/.test(text)) score += 0.3;
  const lower = text.toLowerCase();
  const bannedWordHit = bannedWords.some((w) => w.trim() && new RegExp(`(^|[^\\p{L}\\p{N}])${w.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(lower));
  const spamScore = Math.min(1, score);
  return { spam: spamScore >= 0.8, spamScore, bannedWordHit };
}

export const spamTriage = (spamScore: number): Triage => finalizeTriage({ intent: "spam", sentiment: "neutral", priority: "LOW", language: null, spamScore, category: "spam", confidence: 1, source: "RULE_PREFILTER", flaggedForHuman: false });

// ---------------- routing rules ----------------
export interface InboxRule {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
  matchKeywords: string[];
  matchIntents: string[];
  matchSentiments: string[];
  assigneeId: string | null;
  setPriority: Priority | null;
  addTags: string[];
}

export interface RuleOutcome {
  assigneeId: string | null;
  priority: Priority | null;
  tags: string[];
  matchedRuleIds: string[];
}

/** Rules run in `position` order. A rule matches when EVERY criterion it defines matches. First assignee wins; priority is the highest set; tags accumulate. */
export function applyRules(rules: InboxRule[], ctx: { text: string; intent: string; sentiment: string }): RuleOutcome {
  const lower = ctx.text.toLowerCase();
  const out: RuleOutcome = { assigneeId: null, priority: null, tags: [], matchedRuleIds: [] };
  for (const rule of [...rules].filter((r) => r.enabled).sort((a, b) => a.position - b.position)) {
    const hasCriteria = rule.matchKeywords.length + rule.matchIntents.length + rule.matchSentiments.length > 0;
    if (!hasCriteria) continue;
    if (rule.matchKeywords.length && !rule.matchKeywords.some((k) => k.trim() && lower.includes(k.trim().toLowerCase()))) continue;
    if (rule.matchIntents.length && !rule.matchIntents.includes(ctx.intent)) continue;
    if (rule.matchSentiments.length && !rule.matchSentiments.includes(ctx.sentiment)) continue;
    out.matchedRuleIds.push(rule.id);
    if (!out.assigneeId && rule.assigneeId) out.assigneeId = rule.assigneeId;
    if (rule.setPriority) out.priority = out.priority ? maxPriority(out.priority, rule.setPriority) : rule.setPriority;
    for (const t of rule.addTags) if (!out.tags.includes(t)) out.tags.push(t);
  }
  return out;
}

// ---------------- SLA, retention, dedupe ----------------
export const slaDueAt = (lastInboundAt: Date, minutes: number): Date => new Date(lastInboundAt.getTime() + minutes * 60_000);
export const isOverdue = (c: { status: string; slaDueAt: Date | null; firstResponseAt: Date | null }, now: Date): boolean =>
  (c.status === "OPEN" || c.status === "PENDING") && !c.firstResponseAt && !!c.slaDueAt && c.slaDueAt.getTime() < now.getTime();
export const retentionCutoff = (now: Date, days: number): Date => new Date(now.getTime() - days * 86400_000);

export const normalizeHandle = (handle: string): string => handle.trim().replace(/^@+/, "").toLowerCase();
/** The lead `source` tag that identifies one social participant: used to dedupe leads that have no email. */
export const socialLeadSource = (provider: string, handle: string): string => `social:${provider}:${normalizeHandle(handle)}`;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

// ---------------- auto-reply ----------------
export interface ApprovedReply { id: string; body: string; approvedForAuto: boolean; matchKeywords: string[] }

export function matchApprovedReply(text: string, replies: ApprovedReply[]): ApprovedReply | null {
  const lower = text.toLowerCase();
  return replies.find((r) => r.approvedForAuto && r.matchKeywords.some((k) => k.trim() && lower.includes(k.trim().toLowerCase()))) ?? null;
}

export const AUTO_REPLY_MIN_CONFIDENCE = 0.8;

/**
 * Auto-reply is deliberately narrow: only (a) simple thanks/praise, or (b) a simple question that matches an approved
 * canned answer. Anything negative, complaint, spam, lead, support, flagged, or low-confidence is left for a human.
 */
export function autoReplyKind(t: Triage, text: string, approved: ApprovedReply[]): { kind: "thanks" | "faq"; reply: ApprovedReply | null } | null {
  if (t.flaggedForHuman || t.sentiment === "negative" || t.spamScore >= 0.3) return null;
  if (t.confidence === null || t.confidence < AUTO_REPLY_MIN_CONFIDENCE) return null;
  if (t.intent === "praise" && t.sentiment === "positive") return { kind: "thanks", reply: null };
  if (t.intent === "question") {
    const reply = matchApprovedReply(text, approved);
    return reply ? { kind: "faq", reply } : null;
  }
  return null;
}

// ---------------- redaction ----------------
/** Short preview for notifications/audit: masks emails, phone numbers and links, truncates hard. Never the full message. */
export function redactPreview(text: string, max = 40): string {
  const masked = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked;
}
