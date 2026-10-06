/** Per-user sidebar preferences: rail collapse (per user) and pinned favourites (per user AND workspace). Nothing here scopes or reads any other data. */
import { prisma } from "../db/prisma";
import type { SanitizedUser } from "../types/domain";

export const MAX_PINS = 8;

export interface NavPreferences {
  railCollapsed: boolean;
  /** Ordered nav item ids pinned in the caller's CURRENT workspace. */
  pinned: string[];
}

export const navPreferenceService = {
  async get(caller: SanitizedUser): Promise<NavPreferences> {
    const [pref, pins] = await Promise.all([
      prisma.userNavPreference.findUnique({ where: { userId: caller.id } }),
      prisma.userNavPin.findMany({ where: { userId: caller.id, organizationId: caller.organizationId }, orderBy: { position: "asc" }, select: { itemId: true } }),
    ]);
    return { railCollapsed: pref?.railCollapsed ?? false, pinned: pins.map((p) => p.itemId) };
  },

  async update(caller: SanitizedUser, input: { railCollapsed?: boolean; pinned?: string[] }): Promise<NavPreferences> {
    if (input.railCollapsed !== undefined) {
      await prisma.userNavPreference.upsert({
        where: { userId: caller.id },
        create: { userId: caller.id, railCollapsed: input.railCollapsed },
        update: { railCollapsed: input.railCollapsed },
      });
    }
    if (input.pinned !== undefined) {
      const ids = [...new Set(input.pinned)].slice(0, MAX_PINS);
      await prisma.$transaction([
        prisma.userNavPin.deleteMany({ where: { userId: caller.id, organizationId: caller.organizationId } }),
        prisma.userNavPin.createMany({ data: ids.map((itemId, position) => ({ userId: caller.id, organizationId: caller.organizationId, itemId, position })) }),
      ]);
    }
    return this.get(caller);
  },
};
