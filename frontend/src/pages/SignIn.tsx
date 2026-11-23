import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { blocksConfig } from "@/blocks/config";
import { useSession } from "@/blocks/session";
import { AuthScreen } from "@/components/signin/AuthScreen";

/**
 * Sign-in page: if already signed in, redirect to dashboard.
 * Otherwise redirect to Blocks IAM hosted login.
 */
export default function SignIn() {
  const [params] = useSearchParams();
  const signedIn = useSession((s) => s.status === "signed-in");
  const [error, setError] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const next = params.get("next") || "/dashboard";

  // Already signed in — go straight to dashboard
  if (signedIn) return <Navigate to={next} replace />;

  // Fall back to embedded form if OIDC redirect failed or not configured
  if (error) return <AuthScreen mode="signin" />;

  return <SignInRedirect next={next} onError={() => setError(true)} />;
}

/** Triggers the OIDC redirect on mount. Separate component so the signed-in check above runs first. */
function SignInRedirect({ next, onError }: { next: string; onError: () => void }) {
  useEffect(() => {
    const { oidcClientId, oidcUrl } = blocksConfig();
    if (!oidcClientId || !oidcUrl) { onError(); return; }

    void import("@/blocks/iamRedirect").then(m => m.redirectToIamLogin()).catch(onError);
  }, [onError]);

  return (
    <AuthScreen mode="signin" content={
      <section aria-labelledby="auth-title" className="w-full">
        <h1 id="auth-title" className="text-[28px] font-medium leading-tight tracking-[-0.02em] sm:text-[32px]">
          Redirecting to sign in…
        </h1>
        <p className="mt-2 text-[15px] text-ink2">Taking you to SELISE Blocks to sign in securely.</p>
      </section>
    } />
  );
}
