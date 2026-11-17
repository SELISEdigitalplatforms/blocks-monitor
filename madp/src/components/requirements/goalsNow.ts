/** The checklist of Goals & requirements (pure): six items from the live records, as the step frame's chips, and the
 *  frame's one-line status. The checklist is the owner's view of a finished step; what the server insists on before the
 *  scope opens (acceptance criteria, a confirmed design instruction…) still comes from confirmBlockers and is shown
 *  as the reasons under the primary button. */
import { t } from "@/i18n";
import type { DesignMode } from "@/domain/designBrief";
import { priorityLine, type PriorityCounts } from "./priority";
import type { ReqTab } from "./requirementsTab";

export type NowItemId = "goal" | "musts" | "workflows" | "exclusions" | "constraints" | "comments";

export interface NowItem { id: NowItemId; label: string; done: boolean; detail: string; tab: ReqTab; action: string }

export interface NowInput {
  objective: { text: string; criteria: readonly string[] } | null;
  priorities: PriorityCounts;
  workflows: number;
  exclusions: number;
  constraints: number;
  /** Comment threads on this step's items that are still open (with at least one comment). */
  openComments: number;
}

/** One of two texts by count: the singular for exactly one. */
const byCount = (n: number, one: string, many: string) => (n === 1 ? one : many);
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function nowItems(i: NowInput): NowItem[] {
  const goalText = i.objective?.text.trim() ?? "";
  const goalCriteria = i.objective ? i.objective.criteria.filter((c) => c.trim()).length : 0;
  const total = i.priorities.must + i.priorities.nice + i.priorities.later;
  return [
    {
      id: "goal", label: t("analysis.requirements.nowGoal", "Goal agreed"), tab: "objective", action: t("analysis.requirements.nowGoalAction", "Open the goal"),
      done: goalText !== "" && goalCriteria > 0,
      detail: !goalText ? t("analysis.requirements.nowGoalWrite", "Write what the product should achieve")
        : goalCriteria === 0 ? t("analysis.requirements.nowGoalCriteria", "Add how you'll know it's reached") : clip(goalText),
    },
    {
      id: "musts", label: t("analysis.requirements.nowMusts", "Must-haves prioritised"), tab: "must", action: t("analysis.requirements.nowMustsAction", "Prioritise"),
      done: i.priorities.must > 0,
      detail: total === 0 ? t("analysis.requirements.nowMustsAdd", "Add what it must do and mark the must-haves")
        : i.priorities.must === 0 ? t("analysis.requirements.nowMustsMark", "Mark at least one requirement as Must") : priorityLine(i.priorities),
    },
    {
      id: "workflows", label: t("analysis.requirements.nowWorkflows", "Workflows described"), tab: "workflows", action: t("analysis.requirements.nowWorkflowsAction", "Describe"),
      done: i.workflows > 0,
      detail: i.workflows > 0
        ? byCount(i.workflows, t("analysis.requirements.workflowsOne", "1 workflow"), t("analysis.requirements.workflowsMany", "{count} workflows", { count: i.workflows }))
        : t("analysis.requirements.nowWorkflowsHint", "Who does what, step by step"),
    },
    {
      id: "exclusions", label: t("analysis.requirements.nowExclusions", "What's not included"), tab: "workflows", action: t("analysis.requirements.nowAdd", "Add"),
      done: i.exclusions > 0,
      detail: i.exclusions > 0
        ? byCount(i.exclusions, t("analysis.requirements.leftOutOne", "1 item left out"), t("analysis.requirements.leftOutMany", "{count} items left out", { count: i.exclusions }))
        : t("analysis.requirements.nowExclusionsHint", "Say what this version leaves out"),
    },
    {
      id: "constraints", label: t("analysis.requirements.nowConstraints", "Constraints"), tab: "workflows", action: t("analysis.requirements.nowAdd", "Add"),
      done: i.constraints > 0,
      detail: i.constraints > 0
        ? byCount(i.constraints, t("analysis.requirements.constraintsOne", "1 constraint"), t("analysis.requirements.constraintsMany", "{count} constraints", { count: i.constraints }))
        : t("analysis.requirements.nowConstraintsHint", "Deadline, budget, rules, languages, systems"),
    },
    {
      id: "comments", label: t("analysis.requirements.nowComments", "Open comments resolved"), tab: "must", action: t("analysis.requirements.nowCommentsAction", "Review"),
      done: i.openComments === 0,
      detail: i.openComments === 0 ? t("analysis.requirements.noOpenComments", "No open comments")
        : byCount(i.openComments,
          t("analysis.requirements.threadsOpenOne", "1 comment thread still open"),
          t("analysis.requirements.threadsOpenMany", "{count} comment threads still open", { count: i.openComments })),
    },
  ];
}

