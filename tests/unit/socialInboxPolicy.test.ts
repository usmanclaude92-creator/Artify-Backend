import { describe, expect, it } from "vitest";
import {
  applyRules, autoReplyKind, fallbackTriage, isOverdue, matchApprovedReply, median, normalizeHandle, parseTriage, prefilter, redactPreview, retentionCutoff, slaDueAt, socialLeadSource,
  spamTriage, type InboxRule, type Triage,
} from "../../server/services/social/inbox/inboxPolicy";

const triage = (over: Partial<Triage> = {}): Triage => ({ intent: "praise", sentiment: "positive", priority: "NORMAL", language: "en", spamScore: 0, category: "thanks", confidence: 0.95, source: "AI", flaggedForHuman: false, ...over });
const rule = (over: Partial<InboxRule>): InboxRule => ({ id: "r", name: "r", enabled: true, position: 0, matchKeywords: [], matchIntents: [], matchSentiments: [], assigneeId: null, setPriority: null, addTags: [], ...over });

describe("classification parsing and fallbacks", () => {
  it("parses a well-formed result, tolerating code fences and casing", () => {
    const t = parseTriage('```json\n{"intent":"Support Request","sentiment":"Neutral","priority":"high","language":"en","spamScore":0.1,"category":"login","confidence":0.9}\n```');
    expect(t).toMatchObject({ intent: "support_request", sentiment: "neutral", priority: "HIGH", language: "en", confidence: 0.9, source: "AI", flaggedForHuman: false });
  });
  it("falls back to human review on garbage, empty or schema-invalid output", () => {
    for (const bad of ["", "not json", "{}", '{"intent":1}', "[]"]) expect(parseTriage(bad)).toMatchObject({ source: "FALLBACK", flaggedForHuman: true, intent: "other" });
    expect(fallbackTriage().flaggedForHuman).toBe(true);
  });
  it("maps unknown labels to safe defaults and flags them for a human", () => {
    const t = parseTriage('{"intent":"banana","sentiment":"neutral","priority":"NORMAL"}');
    expect(t).toMatchObject({ intent: "other", flaggedForHuman: true });
    expect(parseTriage('{"intent":"question","sentiment":"angry","priority":"NORMAL"}').flaggedForHuman).toBe(true);
    expect(parseTriage('{"intent":"question","sentiment":"neutral","priority":"MEGA"}').priority).toBe("NORMAL");
  });
  it("complaints and negative sentiment are ALWAYS flagged for humans; complaints are at least HIGH", () => {
    expect(parseTriage('{"intent":"complaint","sentiment":"neutral","priority":"LOW","confidence":0.99}')).toMatchObject({ flaggedForHuman: true, priority: "HIGH" });
    expect(parseTriage('{"intent":"question","sentiment":"negative","priority":"NORMAL","confidence":0.99}').flaggedForHuman).toBe(true);
  });
  it("a high spam score overrides the intent and removes it from human queues", () => {
    expect(parseTriage('{"intent":"question","sentiment":"neutral","priority":"HIGH","spamScore":0.95}')).toMatchObject({ intent: "spam", priority: "LOW", flaggedForHuman: false });
  });
});

describe("deterministic prefilter", () => {
  it("catches known spam patterns and link floods without a model", () => {
    expect(prefilter("Buy cheap followers now!!").spam).toBe(true);
    expect(prefilter("Click the link in my bio to claim").spam).toBe(true);
    expect(prefilter("see http://a.example http://b.example http://c.example").spamScore).toBeGreaterThanOrEqual(0.5);
    expect(prefilter("aaaaaaaaaaaaaaaaaaaa").spamScore).toBeGreaterThan(0);
    expect(spamTriage(0.9)).toMatchObject({ intent: "spam", source: "RULE_PREFILTER", flaggedForHuman: false });
  });
  it("does not flag ordinary messages and detects banned words on word boundaries", () => {
    expect(prefilter("Hi! What are your opening hours?").spam).toBe(false);
    expect(prefilter("this is awful", ["awful"]).bannedWordHit).toBe(true);
    expect(prefilter("awfully nice", ["awful"]).bannedWordHit).toBe(false);
  });
});

