import { DashboardView } from "@/madp/components/dashboard/DashboardView";
import { WelcomeBanner } from "@/madp/components/signin/WelcomeBanner";

export default function Dashboard() {
  return (
    <>
      <WelcomeBanner />
      <DashboardView />
    </>
  );
}
