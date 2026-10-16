/** Public reader engagement on blog posts (likes, ratings, comments) and the Control Center moderation queue. */
import { z } from "zod";

/** A random per-browser id the website keeps in localStorage; only a salted hash of it is ever stored. */
const clientId = z.string().trim().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const postLikeSchema = z.object({ clientId, liked: z.boolean() });
export const postRatingSchema = z.object({ clientId, score: z.number().int().min(1).max(5) });
export const postCommentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  role: z.string().trim().max(120).optional(),
  body: z.string().trim().min(5).max(2000),
  /** Honeypot: real visitors never see or fill this field. */
  website: z.string().max(200).optional(),
});
export const listPostCommentsQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const moderatePostCommentSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]) });
