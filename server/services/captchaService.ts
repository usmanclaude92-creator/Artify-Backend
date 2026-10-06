/**
 * Cloudflare Turnstile verification for the public auth forms. Enforced only
 * when TURNSTILE_SECRET_KEY is configured; otherwise forms rely on the
 * honeypot, rate limits and lockout. The secret is server-side only.
 */
import { config } from "../config/env";
import { logger } from "../core/logger";
import { ValidationError } from "../core/errors";

export const captchaService = {
  isEnabled(): boolean {
    return config.turnstileSecretKey.length > 0;
  },

  async assertHuman(token: string | undefined, ip?: string): Promise<void> {
    if (!this.isEnabled()) return;
    if (!token) throw new ValidationError("Please complete the security check and try again.");
    try {
      const body = new URLSearchParams({ secret: config.turnstileSecretKey, response: token });
      if (ip) body.set("remoteip", ip);
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      const data = (await res.json()) as { success?: boolean };
      if (data.success) return;
    } catch (err) {
      logger.error({ err, event: "captcha_verify_failed" }, "Turnstile verification request failed");
    }
    throw new ValidationError("Security check failed. Please try again.");
  },
};
