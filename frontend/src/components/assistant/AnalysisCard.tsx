import { type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Bug, ChevronRight, FileCode2, Gauge, Hammer, ListOrdered, Timer } from "lucide-react";
import { Button, Chip } from "@/ui/kit";
import { VIEWER_TIP } from "@/domain/rbac";
import { parseAnalysis, type Severity } from "@/domain/assistant";
import type { EngineJob } from "@/blocks/engine/types";
import { useDeliveryContext } from "@/blocks/delivery/context";
import { useChangeRequests } from "@/blocks/delivery/hooks";
import { fixJobOf, useDeclineFix, useStartFix } from "@/blocks/collab/assistant";
import { useCan } from "@/blocks/collab/context";
import type { AssistantMessageRecord } from "@/blocks/collab/records";
import { ViewOnlyNote } from "@/components/workspace/ViewOnlyNote";
import { CodeRefChip } from "./CodeRefChip";
import { FixProgress } from "./FixProgress";
import { envLabel } from "./assistantWindowState";
import { t, useT } from "@/i18n";

type ChipTone = NonNullable<ComponentProps<typeof Chip>["tone"]>;

const ICON = { size: 15, strokeWidth: 1.75 } as const;

function severityLabel(s: Severity): string {
  if (s === "critical") return t("assistant.analysis.severityCritical", "Critical");
  if (s === "high") return t("assistant.analysis.severityHigh", "High");
  if (s === "medium") return t("assistant.analysis.severityMedium", "Medium");
  return t("assistant.analysis.severityLow", "Low");
}
const SEVERITY_TONE: Record<Severity, ChipTone> = { critical: "danger", high: "warning", medium: "accent", low: "neutral" };
/** An agent role's name in the current language; an unknown role is shown as it is. */
function roleLabel(role: string): string {
  switch (role) {
    case "planner": return t("assistant.analysis.rolePlanner", "Business analyst");
    case "dev": return t("assistant.analysis.roleDev", "Tech lead");
    case "reviewer": return t("assistant.analysis.roleReviewer", "Reviewer");
    case "qa": return t("assistant.analysis.roleQa", "Tester");
    case "secops": return t("assistant.analysis.roleSecops", "Security");
    case "docs": return t("assistant.analysis.roleDocs", "Documentation");
    case "shipper": return t("assistant.analysis.roleShipper", "Release manager");
    default: return role;
  }
}

const hoursLabel = (h: number): string => `${Math.round(h * 10) / 10} h`;

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">{icon}{title}</h4>
      {children}
    </section>
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink2">{items.map((t, i) => <li key={i} className="[overflow-wrap:anywhere]">{t}</li>)}</ul>
);
const Steps = ({ items }: { items: string[] }) => (
  <ol className="list-decimal space-y-0.5 pl-5 text-[13px] text-ink2">{items.map((t, i) => <li key={i} className="[overflow-wrap:anywhere]">{t}</li>)}</ol>
);
const ChipList = ({ items, mono, label }: { items: string[]; mono?: boolean; label: string }) => (
  <ul className="flex flex-wrap gap-1.5" aria-label={label}>
    {items.map((t, i) => <li key={i} className="max-w-full"><Chip className={mono ? "font-mono !whitespace-normal [overflow-wrap:anywhere]" : undefined}>{t}</Chip></li>)}
  </ul>
);

/** The fix part of an analysis: the start / not now actions, or the running fix. */
function FixActions({ message, projectId, jobs }: { message: AssistantMessageRecord; projectId: string; jobs: readonly EngineJob[] }) {
  const t = useT();
  const canRun = useCan("build.run");
  const startFix = useStartFix(projectId, message.id);
  const decline = useDeclineFix(projectId);
  const ctx = useDeliveryContext(projectId);
  const requests = useChangeRequests(ctx).data;
  const busy = startFix.pending || decline.pending;
  const tipId = `fix-tip-${message.id}`;
  const crId = message.fixChangeRequestId;
  const started = message.fixState === "started";
  const cr = crId ? requests.find((r) => r.id === crId) ?? null : null;
  const job = fixJobOf(jobs, crId);
  const release = `/p/${projectId}/delivered`;
  const failure = startFix.failure;
  const error = failure?.error ?? decline.error;

  return (
    <div className="space-y-3 border-t border-line pt-3">
      {!started && (
        <div className="space-y-2">
          <p className="text-[14px] font-semibold text-ink">{t("assistant.analysis.fixQuestion", "Shall your development team fix this?")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Hammer {...ICON} />} disabled={!canRun || busy} aria-busy={startFix.pending}
              onClick={() => void startFix.start()} title={canRun ? undefined : VIEWER_TIP} aria-describedby={canRun ? undefined : tipId}>
              {startFix.pending ? t("assistant.analysis.starting", "Starting…") : failure ? t("assistant.analysis.tryAgain", "Try again") : t("assistant.analysis.startFix", "Start the fix")}
            </Button>
            {message.fixState === "declined" ? (
              <span className="text-[13px] text-ink3">{t("assistant.analysis.notStarted", "Not started yet.")}</span>
            ) : (
              <Button variant="ghost" disabled={!canRun || busy} onClick={() => void decline.run({ messageId: message.id })}
                title={canRun ? undefined : VIEWER_TIP} aria-describedby={canRun ? undefined : tipId}>{t("assistant.analysis.notNow", "Not now")}</Button>
            )}
          </div>
          {!canRun && <ViewOnlyNote id={tipId} />}
        </div>
      )}
      {error && <p role="alert" className="text-[13px] text-[rgb(var(--c-danger-text))]">{error}</p>}
      {failure?.recorded && (
        <p role="status" className="text-[13px] text-[rgb(var(--c-warning-text))]">
          {t("assistant.analysis.buildNotStarted", "The fix is saved as a draft, but its build did not start. Try again, or start it on the Release page.")}
        </p>
      )}

      {started && !crId && <p role="status" className="text-[13px] text-ink2">{t("assistant.analysis.startingFix", "Starting the fix…")}</p>}
      {started && crId && job && <FixProgress job={job} code={message.fixCode} canRetry={canRun} />}
      {started && crId && !job && cr?.status === "draft" && (
        <p className="text-[13px] text-ink2">
          {message.fixCode
            ? t("assistant.analysis.draftSavedCode", "{code} is saved. Send it for analysis on the Release page; once you approve it, the development team builds it.", { code: message.fixCode })
            : t("assistant.analysis.draftSaved", "The fix is saved. Send it for analysis on the Release page; once you approve it, the development team builds it.")}
        </p>
      )}
      {started && cr && cr.status !== "draft" && cr.status !== "building" && cr.version && (
        <p className="text-[13px] text-ink2">{t("assistant.analysis.inVersion", "{code} is in v{version}.", { code: message.fixCode, version: cr.version })}</p>
      )}
      {started && crId && (
        <Link to={release} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink underline-offset-2 hover:underline">
          <ArrowUpRight {...ICON} aria-hidden />{t("assistant.analysis.openRelease", "Open the Release page")}
        </Link>
      )}
    </div>
  );
}