describe("rules routing", () => {
  it("matches keyword/intent/sentiment criteria, first assignee wins, priority is the max, tags accumulate", () => {
    const rules = [
      rule({ id: "a", position: 1, matchKeywords: ["pricing"], assigneeId: "u-sales", setPriority: "HIGH", addTags: ["sales"] }),
      rule({ id: "b", position: 2, matchIntents: ["lead"], assigneeId: "u-other", setPriority: "NORMAL", addTags: ["lead", "sales"] }),
      rule({ id: "c", position: 3, matchSentiments: ["negative"], addTags: ["risk"] }),
      rule({ id: "off", position: 0, enabled: false, matchKeywords: ["pricing"], assigneeId: "u-disabled" }),
      rule({ id: "empty", position: 0 }),
    ];
    expect(applyRules(rules, { text: "What is your PRICING?", intent: "lead", sentiment: "neutral" })).toEqual({ assigneeId: "u-sales", priority: "HIGH", tags: ["sales", "lead"], matchedRuleIds: ["a", "b"] });
    expect(applyRules(rules, { text: "hello", intent: "question", sentiment: "negative" })).toMatchObject({ assigneeId: null, tags: ["risk"], matchedRuleIds: ["c"] });
    expect(applyRules(rules, { text: "hello", intent: "question", sentiment: "positive" }).matchedRuleIds).toEqual([]);
  });
  it("requires EVERY defined criterion to match", () => {
    const r = [rule({ matchKeywords: ["refund"], matchIntents: ["complaint"], addTags: ["x"] })];
    expect(applyRules(r, { text: "refund please", intent: "question", sentiment: "neutral" }).matchedRuleIds).toEqual([]);
    expect(applyRules(r, { text: "refund please", intent: "complaint", sentiment: "neutral" }).matchedRuleIds).toEqual(["r"]);
  });
});

describe("dedupe keys, SLA, retention, medians", () => {
  it("normalises handles into one lead source tag", () => {
    expect(normalizeHandle("@@Ada_L ")).toBe("ada_l");
    expect(socialLeadSource("instagram", "@Ada_L")).toBe("social:instagram:ada_l");
    expect(socialLeadSource("instagram", "ada_l")).toBe(socialLeadSource("instagram", "@ADA_L"));
  });
  it("computes SLA due times and overdue state", () => {
    const at = new Date("2026-10-13T10:00:00Z");
    const due = slaDueAt(at, 60);
    expect(due.toISOString()).toBe("2026-10-13T11:00:00.000Z");
    const open = { status: "OPEN", slaDueAt: due, firstResponseAt: null };
    expect(isOverdue(open, new Date("2026-10-13T10:59:00Z"))).toBe(false);
    expect(isOverdue(open, new Date("2026-10-13T11:01:00Z"))).toBe(true);
    expect(isOverdue({ ...open, firstResponseAt: at }, new Date("2026-10-14T00:00:00Z"))).toBe(false);
    expect(isOverdue({ ...open, status: "RESOLVED" }, new Date("2026-10-14T00:00:00Z"))).toBe(false);
    expect(isOverdue({ ...open, slaDueAt: null }, new Date("2026-10-14T00:00:00Z"))).toBe(false);
  });
  it("computes the retention cutoff", () => {
    expect(retentionCutoff(new Date("2026-10-13T00:00:00Z"), 180).toISOString()).toBe("2026-04-16T00:00:00.000Z");
  });
  it("medians", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(3);
  });
});

describe("auto-reply eligibility (narrow by design)", () => {
  const faq = [{ id: "f", body: "We open at 9.", approvedForAuto: true, matchKeywords: ["opening hours"] }, { id: "n", body: "Draft only", approvedForAuto: false, matchKeywords: ["warranty"] }];
  it("allows simple thanks and approved-FAQ questions only", () => {
    expect(autoReplyKind(triage(), "Thank you!", faq)).toEqual({ kind: "thanks", reply: null });
    expect(autoReplyKind(triage({ intent: "question", sentiment: "neutral" }), "What are your opening hours?", faq)).toMatchObject({ kind: "faq", reply: { id: "f" } });
    expect(matchApprovedReply("warranty?", faq)).toBeNull(); // not approved for auto
  });
  it("never auto-replies to negative, complaints, leads, support, flagged, spam-ish or low-confidence items", () => {
    expect(autoReplyKind(triage({ sentiment: "negative" }), "x", faq)).toBeNull();
    expect(autoReplyKind(triage({ intent: "complaint" , flaggedForHuman: true }), "x", faq)).toBeNull();
    expect(autoReplyKind(triage({ intent: "lead" }), "x", faq)).toBeNull();
    expect(autoReplyKind(triage({ intent: "support_request" }), "x", faq)).toBeNull();
    expect(autoReplyKind(triage({ flaggedForHuman: true }), "x", faq)).toBeNull();
    expect(autoReplyKind(triage({ spamScore: 0.4 }), "x", faq)).toBeNull();
    expect(autoReplyKind(triage({ confidence: 0.5 }), "x", faq)).toBeNull();
    expect(autoReplyKind(triage({ confidence: null }), "x", faq)).toBeNull();
    expect(autoReplyKind(triage({ intent: "question", sentiment: "neutral" }), "Where is my order?", faq)).toBeNull(); // no approved answer
  });
});

describe("preview redaction", () => {
  it("masks emails, links and numbers and truncates", () => {
    expect(redactPreview("mail me at jo@example.com or call +44 7700 900123 see https://x.example/a")).toBe("mail me at [email] or call [number] see…");
    expect(redactPreview("short")).toBe("short");
    expect(redactPreview("a".repeat(100)).length).toBe(40);
  });
});
