import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthScreen } from "@/components/signin/AuthScreen";
import { VerifyEmailView } from "@/components/signin/VerifyEmailView";

/** The page behind the activation link: ?code=… from an invitation e-mail (set a password), ?token=… from the sign-up
 *  e-mail (confirm the address). The sign-up token leaves the address bar at once (history, shared screens, Referer). */
export default function Activate() {
  const [params] = useSearchParams();
  const [token] = useState(() => {
    const t = params.get("token");
    if (t !== null) window.history.replaceState(null, "", "/activate?confirm=1");
    // a reload of the cleaned address: the link has to be opened from the e-mail again
    return t ?? (params.get("confirm") === "1" ? "" : null);
  });
  return token !== null
    ? <AuthScreen mode="activate" content={<VerifyEmailView token={token} leaving={false} />} />
    : <AuthScreen mode="activate" />;
}
