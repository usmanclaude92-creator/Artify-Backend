import { describe, expect, it } from "vitest";
import { countHashtags, utcToZonedLocal, zonedLocalToUtc } from "./socialPostShared";

describe("social time helpers", () => {
  it("converts wall-clock time in a timezone to the right UTC instant (incl. DST)", () => {
    expect(zonedLocalToUtc("2031-01-15T09:00", "UTC").toISOString()).toBe("2031-01-15T09:00:00.000Z");
    expect(zonedLocalToUtc("2031-01-15T09:00", "America/New_York").toISOString()).toBe("2031-01-15T14:00:00.000Z"); // EST, UTC-5
    expect(zonedLocalToUtc("2031-07-15T09:00", "America/New_York").toISOString()).toBe("2031-07-15T13:00:00.000Z"); // EDT, UTC-4
    expect(zonedLocalToUtc("2031-07-15T09:00", "Asia/Karachi").toISOString()).toBe("2031-07-15T04:00:00.000Z"); // UTC+5
  });

  it("round-trips UTC <-> zoned local", () => {
    const iso = "2031-07-15T13:00:00.000Z";
    const local = utcToZonedLocal(iso, "America/New_York");
    expect(local).toBe("2031-07-15T09:00");
    expect(zonedLocalToUtc(local, "America/New_York").toISOString()).toBe(iso);
  });

  it("counts hashtags", () => {
    expect(countHashtags("#a b #c_d e#no")).toBe(2);
  });
});
