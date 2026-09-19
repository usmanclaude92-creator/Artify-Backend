import { Router } from "express";
import { authService } from "../../services/authService";
import { authenticateToken } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { loginSchema, registerSchema } from "../../schemas/authSchemas";

const router = Router();

router.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input.email, input.password, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, result);
  })
);

router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    sendSuccess(res, result, 201);
  })
);

router.get(
  "/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    sendSuccess(res, { user: req.user });
  })
);

router.post(
  "/logout",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (req.sessionToken) {
      await authService.logout(req.sessionToken);
    }
    sendSuccess(res, { message: "Logged out successfully." });
  })
);

export default router;
