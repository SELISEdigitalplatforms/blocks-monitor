/** Summary tab: read-only, from real records only (project, objective, counts, technical direction). */
import { useT } from "@/madp/i18n";
import { PRIORITY_WORD } from "./priority";
import { Link } from "react-router-dom";
import { ArrowRight, ScanText } from "lucide-react";
import { useDesignBrief, useObjective, useOpenClarifications, useRequirements, useSuggestions, useTechDecisions } from "@/madp/blocks/requirements/hooks";
import { useRequirementsContext } from "@/madp/blocks/requirements/context";
import { Card, Chip } from "@/madp/ui/kit";
import { LABEL } from "../intake/IntakeShared";

export interface SummaryData {
  projectName: string;
  clientName: string;
  objective: string;
  counts: { must: number; nice: number; later: number; criteria: number; questionsOpen: number; suggestionsOpen: number };
  decisions: { id: string; title: string; detail?: string; status?: string }[];
}

function Empty({ children }: { children: string }) {
  return <div className="hatched rounded-block bg-surface2 px-3 py-2.5 text-[13px] text-ink3">{children}</div>;
}

export function SummaryView({ projectId, data }: { projectId: string; data: SummaryData }) {
  const t = useT();
  const c = data.counts;
  const total = c.must + c.nice + c.later;
  return (
    <Card title={t("analysis.requirements.tabSummary", "Summary")} icon={<ScanText size={18} strokeWidth={1.75} />}>
      <div className="grid gap-6 sm:grid-cols-2">
        <section className="min-w-0">
          <h4 className={`${LABEL} mb-2`}>{t("analysis.requirements.sumProject", "Project")}</h4>
          {data.projectName.trim()
            ? <p className="text-[15px] font-medium [overflow-wrap:anywhere]">{data.projectName}</p>
            : <Empty>{t("analysis.requirements.sumNoName", "No project name yet.")}</Empty>}
          {data.clientName.trim() && <p className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{data.clientName}</p>}
        </section>
        <section className="min-w-0">
          <h4 className={`${LABEL} mb-2`}>{t("analysis.requirements.tabObjective", "Objective")}</h4>
          {data.objective.trim()
            ? <p className="max-w-[72ch] text-[15px] leading-relaxed [overflow-wrap:anywhere]">{data.objective}</p>
            : <Empty>{t("analysis.requirements.noObjectiveYet", "No objective yet.")}</Empty>}
        </section>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <h4 className={`${LABEL} mb-2`}>{t("analysis.requirements.sumInNumbers", "In numbers")}</h4>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {([
            [t("analysis.requirements.checkRequirements", "Requirements"), total], [PRIORITY_WORD.must, c.must], [PRIORITY_WORD.nice, c.nice], [PRIORITY_WORD.later, c.later],
            [t("analysis.requirements.formCriteria", "Acceptance criteria"), c.criteria], [t("analysis.requirements.sumQuestions", "Questions, open or deferred"), c.questionsOpen],
            [t("analysis.requirements.sumOpenSuggestions", "Open suggestions"), c.suggestionsOpen],
          ] as [string, number][]).map(([label, n]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[13px] text-ink3">{label}</dt>
              <dd className="num text-[20px] font-medium leading-tight">{n}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <h4 className={`${LABEL} mb-2`}>{t("analysis.requirements.sumTechnical", "Technical direction")}</h4>
        {data.decisions.length > 0 ? (
          <ul className="divide-y divide-line">
            {data.decisions.map((d) => (
              <li key={d.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 text-[14px] font-medium leading-snug [overflow-wrap:anywhere]">{d.title}</span>
                  {d.status && d.status !== "accepted" && <Chip tone={d.status === "rejected" ? "danger" : "warning"}>{d.status === "rejected" ? t("analysis.requirements.rejected", "Rejected") : t("analysis.requirements.proposed", "Proposed")}</Chip>}
                </div>
                {d.detail && <div className="mt-0.5 text-[13px] leading-snug text-ink2 [overflow-wrap:anywhere]">{d.detail}</div>}
              </li>
            ))}
          </ul>
        ) : <Empty>{t("analysis.requirements.sumNoDecisions", "No technical decisions recorded yet.")}</Empty>}
      </div>

      <Link to={`/p/${projectId}/sanitization`}
        className="mt-5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
        {t("analysis.requirements.openSanitization", "Open Understanding your project")} <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
      </Link>
    </Card>
  );
}

export function SummaryTab({ projectId }: { projectId: string }) {
  const ctx = useRequirementsContext(projectId);
  const reqs = useRequirements(projectId);
  const objective = useObjective(projectId);
  const questions = useOpenClarifications(projectId);
  const suggestions = useSuggestions(projectId);
  const tech = useTechDecisions(projectId);
  useDesignBrief(projectId);
  const list = reqs.data ?? [];
  const n = (p: string) => list.filter((r) => r.priority === p).length;
  const criteria = list.reduce((s, r) => s + (r.criteria?.length ?? 0), objective.data?.criteria?.length ?? 0);
  // accepted decisions first; proposed and rejected ones follow, marked with their status
  const rank = (s: string) => (s === "accepted" ? 0 : s === "proposed" ? 1 : 2);
  const decisions = (tech.data ?? []).map((d) => ({
    id: String(d.id), title: d.title, detail: d.decision || undefined, status: d.status,
  })).sort((a, b) => rank(a.status) - rank(b.status));
  return (
    <SummaryView projectId={projectId} data={{
      projectName: ctx.project?.name ?? "", clientName: ctx.project?.clientName ?? "", objective: objective.data?.text ?? "",
      counts: {
        must: n("must"), nice: n("nice"), later: n("later"), criteria,
        questionsOpen: questions.data?.length ?? 0, suggestionsOpen: (suggestions.data ?? []).filter((s) => s.status === "open").length,
      },
      decisions,
    }} />
  );
}
