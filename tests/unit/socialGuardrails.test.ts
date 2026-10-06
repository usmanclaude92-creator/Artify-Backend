import { describe, expect, it } from "vitest";
import { runGuardrails, countHashtags, type GuardrailInput } from "../../server/services/social/guardrails";
import { DEFAULT_CONSTRAINTS } from "../../server/services/social/connectors/types";
import { instagramProvider } from "../../server/services/social/connectors/stubProviders";
import { connectorRegistry } from "../../server/services/social/connectors/registry";
import { POST_TRANSITIONS, canTransition, CONTENT_EDITABLE } from "../../server/services/social/postTransitions";

const base = (over: Partial<GuardrailInput> = {}, text = "Hello world from Artify"): GuardrailInput => ({
  targets: [{ socialAccountId: "a1", label: "Acme", text, constraints: { ...DEFAULT_CONSTRAINTS, maxChars: 100, maxHashtags: 2 } }],
  fallbackText: text,
  linkUrl: null,
  mediaCount: 0,
  hasSourceContent: false,
  brandVoice: { bannedWords: [], requiredDisclaimers: [] },
  recentBodies: [],
  ...over,
});
const rules = (input: GuardrailInput) => runGuardrails(input).issues.map((i) => `${i.severity}:${i.rule}`);

describe("guardrails", () => {
  it("passes a clean post", () => {
    const r = runGuardrails(base());
    expect(r.passed).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("blocks empty text and missing targets", () => {
    expect(rules(base({ targets: [], fallbackText: "" }))).toEqual(expect.arrayContaining(["block:empty_body", "block:no_targets"]));
  });

  it("blocks banned words (whole word, case-insensitive) but not substrings", () => {
    const vb = { bannedWords: ["cheap"], requiredDisclaimers: [] };
    expect(rules(base({ brandVoice: vb }, "Get CHEAP deals"))).toContain("block:banned_word");
    expect(rules(base({ brandVoice: vb }, "Cheaper? no, a cheapskate joke"))).not.toContain("block:banned_word");
  });

  it("blocks a missing required disclaimer and accepts it once present (whitespace/case-insensitive)", () => {
    const vb = { bannedWords: [], requiredDisclaimers: ["Not financial advice"] };
    expect(rules(base({ brandVoice: vb }))).toContain("block:missing_disclaimer");
    expect(rules(base({ brandVoice: vb }, "Invest wisely.  not  financial advice"))).not.toContain("block:missing_disclaimer");
  });

  it("enforces per-account length and media/hashtag limits", () => {
    expect(rules(base({}, "x".repeat(101)))).toContain("block:too_long");
    expect(rules(base({}, "x".repeat(100)))).not.toContain("block:too_long");
    expect(rules(base({}, "a #one #two #three"))).toContain("warn:too_many_hashtags");
    const needsMedia = base();
    needsMedia.targets[0]!.constraints = { ...DEFAULT_CONSTRAINTS, requiresMedia: true };
    expect(rules(needsMedia)).toContain("block:media_required");
    expect(rules({ ...needsMedia, mediaCount: 1 })).not.toContain("block:media_required");
    expect(rules(base({ mediaCount: 9 }))).toContain("block:too_much_media");
  });

  it("validates links and warns when shared content has no link", () => {
    expect(rules(base({ linkUrl: "javascript:alert(1)" }))).toContain("block:invalid_link");
    expect(rules(base({ linkUrl: "not a url" }))).toContain("block:invalid_link");
    expect(rules(base({ linkUrl: "https://artifysols.com/blog/x" }))).not.toContain("block:invalid_link");
    expect(rules(base({ hasSourceContent: true }))).toContain("warn:missing_link");
  });

  it("flags exact duplicates (block) and near-duplicates (warn) of recent posts", () => {
    expect(rules(base({ recentBodies: ["hello   WORLD from artify"] }))).toContain("block:duplicate_content");
    const text = "Launching our new analytics dashboard for enterprise teams today with live reports";
    expect(rules(base({ recentBodies: [text + " now"] }, text))).toContain("warn:similar_content");
    expect(rules(base({ recentBodies: ["Completely different message about hiring"] }))).not.toContain("block:duplicate_content");
  });

  it("blocks disconnected accounts, warns on accounts needing reconnect", () => {
    const disconnected = base();
    disconnected.targets[0]!.accountStatus = "DISCONNECTED";
    expect(rules(disconnected)).toContain("block:account_unavailable");
    const reauth = base();
    reauth.targets[0]!.accountStatus = "NEEDS_REAUTH";
    expect(rules(reauth)).toContain("warn:account_unavailable");
    expect(runGuardrails(reauth).passed).toBe(true);
  });

  it("counts hashtags", () => {
    expect(countHashtags("#a b #c_d #é e#notatag")).toBe(3);
  });
});

describe("post transitions", () => {
  it("allows the intended lifecycle", () => {
    expect(canTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransition("PENDING_APPROVAL", "REJECTED")).toBe(true);
    expect(canTransition("APPROVED", "SCHEDULED")).toBe(true);
    expect(canTransition("SCHEDULED", "APPROVED")).toBe(true);
    expect(canTransition("REJECTED", "DRAFT")).toBe(true);
  });

  it("rejects shortcuts and terminal-state exits", () => {
    expect(canTransition("DRAFT", "SCHEDULED")).toBe(false); // must be approved first
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false);
    expect(canTransition("PUBLISHED", "DRAFT")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(canTransition("APPROVED", "PENDING_APPROVAL")).toBe(false);
    expect(POST_TRANSITIONS.PUBLISHED).toEqual([]);
  });

  it("only drafts and rejected posts are content-editable", () => {
    expect(CONTENT_EDITABLE).toEqual(["DRAFT", "REJECTED"]);
  });
});

describe("network constraints", () => {
  it("are defined for every registered connector, specialised by account type", () => {
    expect(connectorRegistry.constraintsFor("linkedin").maxChars).toBe(3000);
    expect(connectorRegistry.constraintsFor("meta_facebook", "PAGE")).toMatchObject({ maxChars: 63206, maxMedia: 1, requiresMedia: false, supportsLink: true });
    // Instagram is a later step: its constraints live on the (unregistered) placeholder so the connector can be added without refactoring.
    expect(instagramProvider.getConstraints()).toMatchObject({ maxChars: 2200, requiresMedia: true, supportsLink: false });
    expect(connectorRegistry.constraintsFor("mock").maxChars).toBe(500);
    expect(connectorRegistry.constraintsFor("unknown-network")).toEqual(DEFAULT_CONSTRAINTS);
  });
});
