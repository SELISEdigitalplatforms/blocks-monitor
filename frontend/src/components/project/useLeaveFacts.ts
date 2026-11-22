/** The facts behind "Leave <project> for now?", read with the hooks that already say what waits for the person, on the
 *  same cache keys (no read of its own): the Team panel's (useTeamSummary: the change requests' questions and approvals,
 *  the tech lead's go-aheads; useDeliveryJobs: the project's work), the Dashboard's "waiting for you" (useDashboardData
 *  with projectNow's rules: the analyst's questions, release approvals), Business Analysis' "Next for you"
 *  (useNextFacts) and the unsent drafts (dirtyDrafts). Mounted only while a menu that can leave the project is open or
 *  a switch waits for an answer (LeaveGuardHost). */
import { useMemo } from "react";
import { useDeliveryContext } from "@/blocks/delivery/context";
import { useChangeRequests, useDeliveryJobs, useMilestones } from "@/blocks/delivery/hooks";
import { useDashboardData } from "@/blocks/dashboard/hooks";
import { useProject } from "@/blocks/projects/reads";
import type { EngineJob } from "@/blocks/engine/types";
import { useWorkspaces } from "@/state/workspaces";
import { changeCode } from "@/domain/delivery";
import { deployTargetOf, myApprovalRequests } from "@/domain/dashboard";
import { isTerminal, type EngineJobKind } from "@/domain/engineJob";
import { isMine, projectsNow } from "@/domain/projectNow";
import { useTeamSummary } from "@/components/team/useTeam";
import { useNextFacts } from "@/components/analysis-next/next/useNextFacts";
import { useProjectDrafts } from "./dirtyDrafts";
import { JOB_PAUSE_PERMISSION, analysisWaiting, isLeaveWork, workWhat, type LeaveFacts, type LeaveWork } from "./leaveGuard";

function inputOf(job: Pick<EngineJob, "inputJson">): Record<string, unknown> {
  try {
    const v = JSON.parse(job.inputJson ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const text = (v: unknown): string => (typeof v === "string" ? v : "");
/** Work the Team panel words itself (its threads offer starting it again). */
const TEAM_KINDS: readonly EngineJobKind[] = ["build.run", "change.build", "preview.deploy", "change.analyse"];

export function useLeaveFacts(projectId: string): { loading: boolean; facts: LeaveFacts } {
  const ctx = useDeliveryContext(projectId);
  const me = ctx.userId ?? "";
  const changesQ = useChangeRequests(ctx);
  const jobsQ = useDeliveryJobs(ctx);
  const milestones = useMilestones(ctx).data;
  const team = useTeamSummary(projectId, false);
  const dash = useDashboardData();
  const projectQ = useProject(projectId);
  const project = projectQ.data ?? null;
  const workspaceId = useWorkspaces((s) => s.workspaceId);
  const next = useNextFacts({ projectId, workspaceId, step: project?.step ?? null, type: project?.type ?? "greenfield" });
  const drafts = useProjectDrafts(projectId);
  // one stable answer while nothing that decides it changed (as useNextAction does)
  const nextKey = JSON.stringify(next);

  const facts = useMemo<LeaveFacts>(() => {
    const changes = changesQ.data;
    const codeOf = (id: string) => {
      const cr = changes.find((c) => c.id === id);
      return cr ? changeCode(cr) : null;
    };
    const whatOf = (j: EngineJob) => {
      const input = inputOf(j);
      const ms = milestones.find((m) => m.id === text(input.milestoneId));
      return workWhat(j.kind, {
        change: codeOf(text(input.changeRequestId)),
        milestone: ms?.number ?? null,
        deployTo: j.kind === "preview.deploy" ? deployTargetOf(j.inputJson ?? "") : undefined,
      });
    };

    // the Team panel: what each thread marks as waiting for the person (needsYou)
    let crAnswers = 0;
    const decisions: string[] = [];
    const goAheads: string[] = [];
    const restarts: LeaveFacts["restarts"][number][] = [];
    for (const g of team.analyst.groups) {
      for (const m of g.messages) {
        if (!m.needsYou || !m.action) continue;
        const a = m.action;
        if (a.kind === "question") crAnswers += 1;
        else if (a.kind === "decide") decisions.push(codeOf(a.changeRequestId) ?? "a change request");
        else if (a.kind === "submit") restarts.push({ who: "analyst", what: `the analysis of ${codeOf(a.changeRequestId) ?? "a change request"}` });
      }
    }
    for (const g of team.lead.groups) {
      for (const m of g.messages) {
        if (!m.needsYou || !m.action) continue;
        const a = m.action;
        if (a.kind === "startChange") goAheads.push(`the build of ${codeOf(a.changeRequestId) ?? "a change request"}`);
        else if (a.kind === "resume") {
          const job = jobsQ.jobs.find((j) => j.id === a.jobId);
          restarts.push({ who: "lead", what: job ? whatOf(job) : a.name });
        }
      }
    }

    // the Dashboard's "waiting for you" (projectNow.ts): the analyst's open questions owned by the person (or nobody's
    // on a project of theirs) and the release approvals they are asked for; nothing waits on a paused or stopped project
    const dp = dash.records.projects.find((p) => p.id === projectId);
    const live = !!dp && dp.stage !== "paused" && dp.stage !== "abandoned";
    const questions = dp && live
      ? dash.records.clarifications.filter((c) => c.projectId === projectId && (c.ownerUserId === me || (!c.ownerUserId && isMine(dp, me)))).length
      : 0;
    const releases = dp && live ? myApprovalRequests(dash.records.approvals.filter((a) => a.projectId === projectId), me).length : 0;
    // the rest of that list in its own words (setup, previews, the person's work that did not finish), so the switcher's
    // "waiting for you" dot and this list agree; work the Team panel words itself (builds, change analyses) stays there
    const nowHere = dp ? projectsNow({ ...dash.records, projects: [dp] }, me, ctx.permissions).get(projectId) : undefined;
    const jobKind = new Map(dash.records.jobs.map((j) => [j.id, j.kind] as const));
    const waiting = (nowHere?.waiting ?? []).filter((w) => w.kind === "setup" || w.kind === "preview"
      || (w.kind === "retry" && !TEAM_KINDS.includes(jobKind.get(w.id.split(":")[2] ?? "") as EngineJobKind))).map((w) => w.text);

    // Business Analysis: "Next for you"; when it names no move, the step sign-off "waiting for you" names stays listed
    const analysis = analysisWaiting(next);
    if (!analysis.wait) {
      for (const w of nowHere?.waiting ?? []) if (w.kind === "understood" || w.kind === "requirements" || w.kind === "scope") waiting.push(w.text);
    }

    const work: LeaveWork[] = jobsQ.jobs
      .filter((j) => !isTerminal(j.status) && isLeaveWork(j.kind))
      .map((j) => ({
        jobId: j.id, kind: j.kind, status: j.status, what: whatOf(j),
        mine: me !== "" && j.createdBy === me,
        permitted: JOB_PAUSE_PERMISSION[j.kind].some((p) => ctx.can(p)),
      }));

    return {
      answers: questions + crAnswers + analysis.answers,
      decisions, analysis: analysis.wait, releases, goAheads, restarts, waiting, work, drafts,
    };
  }, [changesQ.data, jobsQ.jobs, milestones, team, dash.records, projectId, me, ctx, nextKey, drafts]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = ctx.status === "loading" || changesQ.isLoading || jobsQ.isLoading || dash.isLoading || projectQ.isLoading || next.loading;
  return { loading, facts };
}
