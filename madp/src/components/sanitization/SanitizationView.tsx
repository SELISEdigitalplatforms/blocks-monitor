/** "Understanding your project" (existing products: "Understanding your product"), the second section of step 2
 *  "Business Analysis" (/p/:id/analysis#sanitization). The step reads its
 *  own records and draws itself on the shared step frame; this names it by the project type. */
import { projectTypeOf, stepLabelFor } from "@/domain/projectType";
import { STEP_LABEL } from "@/domain/journey";
import { SanitizationStep } from "./SanitizationStep";

export function SanitizationView({ projectId, workspaceId }: { projectId: string; workspaceId: string | null }) {
  return (
    <SanitizationStep projectId={projectId} workspaceId={workspaceId}
      title={(project) => (projectTypeOf(project?.RepoMode) === "brownfield" ? stepLabelFor("brownfield", "sanitization")?.label : null) ?? STEP_LABEL.sanitization} />
  );
}
