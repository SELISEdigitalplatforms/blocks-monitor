import { Navigate } from "react-router-dom";
import { useProjectPage } from "@/components/project/useProjectPage";
import { DeliveryView } from "@/components/delivery/DeliveryView";

/** The Release page: the release to production, the live app and the showcase report to share with stakeholders. */
export default function Delivered() {
  const page = useProjectPage();
  if (page.kind === "unknown") return <Navigate to="/projects" replace />;
  return <DeliveryView />;
}
