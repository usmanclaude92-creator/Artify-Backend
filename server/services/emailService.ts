/**
 * Transactional account email (verification, password reset, "account exists").
 * Provider-agnostic seam with one real provider (Resend, plain HTTPS — no SDK
 * dependency). With EMAIL_PROVIDER=none nothing is sent and `isEnabled()` is
 * false, which switches the auth flows to their documented degraded mode.
 * Secrets are read from config only and never logged.
 */
import { config } from "../config/env";
import { logger } from "../core/logger";
import { InfrastructureError } from "../core/errors";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function siteUrl(path: string): string {
  const base = (config.publicSiteBaseUrl || "https://artifysols.com").replace(/\/+$/, "");
  return `${base}${path}`;
}

function layout(heading: string, bodyHtml: string, ctaLabel?: string, ctaUrl?: string): string {
  const cta = ctaLabel && ctaUrl
    ? `<p style="margin:28px 0"><a href="${esc(ctaUrl)}" style="background:#6d28d9;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(ctaLabel)}</a></p>
       <p style="font-size:12px;color:#64748b">If the button does not work, copy this link into your browser:<br>${esc(ctaUrl)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="font-weight:700;font-size:18px;margin:0 0 20px">Artify Solutions</p>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(heading)}</h1>
      ${bodyHtml}${cta}
    </div>
    <p style="font-size:12px;color:#94a3b8;margin-top:18px">You received this because of activity on your Artify account. If this was not you, you can ignore this email.</p>
  </div></body></html>`;
}

export const emailService = {
  /** True when a real provider is configured; auth flows depend on this to decide whether email verification can be enforced. */
  isEnabled(): boolean {
    return config.emailProvider !== "none";
  },

  async send(email: OutboundEmail): Promise<void> {
    if (config.emailProvider === "resend") {
      let res: Response;
      try {
        res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: config.emailFrom, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        logger.error({ err, event: "email_send_failed" }, "Email provider request failed");
        throw new InfrastructureError("Email could not be sent right now.");
      }
      if (!res.ok) {
        logger.error({ status: res.status, event: "email_send_rejected" }, "Email provider rejected the message");
        throw new InfrastructureError("Email could not be sent right now.");
      }
      return;
    }
    throw new InfrastructureError("Email delivery is not configured.");
  },

  async sendVerification(to: string, firstName: string, token: string): Promise<void> {
    const url = siteUrl(`/verify-email?token=${encodeURIComponent(token)}`);
    await this.send({
      to,
      subject: "Verify your email for Artify",
      text: `Hi ${firstName},\n\nConfirm your email address to finish setting up your Artify account:\n${url}\n\nThis link expires in ${config.emailVerificationTtlHours} hours.`,
      html: layout("Confirm your email", `<p>Hi ${esc(firstName)}, confirm your email address to finish setting up your Artify client account. The link expires in ${config.emailVerificationTtlHours} hours.</p>`, "Verify email", url),
    });
  },

  async sendPasswordReset(to: string, firstName: string, token: string): Promise<void> {
    const url = siteUrl(`/reset-password?token=${encodeURIComponent(token)}`);
    await this.send({
      to,
      subject: "Reset your Artify password",
      text: `Hi ${firstName},\n\nUse this link to choose a new password:\n${url}\n\nIt expires in ${config.passwordResetTokenTtlMinutes} minutes. If you did not ask for this, ignore this email.`,
      html: layout("Reset your password", `<p>Hi ${esc(firstName)}, use the button below to choose a new password. The link expires in ${config.passwordResetTokenTtlMinutes} minutes.</p>`, "Choose a new password", url),
    });
  },

  /** Sent instead of a second account when someone registers with an email that already exists — keeps the public response identical. */
  async sendAccountAlreadyExists(to: string, firstName: string): Promise<void> {
    const url = siteUrl("/");
    await this.send({
      to,
      subject: "You already have an Artify account",
      text: `Hi ${firstName},\n\nSomeone (hopefully you) tried to create an Artify account with this email address, but one already exists. You can sign in, or use "Forgot password" if you need to reset it: ${url}`,
      html: layout("You already have an account", `<p>Hi ${esc(firstName)}, someone tried to create an Artify account with this email address, but one already exists. Sign in, or use "Forgot password" to reset it.</p>`, "Go to Artify", url),
    });
  },
};
