import { mockProvider } from "./mockProvider";
import { linkedinProvider, metaProvider } from "./stubProviders";
import type { SocialConnector } from "./types";

const CONNECTORS: SocialConnector[] = [metaProvider, linkedinProvider, mockProvider];

export interface ProviderInfo {
  key: string;
  label: string;
  /** Credentials present in this environment. */
  configured: boolean;
  /** Configured AND implemented: the UI offers "Connect" only when true. */
  available: boolean;
}

export const connectorRegistry = {
  get(key: string): SocialConnector | undefined {
    return CONNECTORS.find((c) => c.key === key);
  },
  /** Connectors that may actually be used to connect/refresh/health-check right now. */
  getAvailable(key: string): SocialConnector | undefined {
    const c = this.get(key);
    return c && c.isConfigured() && c.implemented ? c : undefined;
  },
  list(): ProviderInfo[] {
    return CONNECTORS.filter((c) => c.key !== "mock" || c.isConfigured()).map((c) => ({
      key: c.key,
      label: c.label,
      configured: c.isConfigured(),
      available: c.isConfigured() && c.implemented,
    }));
  },
};
