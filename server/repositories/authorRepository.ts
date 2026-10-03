/** Author data access (Phase 8 — docs/CMS_ARCHITECTURE.md §Authors). Platform-global — no organization scoping (mirrors productRepository.ts's Product, the existing precedent for a global entity). */
import type { Author, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

const withUser = { include: { user: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true, status: true } } } } as const;
export type AuthorWithUser = Prisma.AuthorGetPayload<typeof withUser>;

// Phase 7 — post counts for the Content Organization UI, same shape as
// CategoryWithCounts/TagWithCounts.
export type AuthorWithCounts = AuthorWithUser & { postCount: number };

export const authorRepository = {
  async list(): Promise<AuthorWithCounts[]> {
    const rows = await prisma.author.findMany({
      ...withUser,
      include: { ...withUser.include, _count: { select: { posts: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(({ _count, ...a }) => ({ ...a, postCount: _count.posts }));
  },

  async findById(id: string): Promise<AuthorWithUser | null> {
    return prisma.author.findUnique({ where: { id }, ...withUser });
  },

  async findByUserId(userId: string): Promise<Author | null> {
    return prisma.author.findUnique({ where: { userId } });
  },

  async create(data: { userId: string; bio?: string; avatarUrl?: string }): Promise<AuthorWithUser> {
    return prisma.author.create({ data, ...withUser });
  },

  async update(id: string, data: Prisma.AuthorUpdateInput): Promise<AuthorWithUser> {
    return prisma.author.update({ where: { id }, data, ...withUser });
  },
};