export function AnalysisCard({ message, projectId, jobs }: { message: AssistantMessageRecord; projectId: string; jobs: readonly EngineJob[] }) {
  const t = useT();
  const a = parseAnalysis(message.analysisJson);
  if (!a) return <p className="rounded-block bg-surface p-4 text-[13px] text-ink2">{t("assistant.analysis.unreadable", "This analysis can't be shown.")}</p>;

  return (
    <article className="space-y-4 rounded-block bg-surface p-4" aria-label={t("assistant.analysis.cardLabel", "Bug analysis: {title}", { title: a.title })}>
      <header className="space-y-1">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3"><Bug {...ICON} aria-hidden />{t("assistant.analysis.heading", "Bug analysis")}</p>
        <h3 className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">{a.title}</h3>
      </header>

      <Section title={t("assistant.analysis.summary", "Summary")}><p className="text-[13px] text-ink2">{a.summary}</p></Section>

      <Section title={t("assistant.analysis.severity", "Severity")} icon={<Gauge {...ICON} aria-hidden />}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={SEVERITY_TONE[a.severity]}>{severityLabel(a.severity)}</Chip>
          <p className="min-w-0 flex-1 text-[13px] text-ink2">{a.severityReason}</p>
        </div>
      </Section>

      <Section title={t("assistant.analysis.rootCause", "What went wrong")} icon={<FileCode2 {...ICON} aria-hidden />}>
        <p className="text-[13px] text-ink2">{a.rootCause.text}</p>
      </Section>

      <Section title={t("assistant.analysis.impact", "What it affects")}>
        <ChipList label={t("assistant.analysis.impact", "What it affects")} items={[...a.impact.features, ...a.impact.screens, ...a.impact.environments.map(envLabel)]} />
      </Section>

      <Section title={t("assistant.analysis.estimate", "Estimate")} icon={<Timer {...ICON} aria-hidden />}>
        <p className="text-[13px] text-ink2">{t("assistant.analysis.effort", "About {hours} of work", { hours: hoursLabel(a.estimate.hours) })}</p>
        <ChipList label={t("assistant.analysis.whoWorks", "Who works on it")} items={a.estimate.agentRoles.map(roleLabel)} />
      </Section>

      {/* the technical part (code references, evidence, the developers' plan): one folded area, as in every step */}
      <details className="group rounded-block bg-surface2/60">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-block px-3 py-2 text-[13px] font-medium text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="transition group-open:rotate-90" />{t("assistant.analysis.technical", "Technical details")}
        </summary>
        <div className="space-y-4 px-3 pb-3 pt-1">
          <Section title={t("assistant.analysis.whereInCode", "Where in the code")}>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("assistant.analysis.sourceRefs", "Source references")}>
              {a.rootCause.refs.map((r, i) => <li key={`${r.path}:${r.line}:${i}`} className="max-w-full"><CodeRefChip source={r} /></li>)}
            </ul>
          </Section>

          <Section title={t("assistant.analysis.evidence", "Evidence")}>
            <Steps items={a.evidence.steps} />
            <pre className="whitespace-pre-wrap rounded-md bg-surface2 p-2.5 font-mono text-[12px] text-ink2 [overflow-wrap:anywhere]">{a.evidence.failing}</pre>
            <p className="text-[12px] font-medium text-ink3">{t("assistant.analysis.stories", "Affected user stories")}</p>
            <Bullets items={a.evidence.stories} />
            <p className="text-[12px] font-medium text-ink3">{t("assistant.analysis.tests", "Tests")}</p>
            <Bullets items={a.evidence.tests} />
          </Section>

          <Section title={t("assistant.analysis.plan", "How it will be fixed")} icon={<ListOrdered {...ICON} aria-hidden />}>
            <Steps items={a.plan.steps} />
            <p className="text-[12px] font-medium text-ink3">{t("assistant.analysis.filesToChange", "Files to change")}</p>
            <ChipList items={a.plan.files} mono label={t("assistant.analysis.filesToChange", "Files to change")} />
            <p className="text-[12px] font-medium text-ink3">{t("assistant.analysis.testsToAdd", "Tests to add")}</p>
            <Bullets items={a.plan.tests} />
          </Section>
        </div>
      </details>

      <FixActions message={message} projectId={projectId} jobs={jobs} />
    </article>
  );
}
