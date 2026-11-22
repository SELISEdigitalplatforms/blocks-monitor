import { Navigate } from "react-router-dom";
import { useProjectPage } from "@/components/project/useProjectPage";
import { BuildView } from "@/components/build/BuildView";

/** The factory at work on the workspace's request; any other id goes to the project list. */
export default function Build() {
  const page = useProjectPage();
  if (page.kind === "unknown") return <Navigate to="/projects" replace />;
  return <BuildView />;
}
