import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AuthScreen } from "@/components/signin/AuthScreen";
import { useSession } from "@/blocks/session";
import { Banner } from "@/ui/kit";
import { useT } from "@/i18n";

import { saveOidcSession } from "@/blocks/oidcSession";

// Prevents double execution from StrictMode. Reset on each full page load.
let callbackDone = false;
if (typeof window !== "undefined") window.addEventListener("pageshow", () => { callbackDone = false; });

export default function LoginCallback() {
  const t = useT();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (callbackDone) return;
    callbackDone = true;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    window.history.replaceState(null, "", "/login/callback");

    if (!code || !state || url.searchParams.has("error")) {
      setError(true);
      callbackDone = false;
      return;
    }

    fetch(`/api/idp/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null) as { ok?: boolean; data?: { accessToken?: string; profile?: Record<string, unknown>; expiresInSec?: number } } | null;
        if (!res.ok || !body?.ok || !body.data?.profile || !body.data?.accessToken) throw new Error(`${res.status}`);
        // Save access token + profile so all BFF calls and page reloads work
        saveOidcSession(body.data.accessToken, body.data.profile, body.data.expiresInSec ?? 3600);
        // Set session state directly
        const p = body.data.profile;
        useSession.setState({
          status: "signed-in",
          profile: {
            userId: String(p.userId || ""),
            email: String(p.email || ""),
            firstName: String(p.firstName || ""),
            lastName: String(p.lastName || ""),
            displayName: String(p.displayName || ""),
            roles: Array.isArray(p.roles) ? p.roles : [],
            permissions: Array.isArray(p.permissions) ? p.permissions : [],
            isSuperAdmin: p.isSuperAdmin === true,
          },
          notice: null,
        });
        window.location.replace("/dashboard");
      })
      .catch(() => {
        setError(true);
        callbackDone = false;
      });
  }, []);

  return <AuthScreen mode="signin" content={
    <section aria-labelledby="auth-title" className="w-full">
      <h1 id="auth-title" className="text-[28px] font-medium leading-tight tracking-[-0.02em] sm:text-[32px]">
        {error ? t("auth.callback.errorTitle", "Let's try that again") : t("auth.callback.title", "Signing you in…")}
      </h1>
      {error
        ? <><Banner tone="neutral" className="mt-6" title={t("auth.callback.errorText", "We couldn't finish signing you in. Please try again.")} />
          <Link to="/sign-in" className="mt-6 inline-block font-medium text-accent hover:underline">{t("auth.common.backToSignIn", "Back to sign in")}</Link></>
        : <p role="status" className="mt-2 text-[15px] text-ink2">{t("auth.callback.text", "Securely connecting you to your workspace.")}</p>}
    </section>
  } />;
}
