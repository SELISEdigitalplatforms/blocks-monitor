/** /p/:id/sanitization: Product sanitization, step 2 of the project journey. The step itself shows the honest
 *  "not handed over yet" state from the Project record. */
import { useParams } from "react-router-dom";
import { useWorkspaces } from "@/madp/state/workspaces";
import { SanitizationView } from "@/madp/components/sanitization/SanitizationView";

export default function Sanitization() {
  const id = useParams().id ?? "";
  const workspaceId = useWorkspaces((s) => s.workspaceId);
  return <SanitizationView key={id} projectId={id} workspaceId={workspaceId} />;
}
