import { describe, expect, it } from "vitest";
import { wrapLines } from "./featureImage";

const measure = (t: string) => t.length * 10; // 10px per character

describe("feature image text layout", () => {
  it("wraps on word boundaries within the width", () => {
    expect(wrapLines(measure, "one two three four", 100, 3)).toEqual(["one two", "three four"]);
  });

  it("ends the last allowed line with an ellipsis when the text does not fit", () => {
    const lines = wrapLines(measure, "alpha beta gamma delta epsilon zeta eta theta", 100, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    expect(lines.every((l) => measure(l) <= 100)).toBe(true);
  });

  it("keeps a single overlong word on its own line, trimmed", () => {
    const lines = wrapLines(measure, "supercalifragilistic", 80, 2);
    expect(lines).toHaveLength(1);
    expect(measure(lines[0]!)).toBeLessThanOrEqual(80);
  });

  it("returns nothing for empty text", () => {
    expect(wrapLines(measure, "   ", 100, 3)).toEqual([]);
  });

  it("a single allowed line ends with an ellipsis instead of dropping words silently", () => {
    const lines = wrapLines(measure, "AI chatbot Appointments After hours", 150, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("…")).toBe(true);
    expect(measure(lines[0]!)).toBeLessThanOrEqual(150);
  });
});
