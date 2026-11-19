import { Navigate } from "react-router-dom";
import { useProjectPage } from "@/madp/components/project/useProjectPage";
import { DeliveryView } from "@/madp/components/delivery/DeliveryView";
import { rewritePath } from "@/madp/lib/pathPrefix";

/** The Release page: the release to production, the live app and the showcase report to share with stakeholders. */
export default function Delivered() {
  const page = useProjectPage();
  if (page.kind === "unknown") return <Navigate to={rewritePath("/projects")} replace />;
  return <DeliveryView />;
}
