import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthScreen } from "@/madp/components/signin/AuthScreen";
import { completeHostedLogin } from "@/madp/blocks/oidc";
import { restoreSession, useSession } from "@/madp/blocks/session";
import { Banner } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";

/** Reuse the existing auth card while IAM completes the secure session. */
export default function LoginCallback() {
  const t = useT();
  const navigate = useNavigate();
  const callback = useRef(window.location.href);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    // Remove the one-time code/state from the address bar before rendering other links.
    window.history.replaceState(null, "", "/login/callback");
    void completeHostedLogin(callback.current).then(async (returnTo) => {
      await restoreSession(true);
      if (useSession.getState().status !== "signed-in") throw new Error("Session unavailable");
      if (active) navigate(returnTo, { replace: true });
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [navigate]);
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
