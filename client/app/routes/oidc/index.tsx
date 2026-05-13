import LoadingSpinner from "@/components/loader-spinner/loader-spinner";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { useAuthStore } from "@/store/auth.store.ts";
import { OIDCSignin } from "@blocks-idp/authentication/pages/oidc/oidc-signin";
import { OIDCPermissionWrapper } from "@blocks-idp/authentication/pages/oidc/permission-wrapper";
import { authService } from "@blocks-idp/authentication/services/auth.service";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function OidcIndexPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuthenticated, setTokens } = useAuthStore();

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const userName = searchParams.get("userName");

  useEffect(() => {
    if (!code || !state) return;

    authService
      .verifyOidc({ code, state })
      .then((res) => {
        const isLocalhost = getRuntimeEnv("BLOCKS_API_BASE_URL")?.includes(
          "localhost",
        );

        if (isLocalhost && res.access_token && res.refresh_token) {
          setTokens(res.access_token, res.refresh_token);
        }
        setAuthenticated();

        window.location.href = `${window.location.origin}/health`;
      })
      .catch(() => {
        navigate("/oidc/error");
      });
  }, [code, state, navigate, setAuthenticated, setTokens]);

  if (code && state) {
    return <LoadingSpinner variant="overlay" label="Loading..." />;
  }

  if (userName && userName.trim() !== "") {
    return <OIDCPermissionWrapper />;
  }

  return <OIDCSignin />;
}
