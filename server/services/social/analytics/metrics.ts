/**
 * Canonical analytics vocabulary. Network metric names change (impressions → views, plays → views, fans → followers), so the platform stores
 * these stable keys and each connector maps its current names onto them. A metric the network no longer offers is stored as NULL + reason, never 0.
 */
export type MetricKind = "level" | "flow";

export interface MetricDef {
  key: string;
  label: string;
  /** level = a total at a point in time (followers); flow = an amount per day (reach, views, …). */
  kind: MetricKind;
  description: string;
}

export const ACCOUNT_METRICS: readonly MetricDef[] = [
  { key: "followers", label: "Followers", kind: "level", description: "Total followers (Instagram) or followers/fans (Facebook Page) on the day it was captured." },
  { key: "follows_new", label: "New followers", kind: "flow", description: "New follows that day, as reported by the network." },
  { key: "unfollows", label: "Unfollows", kind: "flow", description: "Unfollows that day, as reported by the network (Facebook Pages; estimated by Meta)." },
  { key: "reach", label: "Reach", kind: "flow", description: "Unique accounts that saw your content that day." },
  { key: "views", label: "Views", kind: "flow", description: "Times your content was viewed that day (replaces the retired \"impressions\" and \"plays\")." },
  { key: "engagement", label: "Engagement", kind: "flow", description: "Interactions with your content that day (Facebook: post engagements; Instagram: total interactions)." },
  { key: "profile_views", label: "Profile views", kind: "flow", description: "Times your profile/Page was viewed that day." },
  { key: "link_clicks", label: "Link clicks", kind: "flow", description: "Taps on the website link of your profile that day (Instagram)." },
] as const;

export const POST_METRICS: readonly MetricDef[] = [
  { key: "reach", label: "Reach", kind: "level", description: "Unique accounts that saw the post (lifetime, at capture time)." },
  { key: "views", label: "Views", kind: "level", description: "Times the post was viewed (lifetime, at capture time)." },
  { key: "likes", label: "Likes", kind: "level", description: "Likes/reactions (lifetime, at capture time)." },
  { key: "comments", label: "Comments", kind: "level", description: "Comments (lifetime, at capture time)." },
  { key: "shares", label: "Shares", kind: "level", description: "Shares/reposts (lifetime, at capture time). Empty when the network omits it." },
  { key: "saves", label: "Saves", kind: "level", description: "Saves (Instagram, lifetime, at capture time)." },
  { key: "interactions", label: "Interactions", kind: "level", description: "Likes + comments + shares (+ saves on Instagram) when the network reports them." },
] as const;

export const ACCOUNT_METRIC_KEYS = ACCOUNT_METRICS.map((m) => m.key);
export const POST_METRIC_KEYS = POST_METRICS.map((m) => m.key);
export const metricLabel = (key: string): string => [...ACCOUNT_METRICS, ...POST_METRICS].find((m) => m.key === key)?.label ?? key;

/** Providers that can ever have analytics, and the honest reason for those that cannot. */
export const NO_ANALYTICS_REASON: Record<string, string> = {
  linkedin: "LinkedIn only shares post and follower analytics through its Community Management API (permission r_member_postAnalytics), which this app does not have. Nothing is read from LinkedIn.",
  mock: "The mock provider has no analytics.",
};
