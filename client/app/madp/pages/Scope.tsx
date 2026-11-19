import { Navigate } from "react-router-dom";
import { useProjectPage } from "@/madp/components/project/useProjectPage";
import { ScopeView } from "@/madp/components/scope/ScopeView";
import { rewritePath } from "@/madp/lib/pathPrefix";

/** The scope document, with its one next step beside it: start the build. Like the build and the live page, any other
 *  id goes to the project list; opened before the scope exists, the page says so in place. */
export default function Scope() {
  const page = useProjectPage();
  if (page.kind === "unknown") return <Navigate to={rewritePath("/projects")} replace />;
  return <ScopeView />;
}
