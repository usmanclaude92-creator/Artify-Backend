/** Workspaces keep their saved copy of a built-in prompt; an unedited older copy is upgraded, an edited one is left alone. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../server/db/prisma";
import { ensureTemplate } from "../../server/services/social/socialAiService";
import { CONTENT_PROMPTS } from "../../server/services/contentAiPrompts";
import { promptFingerprint } from "../../server/services/social/socialAiPrompts";
import { resetDb } from "../helpers/db";

describe("built-in prompt upgrade", () => {
  let orgId = "";
  beforeAll(async () => {
    await resetDb();
    orgId = (await prisma.organization.create({ data: { name: "Prompt Co", slug: "prompt-co" } })).id;
  });
  afterAll(async () => { await prisma.organization.deleteMany({ where: { id: orgId } }); });

  const caller = () => ({ id: null, organizationId: orgId });
  const def = CONTENT_PROMPTS.product;

  it("keeps the fingerprint of the current text and registers it on first use", async () => {
    const { version } = await ensureTemplate(caller(), def);
    expect(promptFingerprint(version)).toBe(promptFingerprint(def));
    expect(version.version).toBe(1);
  });

  it("upgrades a workspace that still has the unedited first version", async () => {
    // Put the template back on the original (v1) text, as production workspaces have it.
    const t = await prisma.aIPromptTemplate.findFirstOrThrow({ where: { organizationId: orgId, key: def.key } });
    const legacyV1 = "Seed text from the first release is represented by any text whose fingerprint is listed as legacy.";
    expect(def.legacyFingerprints!.length).toBeGreaterThan(0);
    // A fingerprint is only known for real historic text, so rebuild one: use an arbitrary text and register its fingerprint as legacy for this test.
    const fake = { systemInstructions: legacyV1, userTemplate: "old {{brief}}" };
    const row = await prisma.aIPromptVersion.create({ data: { templateId: t.id, version: 2, ...fake } });
    await prisma.aIPromptTemplate.update({ where: { id: t.id }, data: { currentVersionId: row.id } });
    const testDef = { ...def, legacyFingerprints: [promptFingerprint(fake)] };
    const { version } = await ensureTemplate(caller(), testDef);
    expect(version.version).toBe(3);
    expect(promptFingerprint(version)).toBe(promptFingerprint(def));
  });

  it("leaves a workspace-edited prompt alone", async () => {
    const t = await prisma.aIPromptTemplate.findFirstOrThrow({ where: { organizationId: orgId, key: def.key } });
    const edited = await prisma.aIPromptVersion.create({ data: { templateId: t.id, version: 4, systemInstructions: "My own rules", userTemplate: "{{brief}}" } });
    await prisma.aIPromptTemplate.update({ where: { id: t.id }, data: { currentVersionId: edited.id } });
    const { version } = await ensureTemplate(caller(), def);
    expect(version.id).toBe(edited.id);
    expect(version.systemInstructions).toBe("My own rules");
  });
});
