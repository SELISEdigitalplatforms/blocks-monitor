import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { blocksConfig } from "@/blocks/config";
import { AuthScreen } from "@/components/signin/AuthScreen";

/**
 * Sign-up page: redirects to Blocks IAM hosted signup.
 * Same as SignIn but adds flow=signup to the initiate call.
 */
export default function SignUp() {
  const [params] = useSearchParams();
  const [error, setError] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let active = true;
    const { oidcClientId, oidcUrl } = blocksConfig();
    if (!oidcClientId || !oidcUrl) return;

    setRedirecting(true);
    const redirectUri = `${window.location.origin}/login/callback`;

    sessionStorage.setItem("madp-factory-oidc-attempt-v1", JSON.stringify({ returnTo: "/dashboard", at: Date.now() }));

    fetch(`/api/idp/initiate?redirectUri=${encodeURIComponent(redirectUri)}&flow=signup`)
      .then((res) => res.json())
      .then((data: { redirect_uri?: string }) => {
        if (!active) return;
        if (data.redirect_uri) {
          window.location.href = data.redirect_uri;
        } else {
          setError(true);
          setRedirecting(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setRedirecting(false);
      });

    return () => { active = false; };
  }, [params]);

  if (redirecting) {
    return (
      <AuthScreen mode="signup" content={
        <section aria-labelledby="auth-title" className="w-full">
          <h1 id="auth-title" className="text-[28px] font-medium leading-tight tracking-[-0.02em] sm:text-[32px]">
            Redirecting to create account…
          </h1>
          <p className="mt-2 text-[15px] text-ink2">Taking you to SELISE Blocks to create your account.</p>
        </section>
      } />
    );
  }

  return <AuthScreen mode="signup" />;
}
