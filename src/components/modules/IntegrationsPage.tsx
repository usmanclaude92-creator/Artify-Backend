/** Phase 17 — Integrations hub: external services, outbound webhooks, and API keys. */
import React, { useState } from "react";
import { Plug } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { hasPermission } from "../../lib/permissions";
import { IntegrationsPanel } from "./integrations/IntegrationsPanel";
import { WebhooksPanel } from "./integrations/WebhooksPanel";
import { ApiKeysPanel } from "./integrations/ApiKeysPanel";

type Tab = "integrations" | "webhooks" | "keys";

export const IntegrationsPage: React.FC = () => {
  const { user } = useAuth();
  const perms = user?.role.permissions;
  const tabs = ([
    { id: "integrations", label: "Integrations", allowed: hasPermission(perms, "integrations.read") },
    { id: "webhooks", label: "Webhooks", allowed: hasPermission(perms, "webhooks.read") },
    { id: "keys", label: "API keys", allowed: hasPermission(perms, "api_keys.read") },
  ] as { id: Tab; label: string; allowed: boolean }[]).filter((t) => t.allowed);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "integrations");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Plug className="w-5 h-5" /> Integrations
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Connect external services, deliver signed webhooks and manage API access. Secrets are encrypted and never displayed after creation.
        </p>
      </div>
      <div className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }} role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="px-3 py-2 text-xs font-semibold border-b-2 -mb-px" style={{ borderColor: tab === t.id ? "var(--accent, #7c3aed)" : "transparent", color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)" }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "integrations" && <IntegrationsPanel />}
      {tab === "webhooks" && <WebhooksPanel />}
      {tab === "keys" && <ApiKeysPanel />}
    </div>
  );
};
