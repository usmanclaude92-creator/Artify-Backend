import { Router } from "express";
import { organizationService } from "../../services/organizationService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { addMemberSchema, updateMemberSchema } from "../../schemas/userSchemas";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    const organizations = await organizationService.listOrganizations(req.user!);
    sendSuccess(res, { organizations });
  })
);

router.get(
  "/:id",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    const organization = await organizationService.getOrganization(req.user!, req.params.id);
    sendSuccess(res, { organization });
  })
);

router.post(
  "/:id/members",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    const input = addMemberSchema.parse(req.body);
    const membership = await organizationService.addMember(req.user!, req.params.id, input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, { membership }, 201);
  })
);

router.patch(
  "/:id/members/:userId",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    const input = updateMemberSchema.parse(req.body);
    const membership = await organizationService.updateMember(
      req.user!,
      req.params.id,
      req.params.userId,
      input,
      req.user!.role.permissions,
      { ip: req.ip, userAgent: req.headers["user-agent"] }
    );
    sendSuccess(res, { membership });
  })
);

router.delete(
  "/:id/members/:userId",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    await organizationService.removeMember(req.user!, req.params.id, req.params.userId, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, { message: "Membership removed." });
  })
);

export default router;
