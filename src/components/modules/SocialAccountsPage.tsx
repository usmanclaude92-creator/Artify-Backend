/** Social Media → Connected Accounts. Tokens are never shown or fetched; the API returns profile + status only. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link2, RefreshCw, Unplug, Activity, AlertTriangle } from "lucide-react";
import { socialApi, type ConnectSelection, type SocialAccountSummary, type SocialProviderInfo } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, Badge, LoadingState, ErrorState, EmptyState, ConfirmDialog } from "../ui/ui";
import { ProviderAvatar, StatusBadge, expiresSoon, timeAgo } from "./socialShared";
import { ConnectPagePicker } from "./ConnectPagePicker";
import { FacebookSetupPanel } from "./FacebookSetupPanel";

const SOCIAL_ACCOUNTS_PATH = "/social/accounts";

export const SocialAccountsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { current } = useActiveWorkspace();
  const canManage = hasPermission(user?.role.permissions, "social.accounts.manage");

  const [accounts, setAccounts] = useState<SocialAccountSummary[]>([]);
  const [providers, setProviders] = useState<SocialProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<SocialAccountSummary | null>(null);
  const [selection, setSelection] = useState<ConnectSelection | null>(null);
  const handledCallback = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await socialApi.list();
      setAccounts(res.accounts);
      setProviders(res.providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connected accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the active workspace changes (data is scoped to it server-side).
  useEffect(() => {
    void load();
  }, [load, current?.organizationId]);

  // OAuth return: the provider sends the browser back here with ?state=&code= — finish the connection once, then clean the URL.
  useEffect(() => {
    if (handledCallback.current || !canManage) return;
    const params = new URLSearchParams(window.location.search);
    const state = params.get("state");
    if (!state) return;
    handledCallback.current = true;
    const code = params.get("code") ?? undefined;
    const providerError = params.get("error") ?? undefined;
    window.history.replaceState({}, "", SOCIAL_ACCOUNTS_PATH);
    socialApi
      .completeConnect({ state, code, error: providerError })
      .then((res) => {
        if (res.selection) {
          setSelection(res.selection); // several Pages: let the person choose which to connect
          return undefined;
        }
        notify(`${res.account!.displayName} connected.`, "success");
        res.warnings?.forEach((w) => notify(w, "error"));
        return load();
      })
      .catch((err) => notify(err instanceof ApiClientError ? err.message : "Could not complete the connection.", "error"));
  }, [canManage, load, notify]);

  const startConnect = async (provider: string) => {
    setBusy(`connect:${provider}`);
    try {
      const { authUrl } = await socialApi.startConnect(provider);
      window.location.assign(authUrl);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not start the connection.", "error");
      setBusy(null);
    }
  };

  const reconnect = async (account: SocialAccountSummary) => {
    setBusy(`reconnect:${account.id}`);
    try {
      const { authUrl } = await socialApi.reconnect(account.id);
      window.location.assign(authUrl);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not start reconnecting.", "error");
      setBusy(null);
    }
  };

  const check = async (account: SocialAccountSummary) => {
    setBusy(`health:${account.id}`);
    try {
      const res = await socialApi.checkHealth(account.id);
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? res.account : a)));
      notify(res.account.status === "CONNECTED" ? "Connection is healthy." : "This account needs attention.", res.account.status === "CONNECTED" ? "success" : "error");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Health check failed.", "error");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    const account = confirmDisconnect;
    if (!account) return;
    setBusy(`disconnect:${account.id}`);
    try {
      const res = await socialApi.disconnect(account.id);
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? res.account : a)));
      notify(`${account.displayName} disconnected.`, "success");
      setConfirmDisconnect(null);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not disconnect.", "error");
    } finally {
      setBusy(null);
    }
  };

  const providerLabel = (key: string) => providers.find((p) => p.key === key)?.label ?? key;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Link2 className="w-5 h-5" /> Connected Accounts
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Social profiles and pages connected to {current?.organizationName ?? "this workspace"}. Access tokens are stored encrypted and are never shown.
        </p>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Connect a network
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {providers.map((p) => (
                <li key={p.key} className="cc-field flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {p.label}
                    </span>
                    <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {p.available ? "Ready to connect" : p.configured ? "Coming soon" : "Not configured"}
                    </span>
                  </span>
                  {p.available ? (
                    <Button variant="primary" disabled={!canManage || busy === `connect:${p.key}`} onClick={() => void startConnect(p.key)} aria-label={`Connect ${p.label}`}>
                      Connect
                    </Button>
                  ) : (
                    <Badge tone="neutral">Not configured</Badge>
                  )}
                </li>
              ))}
            </ul>
            {!canManage && (
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                You can view connected accounts but need the &ldquo;manage social accounts&rdquo; permission to change them.
              </p>
            )}
          </Card>

          {canManage && providers.some((p) => p.key === "meta_facebook") && <FacebookSetupPanel provider="meta_facebook" />}

          {accounts.length === 0 ? (
            <Card>
              <EmptyState
                title="No accounts connected yet"
                description="Choose a network above and sign in to authorize it. Once connected, the account appears here with its status. Providers marked “Not configured” need app credentials from your administrator first."
              />
            </Card>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {accounts.map((account) => (
                <li key={account.id}>
                  <Card className="p-4 space-y-3 h-full">
                    <div className="flex items-start gap-3">
                      <ProviderAvatar account={account} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                          {account.displayName}
                        </p>
                        <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                          {account.handle ?? account.externalAccountId} · {providerLabel(account.provider)}
                        </p>
                      </div>
                      <StatusBadge status={account.status} />
                    </div>

                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Last sync {timeAgo(account.lastSyncAt)}
                      {account.tokenExpiresAt && account.status === "CONNECTED" && <> · token expires {new Date(account.tokenExpiresAt).toLocaleDateString()}</>}
                    </p>

                    {(account.lastError && account.status !== "CONNECTED" && account.status !== "DISCONNECTED") || expiresSoon(account) ? (
                      <p className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }} role="status">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                        <span>{account.lastError && account.status !== "CONNECTED" ? account.lastError : "This connection expires within 7 days."}</span>
                      </p>
                    ) : null}

                    {canManage && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {account.status !== "CONNECTED" || expiresSoon(account) ? (
                          <Button variant="primary" disabled={busy === `reconnect:${account.id}`} onClick={() => void reconnect(account)}>
                            <RefreshCw className="w-3.5 h-3.5" /> Reconnect
                          </Button>
                        ) : (
                          <Button variant="secondary" disabled={busy === `reconnect:${account.id}`} onClick={() => void reconnect(account)}>
                            <RefreshCw className="w-3.5 h-3.5" /> Reconnect
                          </Button>
                        )}
                        {account.status !== "DISCONNECTED" && (
                          <>
                            <Button variant="secondary" disabled={busy === `health:${account.id}`} onClick={() => void check(account)}>
                              <Activity className="w-3.5 h-3.5" /> Check now
                            </Button>
                            <Button variant="danger" disabled={busy === `disconnect:${account.id}`} onClick={() => setConfirmDisconnect(account)}>
                              <Unplug className="w-3.5 h-3.5" /> Disconnect
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <ConnectPagePicker selection={selection} onClose={() => setSelection(null)} onConnected={() => void load()} />

      <ConfirmDialog
        open={!!confirmDisconnect}
        title="Disconnect account?"
        message={`Disconnect ${confirmDisconnect?.displayName ?? "this account"}? Its stored access tokens are deleted. You can reconnect it later.`}
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => void disconnect()}
        onCancel={() => setConfirmDisconnect(null)}
      />
    </div>
  );
};
