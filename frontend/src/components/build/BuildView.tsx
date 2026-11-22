/** The build screen, /p/:id/build: MADP's AI agents at work, read from the project's engine jobs.
 *  Only a SELISE Blocks project has a build: ProjectRoute sends any other id to the projects list, so a non-Blocks id
 *  renders nothing here. Its tabs share one calibration of the real build estimates (EstimatesContext.tsx). */
import { useParams } from "react-router-dom";
import { isBlocksProjectId } from "@/blocks/delivery/projectKind";
import { BlocksBuildView } from "./BlocksBuildView";
import { EstimatesProvider } from "./EstimatesContext";

export function BuildView() {
  const { id } = useParams();
  return id && isBlocksProjectId(id) ? <EstimatesProvider><BlocksBuildView projectId={id} /></EstimatesProvider> : null;
}
