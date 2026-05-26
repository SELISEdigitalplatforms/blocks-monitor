import { BlocksLoginPage } from "@/components/blocks-login-page";
import { showErrorToast } from "@/hooks/use-toast";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { useAuthStore } from "@/store/auth.store";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const [isStarting, setIsStarting] = useState(false);
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) navigate("/console", { replace: true });
  }, [isAuthenticated, navigate]);

  const startLogin = async () => {
    try {
      if (isStarting) return;
      setIsStarting(true);

      const blocksKey = getRuntimeEnv("BLOCKS_X_BLOCKS_KEY");
      const baseUrl = getRuntimeEnv("BLOCKS_IAM_BASE_URL");
      const clientId = getRuntimeEnv("BLOCKS_OIDC_CLIENT_ID");
      const redirectUri = getRuntimeEnv("BLOCKS_MONITOR_CALLBACK_URL", {
        stripPort: true,
        ensureTrailingSlash: false,
      });

      const initiateUrl = `${baseUrl}/api/idp/initiate?x-blocks-key=${blocksKey}&clientId=${clientId}&redirectUri=${redirectUri}`;
      const headers: Record<string, string> = {};
      if (blocksKey) headers["X-Blocks-Key"] = blocksKey;

      const response = await fetch(initiateUrl.toString(), { headers });
      const data = await response.json();

      if (data.redirect_uri) {
        window.location.href = data.redirect_uri;
      } else {
        showErrorToast({ errors: "Failed to get authorization URL" });
        setIsStarting(false);
      }
    } catch (errors) {
      console.error("Login initiation error:", errors);
      showErrorToast({ errors: "Unable to start login. Please try again." });
      setIsStarting(false);
    }
  };

  return (
    <BlocksLoginPage
      name="blocks-monitor"
      onLogin={startLogin}
      isLoading={isStarting}
    />
  );
}
