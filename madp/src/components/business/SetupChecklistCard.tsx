/** The Project setup checklist: About (the guided start's answers), where the code lives and what was shared. The goal
 *  and the end users are not asked here: the business analyst elicits them in Business Analysis (see setupChips.ts).
 *  One hook reads it (also used by the Start project analysis window); `useSetupChips` turns it into the
 *  step frame's compact chips. Every chip opens at any stage: while the project is in setup and the person may edit,
 *  its own window (the guided start's dialog at that question, the Code window, Share material); afterwards, or
 *  without edit rights, the saved answers read-only (SetupAnswersWindow). */
import { useMemo, type ReactNode } from "react";
import { FileText, FolderGit2, Upload } from "lucide-react";
import type { ProjectRecord } from "@/blocks/projects/records";
import { useDocNoteBody, type DocTreeData } from "@/blocks/projects/docReads";
import { answersFromProject } from "@/domain/guidedStart";
import { setupChecklist, type ChecklistItem } from "@/domain/projectBrief";
import { openGuidedEdit } from "@/components/guided/store";
import { openSetupWindow } from "@/components/setup";
import type { StepChip } from "@/components/step/StepFrame";
import {
  briefIdOf, setupChipList, setupChipTarget, setupPageItems, setupValues, sharedCount, sharedItems,
  type SetupChipId, type SetupChipMode, type SetupFacts, type SetupValues, type SharedItem,
} from "./setupChips";

const ICON: Record<SetupChipId, ReactNode> = {
  about: <FileText size={15} />, where: <FolderGit2 size={15} />, share: <Upload size={15} />,
};

/** The checklist of a project (also read by the Start project analysis window): About, Code and Material only. It
 *  reads every place the answers can be: the project's fields, the guided start's answers, the Project brief note and
 *  the scratch pad (words typed when the project was started). The ticks are made from the same `values` the chips'
 *  windows show. */
export function useSetupChecklist(project: ProjectRecord, data: DocTreeData | undefined) {
  const answers = useMemo(() => answersFromProject(project), [project]);
  const existing = project.type === "brownfield";
  const scratch = useDocNoteBody(data?.scratch?.id ?? null);
  const brief = useDocNoteBody(briefIdOf(data));
  // the scratch pad exists only when words were typed; while its text loads it counts as written
  const scratchText = (scratch.data?.bodyMd ?? "").trim();
  const scratchHasText = Boolean(data?.scratch) && (scratch.data == null || scratchText !== "");
  const values: SetupValues = setupValues({ project, answers, briefBody: brief.data?.bodyMd ?? "", scratchText });
  const repoSaved = values.code.home === "github";
  const facts: SetupFacts = {
    existing,
    repoSaved,
    repoName: values.code.home === "github" ? values.code.name : "",
    sharedCount: sharedCount(data, scratchHasText),
  };
  // the shared checklist still has a "goal" item; Project Setup leaves it out (not a chip, not counted, not "still open")
  const items = setupPageItems(setupChecklist({
    existing,
    name: project.name,
    description: values.description.text,
    goal: "",
    targetUsers: "",
    repoSaved,
    repoText: values.code.home === "github" ? `${values.code.owner}/${values.code.name} · ${values.code.branch}` : "",
    // a new product: "Create a new repository for me" unless the guided start chose one the team already has
    repoWillBeCreated: values.code.home === "create",
    keptInFactory: values.code.home === "factory",
    sharedCount: facts.sharedCount,
  }));
  const material: SharedItem[] = sharedItems(data, scratchHasText);
  return { answers, items, facts, values, material };
}

/** The step frame's chips. `mode` "edit": the chips open today's windows (`onCode` the Code window); "read": `onView`
 *  opens the saved answers of that chip. */
export function useSetupChips(project: ProjectRecord, data: DocTreeData | undefined, opts: {
  mode: SetupChipMode; onCode: () => void; onView: (id: SetupChipId) => void;
}): { chips: StepChip[]; items: ChecklistItem[]; values: SetupValues; material: SharedItem[] } {
  const { answers, items, facts, values, material } = useSetupChecklist(project, data);
  const open = (id: SetupChipId) => {
    const t = setupChipTarget(id, opts.mode);
    if (t.open === "answers") opts.onView(t.id);
    else if (t.open === "code") opts.onCode();
    else if (t.open === "guided") openGuidedEdit(project.id, answers, t.step);
    else openSetupWindow("share", project.id);
  };
  const chips = setupChipList(items, facts, opts.mode, open).map((c) => ({ ...c, icon: ICON[c.id as SetupChipId] }));
  return { chips, items, values, material };
}
