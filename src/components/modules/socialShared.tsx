import React from "react";
import { Badge } from "../ui/ui";
import type { SocialAccountStatus, SocialAccountSummary } from "../../lib/api";

export const STATUS_TONE: Record<SocialAccountStatus, "success" | "warning" | "danger" | "neutral"> = {
  CONNECTED: "success",
  NEEDS_REAUTH: "warning",
  ERROR: "danger",
  DISCONNECTED: "neutral",
};
export const STATUS_LABEL: Record<SocialAccountStatus, string> = {
  CONNECTED: "Connected",
  NEEDS_REAUTH: "Needs reconnect",
  ERROR: "Error",
  DISCONNECTED: "Disconnected",
};

export const StatusBadge: React.FC<{ status: SocialAccountStatus }> = ({ status }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export function expiresSoon(account: SocialAccountSummary): boolean {
  return account.status === "CONNECTED" && !!account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() - Date.now() < EXPIRY_WARNING_MS;
}

export const ProviderAvatar: React.FC<{ account: Pick<SocialAccountSummary, "displayName" | "avatarUrl"> }> = ({ account }) =>
  account.avatarUrl ? (
    <img src={account.avatarUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
  ) : (
    <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent-soft-text)" }} aria-hidden="true">
      {account.displayName.charAt(0).toUpperCase()}
    </span>
  );
