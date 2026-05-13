import LoadingSpinner from "@/components/loader-spinner/loader-spinner";
import { githubInfoService } from "@blocks-observability/services/github-info.service";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export default function CallbackPage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const [projectKey] = useState(
    () => localStorage.getItem("github_auth_project_key") || "",
  );

  const { isLoading, isSuccess } = useQuery({
    queryKey: ["github-verification", code, projectKey],
    queryFn: () =>
      githubInfoService.verifyAuthorization(code || "", projectKey),
    enabled: !!code && !!projectKey,
    retry: false,
  });

  useEffect(() => {
    if (isSuccess) {
      localStorage.setItem("isReload", "true");

      // Clean up stored auth data
      localStorage.removeItem("github_auth_state");
      localStorage.removeItem("github_auth_project_key");
      localStorage.removeItem("github_auth_destination");

      if (typeof window !== "undefined") {
        window.close();
      }
    }
  }, [isSuccess]);

  if (isLoading) {
    return <LoadingSpinner variant="fullscreen" />;
  }

  if (isSuccess) {
    return null;
  }

  return null;
}