/* ── the step frame (StepFrame): chips and the one-line status ─────────────────────────────────── */

export interface GoalsChip { id: NowItemId; label: string; state: "done" | "todo" | "attention"; value: string; title: string }

function chipLabel(id: NowItemId): string {
  switch (id) {
    case "goal": return t("analysis.requirements.chipGoal", "Goal");
    case "musts": return t("analysis.requirements.chipMusts", "Must-haves");
    case "workflows": return t("analysis.requirements.chipWorkflows", "Workflows");
    case "exclusions": return t("analysis.requirements.chipExclusions", "Not included");
    case "constraints": return t("analysis.requirements.chipConstraints", "Constraints");
    case "comments": return t("analysis.requirements.chipComments", "Comments");
  }
}

/** The six checklist items as the frame's chips (short label, short value; the long words go to the tooltip). */
export function goalsChips(items: readonly NowItem[], i: Pick<NowInput, "priorities" | "workflows" | "exclusions" | "constraints" | "openComments">): GoalsChip[] {
  const value: Record<NowItemId, string> = {
    goal: items.find((x) => x.id === "goal")?.done ? t("analysis.requirements.chipAgreed", "agreed") : "",
    musts: i.priorities.must > 0 ? t("analysis.requirements.chipMustCount", "{count} must", { count: i.priorities.must }) : "",
    workflows: i.workflows > 0 ? String(i.workflows) : "",
    exclusions: i.exclusions > 0 ? String(i.exclusions) : "",
    constraints: i.constraints > 0 ? String(i.constraints) : "",
    comments: i.openComments > 0 ? t("analysis.requirements.chipOpenCount", "{count} open", { count: i.openComments }) : t("analysis.requirements.chipNoneOpen", "none open"),
  };
  return items.map((x) => ({
    id: x.id, label: chipLabel(x.id), value: value[x.id], title: `${x.label}: ${x.detail}`,
    state: x.done ? "done" : x.id === "comments" ? "attention" : "todo",
  }));
}

export type GoalsStatus = { text: string; tone: "done" | "progress" | "waiting" | "attention" };

/** The frame's one line: approved, the business analyst at work, ready to approve, or what to do. */
export function goalsStatus(o: { approved: boolean; drafting: "draft" | "review" | null; left: number; blockers: number; requirements: number }): GoalsStatus {
  if (o.approved) return { text: t("analysis.requirements.statusApproved", "Approved"), tone: "done" };
  if (o.drafting === "draft") return { text: t("analysis.requirements.statusDrafting", "Your business analyst is drafting"), tone: "progress" };
  if (o.drafting === "review") return { text: t("analysis.requirements.statusReviewing", "Your business analyst is reviewing"), tone: "progress" };
  if (o.requirements === 0) return { text: t("analysis.requirements.statusWaitingDraft", "Waiting for the first draft"), tone: "waiting" };
  if (o.left === 0 && o.blockers === 0) return { text: t("analysis.requirements.statusReady", "Ready to approve"), tone: "done" };
  return { text: t("analysis.requirements.statusReview", "Review the draft, then approve"), tone: "progress" };
}

/* ── the look & feel (the screens & design instruction) ───────────────────── */

export interface LookAndFeelBrief { mode: DesignMode; instructions: string; status: "draft" | "confirmed" }

/** What the "Look & feel" section shows, and whether "Approve requirements" can agree to it in the same go (a complete
 *  draft: a description of at least a few words, or a design sample). */
const notDescribed = () => t("analysis.requirements.lookFeelAuto", "Your business analyst generates Figma Make screens automatically from your requirements. Review and approve the screens here.");

export function lookAndFeelState(brief: LookAndFeelBrief | null, _readySamples: number, waitingForDraft = false): {
  text: string; tag: "Agreed" | "Included in your approval" | null; samples: number; empty: boolean; approvable: boolean;
} {
  if (!brief) {
    const text = waitingForDraft ? t("analysis.requirements.lookFeelWaiting", "Your business analyst will generate Figma Make screens when the first requirements are ready.") : notDescribed();
    return { text, tag: null, samples: 0, empty: true, approvable: false };
  }
  const text = notDescribed();
  const agreed = brief.mode === "figma" && brief.status === "confirmed";
  return { text, tag: agreed ? "Agreed" : null, samples: 0, empty: !agreed, approvable: false };
}
