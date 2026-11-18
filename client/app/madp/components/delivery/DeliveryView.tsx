/** The Release page (/p/:id/delivered), the last step of the lifecycle: the release per environment on SELISE Blocks.
 *  Only Blocks projects (UUID ids) have a release page; any other id renders nothing (the route sends it to /projects). */
import { useParams } from "react-router-dom";
import { isBlocksProjectId } from "@/madp/blocks/delivery/projectKind";
import { BlocksReleaseView } from "./BlocksReleaseView";

export function DeliveryView() {
  const { id } = useParams();
  return isBlocksProjectId(id) ? <BlocksReleaseView projectId={id!} /> : null;
}
