import { DashboardView } from "@/components/dashboard/DashboardView";
import { WelcomeBanner } from "@/components/signin/WelcomeBanner";

export default function Dashboard() {
  return (
    <>
      <WelcomeBanner />
      <DashboardView />
    </>
  );
}
