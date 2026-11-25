import { DashboardView } from "@/components/dashboard/DashboardView";
import { BlocksDashboard } from "@/components/dashboard/BlocksDashboard";
import { WelcomeBanner } from "@/components/signin/WelcomeBanner";

function hasOidcSession(): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem("madp-oidc-session-v1");
    return raw !== null && raw !== undefined;
  } catch { return false; }
}

export default function Dashboard() {
  if (hasOidcSession()) return <BlocksDashboard />;
  return (
    <>
      <WelcomeBanner />
      <DashboardView />
    </>
  );
}
