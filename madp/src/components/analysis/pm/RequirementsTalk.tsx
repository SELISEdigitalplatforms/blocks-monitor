/** "Approve the requirements": a short word from the business analyst and the Goals & requirements step's own action,
 *  "Approve requirements" (requirements.confirm through useConfirmRequirements; the server re-checks every blocker).
 *  The blockers and the checklist are worked out exactly as RequirementsPage does; with items still open it asks
 *  first, like that page's "Approve with items still open?". */
import { useState } from "react";
import { Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRequirementsContext } from "@/blocks/requirements/context";
import { useDesignBrief, useObjective, useRequirements } from "@/blocks/requirements/hooks";
import { useConfirmRequirements } from "@/blocks/requirements/mutations";
import { useRequirementsExtras } from "@/blocks/requirements/extras";
import { useDesignContext } from "@/blocks/requirements/designContext";
import { blocksKeys } from "@/blocks/data/keys";
import { FunctionError } from "@/blocks/fn";
import { confirmBlockers } from "@/domain/requirements";
import { automaticDesignDirection, designSource, parseMakePrototype } from "@/domain/figmaMake";
import { designSourceCurrent, parseProductPrototype } from "@/domain/factoryDesign";
import { blockerKey, blockerText, type ConfirmBlocker } from "@/components/requirements/glance";
import { useLandingSection } from "@/components/requirements/LandingPageSection";
import { nowItems } from "@/components/requirements/goalsNow";
import { countPriorities } from "@/components/requirements/priority";
import { requirementsErrorMessage } from "@/components/requirements/messages";
import { Button } from "@/ui/kit";
import { PmSays, TalkNote } from "./Talk";
import { useT } from "@/i18n";

export function RequirementsTalk({ projectId, workspaceId }: { projectId: string; workspaceId: string | null }) {
  const t = useT();
  const qc = useQueryClient();
  const ctx = useRequirementsContext(projectId);
  const reqs = useRequirements(projectId);
  const objective = useObjective(projectId);
  const brief = useDesignBrief(projectId);
  const extras = useRequirementsExtras(projectId, ctx.project?.setup);
  const landing = useLandingSection(projectId);
  const designIntent = useDesignContext(projectId);
  const confirm = useConfirmRequirements(projectId);
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const canReq = Boolean(ctx.canEditRequirements);
  const requirements = reqs.data ?? [];
  const obj = objective.data ?? null;
  const landingOpen = landing.review === "preparing" || landing.review === "review";
  const blockers = confirmBlockers({ requirements, objective: obj, designBrief: brief.data ?? null, landingPageOpen: landingOpen } as never) as unknown as ConfirmBlocker[];
  const designRequirements = requirements.map((r) => ({ key: r.key || r.id, title: r.title, text: r.detail, criteria: r.criteria }));
  const parsedDesign = parseProductPrototype(brief.data?.prototypeJson);
  const factoryDesign = parsedDesign?.provider !== "figma-make" ? parsedDesign : null;
  const designCurrent = brief.data?.mode === "figma" && (factoryDesign
    ? !designIntent.isError && !designIntent.isFetching && designSourceCurrent(factoryDesign.source, designIntent.data)
    : parseMakePrototype(brief.data?.prototypeJson)?.source === designSource(automaticDesignDirection(designRequirements), designRequirements));
  if (!designCurrent && !blockers.some((b) => blockerKey(b) === "design")) blockers.push({ code: "design_not_confirmed" });
  const left = nowItems({
    objective: obj, priorities: countPriorities(requirements),
    workflows: extras.byKind.workflow.length, exclusions: extras.byKind.exclusion.length, constraints: extras.byKind.constraint.length,
    openComments: 0,
  }).filter((i) => !i.done);
  const reasons = [...new Set(blockers.map((b) => (blockerKey(b) === "design" ? t("analysis.workspace.req.reviewDesign", "Review and approve the interactive product design.") : blockerText(b))))];

  const run = () => {
    setRefusal(null);
    setAsking(false);
    confirm.mutate({}, {
      onSuccess: () => { if (workspaceId) void qc.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, "Project") }); },
      onError: (e) => {
        const missing = e instanceof FunctionError && Array.isArray(e.params?.missing) ? (e.params.missing as ConfirmBlocker[]) : null;
        setRefusal(missing && missing.length > 0 ? missing.map(blockerText).join(" ") : requirementsErrorMessage(e));
      },
    });
  };

  if (ctx.past) {
    return <PmSays>{t("analysis.workspace.req.approvedUsed", "You approved the requirements. I used them to write the scope.")}</PmSays>;
  }
  if (reqs.isLoading) return <PmSays>{t("analysis.workspace.req.opening", "Opening the requirements…")}</PmSays>;

  return (
    <div className="flex flex-col gap-3">
      <PmSays>
        {requirements.length === 0
          ? t("analysis.workspace.req.writing", "I'm writing the requirements from your answers. They appear on the right as I go.")
          : requirements.length === 1
            ? t("analysis.workspace.req.wroteOne", "I wrote one requirement, with the objective, the key workflows and what is not included. Read them on the right, comment on anything you'd change, then approve.")
            : t("analysis.workspace.req.wroteMany", "I wrote {count} requirements, with the objective, the key workflows and what is not included. Read them on the right, comment on anything you'd change, then approve.", { count: requirements.length })}
      </PmSays>
      {reasons.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px] text-ink2" aria-label={t("analysis.workspace.req.beforeApprove", "Before you can approve")}>
          {reasons.map((r) => <li key={r} className="break-words">· {r}</li>)}
        </ul>
      )}
      {asking && (
        <div className="flex flex-col gap-2 rounded-block px-3.5 py-3 ring-1 ring-line">
          <p className="text-[13px] text-ink">{left.length === 1 ? t("analysis.workspace.req.oneOpen", "One item on the checklist is still open") : t("analysis.workspace.req.manyOpen", "{count} items on the checklist are still open", { count: left.length })}:</p>
          <ul className="flex flex-col gap-1 text-[13px] text-ink2">
            {left.map((i) => <li key={i.id}><span className="font-medium text-ink">{i.label}</span> — {i.detail}</li>)}
          </ul>
          <p className="text-[12px] text-ink3">{t("analysis.workspace.req.approveAnywayNote", "You can approve anyway; the scope is then written without them.")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={confirm.isPending} onClick={run}>{t("analysis.workspace.req.approveAnyway", "Approve anyway")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>{t("analysis.workspace.req.notYet", "Not yet")}</Button>
          </div>
        </div>
      )}
      {canReq && ctx.open && !asking && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={<Check size={14} aria-hidden />} disabled={blockers.length > 0 || confirm.isPending}
            onClick={() => (left.length > 0 ? setAsking(true) : run())}>
            {confirm.isPending ? t("analysis.workspace.req.approving", "Approving…") : t("analysis.workspace.req.approve", "Approve requirements")}
          </Button>
        </div>
      )}
      {!canReq && <TalkNote>{t("analysis.workspace.req.teamApproves", "The project team approves the requirements.")}</TalkNote>}
      {refusal && <TalkNote tone="danger">{refusal}</TalkNote>}
    </div>
  );
}
