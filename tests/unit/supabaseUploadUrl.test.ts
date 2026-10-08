import { describe, expect, it } from "vitest";
import { absoluteUploadUrl } from "../../server/storage/supabaseStorageProvider";

describe("supabase signed upload URL", () => {
  const base = "https://proj.supabase.co";
  it("keeps the absolute URL returned by current storage-js (prefixing it produced a 404)", () => {
    const abs = `${base}/storage/v1/object/upload/sign/artify-media/org/x.jpg?token=abc`;
    expect(absoluteUploadUrl(base, abs)).toBe(abs);
  });
  it("still prefixes relative paths from older versions", () => {
    expect(absoluteUploadUrl(base, "/object/upload/sign/b/k?token=t")).toBe(`${base}/storage/v1/object/upload/sign/b/k?token=t`);
    expect(absoluteUploadUrl(base, "object/upload/sign/b/k?token=t")).toBe(`${base}/storage/v1/object/upload/sign/b/k?token=t`);
  });
});
