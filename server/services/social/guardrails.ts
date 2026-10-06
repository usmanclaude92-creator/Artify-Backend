/**
 * Guardrails v1 — deterministic, in-code checks. No model involved. A "block" issue stops a post from moving to
 * PENDING_APPROVAL / SCHEDULED; "warn" issues are shown but never block.
 */
import type { SocialConstraints } from "./connectors/types";

export interface GuardrailBrandVoice {
  bannedWords: string[];
  requiredDisclaimers: string[];
}

export interface GuardrailTarget {
  socialAccountId: string;
  label: string;
  /** Effective text for this account (override if set, else the post body). */
  text: string;
  constraints: SocialConstraints;
  accountStatus?: string;
}

export interface GuardrailInput {
  targets: GuardrailTarget[];
  fallbackText: string;
  linkUrl?: string | null;
  mediaCount: number;
  hasSourceContent: boolean;
  brandVoice: GuardrailBrandVoice;
  /** Bodies of recent (non-cancelled) posts in the same workspace, excluding this one. */
  recentBodies: string[];
}

export type GuardrailRule =
  | "empty_body"
  | "no_targets"
  | "banned_word"
  | "missing_disclaimer"
  | "too_long"
  | "too_many_hashtags"
  | "media_required"
  | "too_much_media"
  | "invalid_link"
  | "missing_link"
  | "duplicate_content"
  | "similar_content"
  | "account_unavailable";

export interface GuardrailIssue {
  rule: GuardrailRule;
  severity: "block" | "warn";
  message: string;
  socialAccountId?: string;
}

export interface GuardrailResult {
  passed: boolean;
  issues: GuardrailIssue[];
  checkedAt: string;
}

const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const tokens = (t: string) => new Set(normalize(t).split(/[^\p{L}\p{N}#@]+/u).filter((w) => w.length > 2));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export const countHashtags = (text: string, prefix = "#") => (text.match(new RegExp(`(^|\\s)${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\p{L}\\p{N}_]+`, "gu")) ?? []).length;

function containsWord(text: string, word: string): boolean {
  const w = word.trim().toLowerCase();
  if (!w) return false;
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

export function runGuardrails(input: GuardrailInput): GuardrailResult {
  const issues: GuardrailIssue[] = [];
  const add = (issue: GuardrailIssue) => issues.push(issue);

  if (!input.fallbackText.trim() && input.targets.every((t) => !t.text.trim())) add({ rule: "empty_body", severity: "block", message: "The post has no text." });
  if (input.targets.length === 0) add({ rule: "no_targets", severity: "block", message: "Select at least one connected account." });

  if (input.linkUrl) {
    try {
      const u = new URL(input.linkUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
    } catch {
      add({ rule: "invalid_link", severity: "block", message: "The link is not a valid http(s) URL." });
    }
  } else if (input.hasSourceContent) {
    add({ rule: "missing_link", severity: "warn", message: "This post shares existing content but has no link." });
  }

  for (const target of input.targets) {
    const c = target.constraints;
    const where = target.label;
    const base = { socialAccountId: target.socialAccountId };
    if (target.accountStatus === "DISCONNECTED" || target.accountStatus === "ERROR") add({ rule: "account_unavailable", severity: "block", message: `${where}: this account is ${target.accountStatus.toLowerCase()}. Reconnect it first.`, ...base });
    else if (target.accountStatus === "NEEDS_REAUTH") add({ rule: "account_unavailable", severity: "warn", message: `${where}: this account needs to be reconnected before publishing.`, ...base });
    if (!target.text.trim()) add({ rule: "empty_body", severity: "block", message: `${where}: the text is empty.`, ...base });
    if (target.text.length > c.maxChars) add({ rule: "too_long", severity: "block", message: `${where}: ${target.text.length}/${c.maxChars} characters — shorten the text.`, ...base });
    const tags = countHashtags(target.text, c.hashtagPrefix);
    if (tags > c.maxHashtags) add({ rule: "too_many_hashtags", severity: "warn", message: `${where}: ${tags} hashtags (recommended maximum ${c.maxHashtags}).`, ...base });
    if (c.requiresMedia && input.mediaCount === 0) add({ rule: "media_required", severity: "block", message: `${where}: this network requires an image or video.`, ...base });
    if (input.mediaCount > c.maxMedia) add({ rule: "too_much_media", severity: "block", message: `${where}: ${input.mediaCount} media attached, maximum ${c.maxMedia}.`, ...base });

    for (const word of input.brandVoice.bannedWords) {
      if (containsWord(target.text, word)) add({ rule: "banned_word", severity: "block", message: `${where}: contains the banned word “${word}”.`, ...base });
    }
    for (const disclaimer of input.brandVoice.requiredDisclaimers) {
      if (disclaimer.trim() && !normalize(target.text).includes(normalize(disclaimer))) {
        add({ rule: "missing_disclaimer", severity: "block", message: `${where}: missing required disclaimer “${disclaimer}”.`, ...base });
      }
    }
  }

  // Duplicate check against recent posts, using the post's primary text.
  const primary = input.fallbackText.trim() ? input.fallbackText : (input.targets[0]?.text ?? "");
  if (primary.trim()) {
    const norm = normalize(primary);
    const mine = tokens(primary);
    let exact = false;
    let similar = false;
    for (const other of input.recentBodies) {
      if (normalize(other) === norm) exact = true;
      else if (jaccard(mine, tokens(other)) >= 0.9) similar = true;
    }
    if (exact) add({ rule: "duplicate_content", severity: "block", message: "An identical post was created recently. Change the wording to avoid duplicate content." });
    else if (similar) add({ rule: "similar_content", severity: "warn", message: "This post is very similar to a recent one." });
  }

  return { passed: !issues.some((i) => i.severity === "block"), issues, checkedAt: new Date().toISOString() };
}
