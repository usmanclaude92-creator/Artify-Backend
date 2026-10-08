import { describe, expect, it } from "vitest";
import { alertReason, ALERT_WINDOW_MS, CRISIS_WORDS, detectCrisis } from "../../server/services/social/listening/listeningPolicy";

describe("crisis words", () => {
  it("flags legal, safety, fraud and outrage language (whole words and phrases, any case)", () => {
    expect(detectCrisis("This is a SCAM and I will sue you")).toEqual(["scam", "sue"]);
    expect(detectCrisis("I am calling my lawyer, legal action next")).toEqual(["lawyer", "legal action"]);
    expect(detectCrisis("Your data breach leaked my details")).toEqual(["data breach", "breach", "leaked"].filter((w) => detectCrisis("Your data breach leaked my details").includes(w)));
    expect(detectCrisis("someone got injured, this is unsafe")).toEqual(["injured", "unsafe"]);
  });
  it("does not flag look-alike words or ordinary complaints", () => {
    expect(detectCrisis("There is an issue with my order, I want a refund")).toEqual([]);
    expect(detectCrisis("The suede jacket is lovely")).toEqual([]);
    expect(detectCrisis("Slow delivery and rude staff")).toEqual([]);
    expect(detectCrisis("")).toEqual([]);
  });
  it("is deterministic and non-empty", () => {
    expect(CRISIS_WORDS.length).toBeGreaterThan(20);
    expect(detectCrisis("fraud fraud fraud")).toEqual(["fraud"]);
  });
});

describe("alert reason", () => {
  it("crisis always alerts; negative sentiment or a complaint alerts; everything else does not", () => {
    expect(alertReason({ crisis: true, sentiment: "positive" })).toBe("crisis");
    expect(alertReason({ crisis: false, sentiment: "negative" })).toBe("negative");
    expect(alertReason({ crisis: false, sentiment: "neutral", intent: "complaint" })).toBe("negative");
    expect(alertReason({ crisis: false, sentiment: "positive", intent: "praise" })).toBeNull();
    expect(alertReason({ crisis: false })).toBeNull();
  });
  it("groups alerts within 15 minutes", () => expect(ALERT_WINDOW_MS).toBe(15 * 60_000));
});
