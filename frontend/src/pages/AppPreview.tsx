import { useLayoutEffect } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { guardRedirect, signInRedirect } from "@/blocks/guard";
import { useSession } from "@/blocks/session";
import { appEnvironmentOf } from "@/domain/appPreview";
import { useDemo } from "@/state/store";
import { AppPreview } from "@/components/preview/AppPreview";

/** A deployed version as its own app, full screen and outside the shell; the same sign-in guard as the app. */
export default function AppPreviewPage() {
  const { projectId = "", version = "" } = useParams();
  const [params] = useSearchParams();
  const { pathname, search } = useLocation();
  const status = useSession((s) => s.status);
  const mustChange = useSession((s) => s.status === "signed-in" && s.profile?.mustChangePassword === true);
  const theme = useDemo((s) => s.theme);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    delete document.documentElement.dataset.firstPaint;
  }, [theme]);
  if (mustChange) return <Navigate to={signInRedirect(pathname, search)} replace />;
  if (status === "restoring") return <div aria-busy="true" className="min-h-screen bg-canvas" />;
  const to = guardRedirect(pathname, search, status);
  if (to) return <Navigate to={to} replace />;
  return <AppPreview key={`${projectId}/${version}/${params.get("env") ?? ""}`} projectId={projectId} version={version} environment={appEnvironmentOf(params.get("env"))} />;
}
