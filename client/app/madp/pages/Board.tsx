import { Navigate, useLocation, useParams } from "react-router-dom";
import { useProjectPage } from "@/madp/components/project/useProjectPage";
import { legacyBoardTarget } from "@/madp/components/project/legacyBoard";
import { rewritePath } from "@/madp/lib/pathPrefix";

/** Legacy /p/:id/board link: the Board is now the first tab of the Build step, so it redirects to Build → Board (keeping e.g. ?ticket=); any other id goes to the project list. */
export default function Board() {
  const page = useProjectPage();
  const { id = "" } = useParams();
  const { search } = useLocation();
  if (page.kind === "unknown") return <Navigate to={rewritePath("/projects")} replace />;
  return <Navigate to={legacyBoardTarget(id, search)} replace />;
}
