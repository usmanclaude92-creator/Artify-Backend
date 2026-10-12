import { describe, expect, it } from "vitest";
import { pickPalette, wrapLines } from "./featureImage";

const measure = (t: string) => t.length * 10; // 10px per character

describe("feature image helpers", () => {
  it("picks the same palette for the same title", () => {
    expect(pickPalette("Artify CAS")).toEqual(pickPalette("Artify CAS"));
  });

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
});
