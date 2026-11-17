/** /p/:id/understanding: "Project understanding", the review between Project setup and Understanding your project.
 *  The step reads its own records and draws itself on the shared step frame (components/understanding). */
import { useParams } from "react-router-dom";
import { useWorkspaces } from "@/state/workspaces";
import { UnderstandingStep } from "@/components/understanding/UnderstandingStep";

export default function Understanding() {
  const id = useParams().id ?? "";
  const workspaceId = useWorkspaces((s) => s.workspaceId);
  return <UnderstandingStep key={id} projectId={id} workspaceId={workspaceId} />;
}
