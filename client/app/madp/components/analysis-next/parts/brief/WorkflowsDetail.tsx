/** "Workflows, constraints & not included", opened in its row: compact rows (a workflow opens to its steps), each with
 *  one ⋯ menu, and one quiet "Add" per list (CompactWorkflowList: the same reads and writes as WorkflowsTab: add,
 *  edit, order, delete with undo, comments). Editable while the requirements are open and the person may edit them. */
import { useT } from "@/madp/i18n";
import { useRequirementsContext } from "@/madp/blocks/requirements/context";
import { PartPlaceholder } from "@/madp/components/analysis/doc/PartCard";
import { partOpen } from "@/madp/components/analysis/model";
import type { AnalysisCtx } from "../../model";
import { CompactWorkflowList } from "./CompactWorkflowList";

export function WorkflowsDetail({ projectId, step }: AnalysisCtx) {
  const t = useT();
  const open = partOpen("workflows", step);
  const ctx = useRequirementsContext(projectId);
  const canReq = Boolean(ctx.canEditRequirements);
  const readOnlyReason = !ctx.open ? "closed" as const : canReq ? null : "permission" as const;

  if (!open) {
    return <PartPlaceholder what={t("analysis.brief.workflowsPlaceholder", "Your business analyst writes down the key workflows (who does what, step by step), the constraints to respect (deadline, budget, rules, languages, systems) and what this version leaves out.")} when={t("analysis.brief.whenAfterQuestions", "Written after you answer the open questions.")} />;
  }
  return <CompactWorkflowList projectId={projectId} editable={ctx.open && canReq} readOnlyReason={readOnlyReason} stepOpen={ctx.open} />;
}
