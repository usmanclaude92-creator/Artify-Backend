/** "Facebook Page setup": the Meta app settings to configure. Shows whether each secret is set, never its value. */
import React, { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Copy, XCircle } from "lucide-react";
import { socialApi, type ProviderSetupView } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, ErrorState, LoadingState } from "../ui/ui";

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-3 py-2">
    <dt className="text-[11px] font-bold uppercase" style={{ color: "var(--text-muted)" }}>{label}</dt>
    <dd className="text-xs min-w-0 break-words [overflow-wrap:anywhere]" style={{ color: "var(--text-primary)" }}>{children}</dd>
  </div>
);

const MODE_LABEL = { development: "Development mode", live: "Live mode", unknown: "Mode unknown" } as const;

export const FacebookSetupPanel: React.FC<{ provider: string }> = ({ provider }) => {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<ProviderSetupView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !setup) socialApi.providerSetup(provider).then(setSetup).catch((e) => setError(e instanceof Error ? e.message : "Could not load the setup guide."));
  };
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => notify(`${what} copied.`, "success")).catch(() => notify("Copy failed.", "error"));
  const Copyable: React.FC<{ value: string; what: string }> = ({ value, what }) => (
    <span className="inline-flex items-center gap-2 flex-wrap"><code className="px-1.5 py-0.5 rounded break-all" style={{ background: "var(--bg-hover)" }}>{value}</code>
      <Button variant="ghost" onClick={() => void copy(value, what)} aria-label={`Copy ${what}`}><Copy className="w-3.5 h-3.5" /></Button></span>
  );

  return (
    <Card className="p-4 space-y-2" aria-label="Facebook Page setup">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-2 text-sm font-bold w-full text-left" style={{ color: "var(--text-primary)" }}>
        {open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />} Facebook Page setup
      </button>
      {open && (error ? <ErrorState message={error} /> : !setup ? <LoadingState /> : (
        <dl className="divide-y" style={{ borderColor: "var(--border)" }}>
          <Row label="Status">{setup.configured ? <Badge tone="success">App ID and secret set</Badge> : <Badge tone="warning">Not configured</Badge>} <Badge tone={setup.appMode === "live" ? "success" : "info"}>{MODE_LABEL[setup.appMode]}</Badge> <span style={{ color: "var(--text-muted)" }}>· Graph API {setup.apiVersion}</span></Row>
          <Row label="Valid OAuth redirect URI"><Copyable value={setup.redirectUri} what="Redirect URI" /></Row>
          <Row label="Webhook callback URL"><Copyable value={setup.webhookCallbackUrl} what="Callback URL" /></Row>
          <Row label="Webhook verify token">{setup.verifyTokenConfigured ? <span><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline mr-1 align-text-bottom" aria-hidden="true" />Set. Paste the value of <code>{setup.verifyTokenEnvVar}</code> into the Verify Token field.</span> : <span><XCircle className="w-3.5 h-3.5 text-rose-500 inline mr-1 align-text-bottom" aria-hidden="true" />Not set. Set <code>{setup.verifyTokenEnvVar}</code> first; the handshake is refused without it.</span>}</Row>
          <Row label="Webhook fields (Page object)">{setup.webhookFields.join(", ")}</Row>
          <Row label="Permissions">
            <ul className="flex gap-1.5 flex-wrap">{setup.permissions.map((p) => <li key={p.name}><Badge tone={p.required ? "info" : "neutral"}>{p.name}{p.required ? " · required" : ""}</Badge></li>)}</ul>
          </Row>
          <Row label="Environment">
            <ul className="space-y-0.5">{setup.envVars.map((e) => <li key={e.name} className="flex items-center gap-1.5">{e.set ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" /> : <XCircle className="w-3.5 h-3.5 text-rose-500" aria-hidden="true" />}<code>{e.name}</code></li>)}</ul>
          </Row>
          <Row label="Notes"><ul className="list-disc pl-4 space-y-1" style={{ color: "var(--text-secondary)" }}>{setup.notes.map((n) => <li key={n}>{n}</li>)}</ul></Row>
        </dl>
      ))}
    </Card>
  );
};
