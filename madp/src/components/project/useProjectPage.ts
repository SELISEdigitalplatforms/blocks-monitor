import { isBlocksProjectId } from "@/domain/projects";
import { useParams } from "react-router-dom";

export type ProjectPage = { kind: "project"; id: string } | { kind: "unknown" };

/** Which project a /p/:id/* page shows: a Blocks project, resolved (and gated) by ProjectRoute, which renders its pages
 *  only for a found, non-deleting project. Any other id is unknown (and the page redirects). */
export function useProjectPage(): ProjectPage {
  const { id = "" } = useParams();
  return isBlocksProjectId(id) ? { kind: "project", id } : { kind: "unknown" };
}
