/** "Approve the requirements": a short word from the analyst and the Goals & requirements step's own action, as in
 *  today's panel (analysis/pm/RequirementsTalk.tsx): requirements.confirm through useConfirmRequirements (the server
 *  re-checks every blocker). The blockers and the checklist are worked out exactly as RequirementsPage does; with items
 *  still open it asks first ("Approve with items still open?"). */
import { useState } from "react";
import { Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRequirementsContext } from "@/madp/blocks/requirements/context";
import { useDesignBrief, useObjective, useRequirements } from "@/madp/blocks/requirements/hooks";
import { useConfirmRequirements } from "@/madp/blocks/requirements/mutations";
import { useRequirementsExtras } from "@/madp/blocks/requirements/extras";
import { useDesignContext } from "@/madp/blocks/requirements/designContext";
import { blocksKeys } from "@/madp/blocks/data/keys";
import { FunctionError } from "@/madp/blocks/fn";
import { confirmBlockers } from "@/madp/domain/requirements";
import { automaticDesignDirection, designSource, parseMakePrototype } from "@/madp/domain/figmaMake";
import { designSourceCurrent, parseProductPrototype } from "@/madp/domain/factoryDesign";
import { blockerKey, blockerText, type ConfirmBlocker } from "@/madp/components/requirements/glance";
import { useLandingSection } from "@/madp/components/requirements/LandingPageSection";
import { nowItems } from "@/madp/components/requirements/goalsNow";
import { countPriorities } from "@/madp/components/requirements/priority";
import { requirementsErrorMessage } from "@/madp/components/requirements/messages";
import { Button } from "@/madp/ui/kit";
import type { DocPart } from "../model";
import { myWords } from "./analystModel";
import { AnalystSays, ErrorNote, Note, PartLink } from "./Talk";
import { Working } from "./Working";
import { useT } from "@/madp/i18n";

export function RequirementsStep({ projectId, workspaceId, onPart }: { projectId: string; workspaceId: string | null; onPart: (part: DocPart) => void }) {
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
  const [refusal, setRefusal] = useState<{ text: string; retry: boolean } | null>(null);

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
  const reasons = [...new Set(blockers.map((b) => myWords(blockerKey(b) === "design" ? t("analysis.workspace.req.reviewDesign", "Review and approve the interactive product design.") : blockerText(b))))];

  const run = () => {
    setRefusal(null);
    setAsking(false);
    confirm.mutate({}, {
      onSuccess: () => { if (workspaceId) void qc.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, "Project") }); },
      onError: (e) => {
        const missing = e instanceof FunctionError && Array.isArray(e.params?.missing) ? (e.params.missing as ConfirmBlocker[]) : null;
        setRefusal(missing && missing.length > 0 ? { text: myWords(missing.map(blockerText).join(" ")), retry: false } : { text: myWords(requirementsErrorMessage(e)), retry: true });
      },
    });
  };

  if (ctx.past) return <AnalystSays>{t("analysis.workspace.req.approvedUsed", "You approved the requirements. I used them to write the scope.")}</AnalystSays>;
  if (reqs.isLoading) return <AnalystSays className="text-ink2">{t("analysis.workspace.req.opening", "Opening the requirements…")}</AnalystSays>;
  if (reqs.isError) return <ErrorNote text={t("analysis.analyst.req.openFailed", "I couldn't open the requirements just now.")} onRetry={() => void reqs.refetch()} />;

  return (
    <div className="flex flex-col gap-3.5">
      {requirements.length === 0 ? (
        <Working text={t("analysis.analyst.req.writing", "I'm writing the requirements from your answers. They appear in the analysis as I go.")} />
      ) : (
        <>
          <AnalystSays>
            {requirements.length === 1
              ? t("analysis.analyst.req.wroteOne", "I wrote one requirement, with the objective, the key workflows and what is not included.")
              : t("analysis.analyst.req.wroteMany", "I wrote {count} requirements, with the objective, the key workflows and what is not included.", { count: requirements.length })}
          </AnalystSays>
          <AnalystSays className="text-ink2">
            {t("analysis.analyst.req.readThemIn", "Read them in")} <PartLink onClick={() => onPart("features")}>{t("analysis.analyst.req.linkFeatures", "Master features")}</PartLink> {t("analysis.analyst.and", "and")}{" "}
            <PartLink onClick={() => onPart("workflows")}>{t("analysis.analyst.req.linkWorkflows", "Workflows")}</PartLink>, {t("analysis.analyst.req.commentThenApprove", "comment on anything you'd change, then approve.")}
          </AnalystSays>
        </>
      )}
      {reasons.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-block bg-surface2 px-4 py-3">
          <p className="text-[13px] font-medium text-ink2">{t("analysis.workspace.req.beforeApprove", "Before you can approve")}</p>
          <ul className="flex flex-col gap-1 text-[14px] leading-6 text-ink" aria-label={t("analysis.workspace.req.beforeApprove", "Before you can approve")}>
            {reasons.map((r) => <li key={r} className="break-words">{r}</li>)}
          </ul>
        </div>
      )}
      {asking && (
        <div className="flex flex-col gap-2.5 rounded-card bg-surface px-4 py-4 ring-1 ring-line">
          <p className="text-[15px] font-medium text-ink">{left.length === 1 ? t("analysis.workspace.req.oneOpen", "One item on the checklist is still open") : t("analysis.workspace.req.manyOpen", "{count} items on the checklist are still open", { count: left.length })}</p>
          <ul className="flex flex-col gap-1.5 text-[14px] leading-6 text-ink2">
            {left.map((i) => <li key={i.id} className="break-words"><span className="font-medium text-ink">{i.label}</span>: {i.detail}</li>)}
          </ul>
          <p className="text-[13px] text-ink3">{t("analysis.workspace.req.approveAnywayNote", "You can approve anyway; the scope is then written without them.")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="md" variant="primary" data-analyst-action="" disabled={confirm.isPending} onClick={run}>{t("analysis.workspace.req.approveAnyway", "Approve anyway")}</Button>
            <Button size="md" variant="ghost" onClick={() => setAsking(false)}>{t("analysis.analyst.later", "Later")}</Button>
          </div>
        </div>
      )}
      {canReq && ctx.open && !asking && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="md" variant="primary" data-analyst-action="" icon={<Check size={15} aria-hidden />} disabled={blockers.length > 0 || confirm.isPending}
            onClick={() => (left.length > 0 ? setAsking(true) : run())}>
            {confirm.isPending ? t("analysis.workspace.req.approving", "Approving…") : t("analysis.workspace.req.approve", "Approve requirements")}
          </Button>
        </div>
      )}
      {!canReq && <Note>{t("analysis.analyst.req.someoneApproves", "Someone on the project team with edit rights approves the requirements.")}</Note>}
      {refusal && <ErrorNote text={refusal.text} busy={confirm.isPending} onRetry={refusal.retry ? run : undefined} />}
    </div>
  );
}
