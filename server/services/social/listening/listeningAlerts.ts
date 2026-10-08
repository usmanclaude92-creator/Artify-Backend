/** Alerts for negative or crisis-flagged mentions/reviews through the existing notification bell. A burst makes ONE grouped notification per person per window. */
import { prisma } from "../../../db/prisma";
import { logger } from "../../../core/logger";
import { notificationService } from "../../notificationService";
import { repliers, auditInbox, safeText } from "../inbox/inboxCore";
import { redactPreview } from "../inbox/inboxPolicy";
import { ALERT_WINDOW_MS, type AlertReason } from "./listeningPolicy";

export const ALERT_TYPE = "social_listening_alert";
const groupedMessage = (n: number) => `${n} new negative or crisis-flagged items need attention. Open Social Media → Listening.`;
const countOf = (message: string): number => Number(/^(\d+) new /.exec(message)?.[1] ?? 1);

/**
 * Notifies everyone who can work the inbox (social.reply). Within ALERT_WINDOW_MS the previous alert is updated in place ("3 new …") and marked
 * unread again instead of creating another row. Message text is never in the notification beyond a ≤40-char redacted preview of the first item.
 */
export async function raiseListeningAlert(organizationId: string, conversationId: string, reason: AlertReason, previewSource?: string, now = new Date()): Promise<{ notified: number; grouped: number }> {
  const out = { notified: 0, grouped: 0 };
  try {
    const users = await repliers(organizationId);
    const since = new Date(now.getTime() - ALERT_WINDOW_MS);
    const preview = previewSource ? redactPreview(previewSource) : "";
    for (const userId of users) {
      const recent = await prisma.notification.findFirst({ where: { organizationId, userId, type: ALERT_TYPE, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
      if (recent) {
        const n = countOf(recent.message) + 1;
        await prisma.notification.update({ where: { id: recent.id }, data: { title: `${n} items need attention (Listening)`, message: groupedMessage(n), status: "UNREAD", readAt: null } });
        out.grouped += 1;
      } else {
        await notificationService.notify({
          organizationId, userId, type: ALERT_TYPE,
          title: reason === "crisis" ? "Crisis-flagged item in Listening" : "Negative mention or review in Listening",
          message: preview ? `“${preview}”` : "Open Social Media → Listening to see it.", entityType: "social_conversation", entityId: conversationId,
        });
        out.notified += 1;
      }
    }
    await auditInbox(organizationId, "SOCIAL_LISTENING_ALERT", conversationId, { reason, recipients: users.length, grouped: out.grouped }, null);
  } catch (err) {
    logger.warn({ conversationId, err: safeText(err) }, "[social-listening] alert skipped");
  }
  return out;
}
