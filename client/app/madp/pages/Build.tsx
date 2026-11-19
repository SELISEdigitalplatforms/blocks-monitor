import { Navigate } from "react-router-dom";
import { useProjectPage } from "@/madp/components/project/useProjectPage";
import { BuildView } from "@/madp/components/build/BuildView";
import { rewritePath } from "@/madp/lib/pathPrefix";

/** The factory at work on the workspace's request; any other id goes to the project list. */
export default function Build() {
  const page = useProjectPage();
  if (page.kind === "unknown") return <Navigate to={rewritePath("/projects")} replace />;
  return <BuildView />;
}
