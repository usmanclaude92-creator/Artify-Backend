/** Sidebar helpers. Session-only (like /auth/me): counts are filtered to what the caller's permissions allow inside the service. */
import { Router } from "express";
import { authenticateToken } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { z } from "zod";
import { navBadgeService } from "../../services/navBadgeService";
import { navPreferenceService, MAX_PINS } from "../../services/navPreferenceService";

const router = Router();
router.use(authenticateToken);

router.get(
  "/badges",
  asyncHandler(async (req, res) => {
    sendSuccess(res, { badges: await navBadgeService.get(req.user!) });
  })
);

const updatePreferencesSchema = z
  .object({
    railCollapsed: z.boolean().optional(),
    pinned: z
      .array(z.string().regex(/^[a-z0-9-]{1,64}$/, "Invalid item id."))
      .max(MAX_PINS, `At most ${MAX_PINS} items can be pinned.`)
      .refine((ids) => new Set(ids).size === ids.length, { message: "Pinned items must be unique." })
      .optional(),
  })
  .refine((v) => v.railCollapsed !== undefined || v.pinned !== undefined, { message: "Nothing to update." });

// Sidebar preferences for the CALLER only: rail state (per user) and pins (per user + current workspace).
router.get(
  "/preferences",
  asyncHandler(async (req, res) => {
    sendSuccess(res, { preferences: await navPreferenceService.get(req.user!) });
  })
);

router.put(
  "/preferences",
  asyncHandler(async (req, res) => {
    const input = updatePreferencesSchema.parse(req.body);
    sendSuccess(res, { preferences: await navPreferenceService.update(req.user!, input) });
  })
);

export default router;
