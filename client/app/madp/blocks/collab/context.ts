// The ONE adapter of the collaboration web data onto the projects context and the router.
// Never imports src/state/**.
import { useLocation } from "react-router-dom";
import { useProjectsContext, useCan, useMemberName } from "../projects/context";
import { useProjectList } from "../projects/reads";
import { isBlocksProjectId } from "../../domain/projects";

export { useCan, useMemberName, isBlocksProjectId };

export function useCollabContext() {
  return useProjectsContext();
}

const ROUTE = /^[/]p[/]([^/]+)/;

/** The id of /p/:id, or null. */
export function useRouteProjectId(): string | null {
  const { pathname } = useLocation();
  const m = ROUTE.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The route project id, only when it is a Blocks id. */
export function useRouteBlocksProjectId(): string | null {
  const id = useRouteProjectId();
  return id !== null && isBlocksProjectId(id) ? id : null;
}

/** Route Blocks project, else the most recently updated active Blocks project of the workspace, else null. */
export function useCurrentBlocksProjectId(): string | null {
  const routeId = useRouteBlocksProjectId();
  const list = useProjectList();
  if (routeId) return routeId;
  const first = (list.data ?? []).find((p) => p.status !== "deleting" && isBlocksProjectId(p.id));
  return first ? first.id : null;
}
