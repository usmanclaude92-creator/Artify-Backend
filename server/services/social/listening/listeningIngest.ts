/** Ingest-side helpers for mentions and reviews: fetch the content behind an id-only webhook, and flag crisis words as soon as an item is stored. */
import type { SocialAccount } from "@prisma/client";
import { prisma } from "../../../db/prisma";
import { logger } from "../../../core/logger";
import { connectorRegistry } from "../connectors/registry";
import type { InboundEvent } from "../connectors/types";
import { socialAccountService } from "../socialAccountService";
import { auditInbox, safeText } from "../inbox/inboxCore";
import { raiseListeningAlert } from "./listeningAlerts";
import { CRISIS_TAG, detectCrisis } from "./listeningPolicy";

export const UNRESOLVED_TEXT = "[Mention — its content could not be loaded. Open it on the network to read it.]";

/** Webhooks like Instagram's `mentions` only carry ids. Fetches the text/author; if the network refuses, the item is still stored (with a placeholder) so it is not lost. */
export async function resolveMentionEvent(account: Pick<SocialAccount, "id" | "provider" | "externalAccountId">, ev: InboundEvent): Promise<InboundEvent> {
  if (!ev.lookup) return ev;
  const connector = connectorRegistry.getAvailable(account.provider);
  if (!connector?.resolveMention) return { ...ev, text: ev.text || UNRESOLVED_TEXT };
  try {
    const tokens = await socialAccountService.loadTokens(account.id);
    if (!tokens) return { ...ev, text: ev.text || UNRESOLVED_TEXT };
    const r = await connector.resolveMention(tokens, { accountExternalId: account.externalAccountId, lookup: ev.lookup });
    if (!r) return { ...ev, text: ev.text || UNRESOLVED_TEXT };
    return { ...ev, text: r.text || ev.text || UNRESOLVED_TEXT, participant: { ...ev.participant, ...r.participant }, createdAt: r.createdAt ?? ev.createdAt, permalink: r.permalink ?? ev.permalink, subjectRef: r.subjectRef ?? ev.subjectRef };
  } catch (err) {
    logger.warn({ accountId: account.id, err: safeText(err) }, "[social-listening] mention content could not be loaded");
    return { ...ev, text: ev.text || UNRESOLVED_TEXT };
  }
}

/** After a NEW mention/review is stored: deterministic crisis check (works without AI). Crisis → URGENT, needs a human, tagged, and one (grouped) alert. */
export async function afterListeningIngest(account: Pick<SocialAccount, "id" | "organizationId">, ev: InboundEvent, result: { duplicate: boolean; conversationId: string }): Promise<void> {
  if (result.duplicate || (ev.type !== "MENTION" && ev.type !== "REVIEW")) return;
  const hits = detectCrisis(ev.text);
  if (hits.length === 0) return;
  const conv = await prisma.socialConversation.findUnique({ where: { id: result.conversationId }, select: { tags: true } });
  if (!conv) return;
  await prisma.socialConversation.update({ where: { id: result.conversationId }, data: { priority: "URGENT", needsHuman: true, tags: [...new Set([...conv.tags, CRISIS_TAG])] } });
  await auditInbox(account.organizationId, "SOCIAL_LISTENING_CRISIS_FLAGGED", result.conversationId, { words: hits, type: ev.type }, null);
  await raiseListeningAlert(account.organizationId, result.conversationId, "crisis", ev.text);
}
