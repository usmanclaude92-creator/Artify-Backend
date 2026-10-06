/**
 * /auth/callback?code=… — landing page for staff who signed in on the public site (artifysols.com).
 * The single-use code is stripped from the address bar immediately, exchanged for a fresh session, and
 * discarded. A bad/expired/reused code falls back to the normal sign-in page.
 */
import React, { useEffect, useRef, useState } from "react";
import { authApi } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { Button, Spinner } from "../ui/ui";

export const HandoffCallbackPage: React.FC = () => {
  const { setSessionFromAcceptedInvitation } = useAuth();
  const { navigate } = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = new URLSearchParams(window.location.search).get("code") ?? "";
    window.history.replaceState({}, "", window.location.pathname);
    if (!code) {
      setError("This sign-in link is missing its code. Please sign in again.");
      return;
    }
    authApi
      .exchangeHandoff(code)
      .then((res) => {
        setSessionFromAcceptedInvitation(res.session.token, res.user);
        navigate("/dashboard");
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : "Could not complete sign-in. Please try again."));
  }, [navigate, setSessionFromAcceptedInvitation]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      {error ? (
        <div className="max-w-sm text-center space-y-4">
          <p className="text-sm" role="alert">{error}</p>
          <Button onClick={() => navigate("/login")}>Go to sign in</Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3" role="status">
          <Spinner />
          <p className="text-xs">Signing you in…</p>
        </div>
      )}
    </div>
  );
};
