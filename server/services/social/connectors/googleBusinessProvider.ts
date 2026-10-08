/**
 * Google Business Profile reviews — NOT built, on purpose. Fails closed: never configured, never available, every capability throws "not supported".
 * Why: the API needs Google's approval (a verified Business Profile active for 60+ days, a website, and the GBP API access request, reviewed in about 14 days;
 * a project quota of 0 QPM means "not approved"). Steps to get access and what to build afterwards: docs/SOCIAL_LISTENING.md §6.
 */
import { ConnectorNotImplementedError, DEFAULT_CONSTRAINTS } from "./types";
import { stub } from "./stubProviders";

const base = stub("google_business", "Google Business Profile", () => false, ["https://www.googleapis.com/auth/business.manage"], () => ({ ...DEFAULT_CONSTRAINTS }));

export const googleBusinessProvider = {
  ...base,
  async fetchReviewSummary(): Promise<never> { throw new ConnectorNotImplementedError("Google Business Profile", "reading reviews (API access not approved)"); },
  replyCapability: () => ({ mode: "platform" as const, reason: "Google Business Profile is not connected (API access not approved). Reply on Google." }),
};
