/** The Blocks print host: the same job store as the legacy one (../printJob), but it prints the records on screen:
 *  the scope (features with stories, milestones), all screens, or one screen. Mounted on the Blocks path only. */
import { PRIORITY_WORD } from "@/madp/components/requirements/priority";
import { SUCCESS_KEYS, isBlank, targetState, type SuccessTargets } from "@/madp/domain/successTargets";
import { successShortName } from "@/madp/components/requirements/domainLabels";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cspNonce } from "@/madp/lib/cspNonce";
import { PRODUCT } from "@/madp/data/facts";
import { PRINT_CSS, PRINT_ROOT_CLASS, usePrintPrep } from "@/madp/components/showcase/print";
import { clearScopePdf, usePdfJob, type PdfJob } from "../printJob";
import { getCulture, t } from "@/madp/i18n";

export interface PrintFeature { id: string; ref?: string; name: string; description?: string; priority: string }
export interface PrintStory { id: string; featureId: string; actor: string; text: string; acceptanceCriteria?: readonly string[] }
export interface PrintMilestone { id: string; number: number; name: string; goal?: string; featureRefs: readonly string[] }
export interface PrintScreen { id: string; name: string; purpose?: string; device?: string }

export interface PrintData {
  projectName: string; clientName?: string | null; objective: string | null; versionNumber: number | null;
  /** locked scope: when it was locked (ISO) and by whom; null while the scope is a draft */
  lockedAt?: string | null; lockedBy?: string | null;
  /** the date the copy is produced (ISO); defaults to now */
  generatedAt?: string;
  features: readonly PrintFeature[]; stories: readonly PrintStory[]; milestones: readonly PrintMilestone[]; screens: readonly PrintScreen[];
  /** Success & performance of the version (left out when not given) */
  success?: SuccessTargets | null;
}

/** One line per success target for the document: the agreed value, or where its question stands. */
export function successLines(targets: SuccessTargets): { label: string; text: string }[] {
  return SUCCESS_KEYS.flatMap((k) => {
    const x = targets[k];
    const st = targetState(x);
    if (st === "missing") return k === "availability" ? [] : [{ label: successShortName(k), text: t("analysis.scope.success.notSetYet", "Not set yet") }];
    const text = st === "set" ? x.value
      : st === "accepted" ? t("analysis.scope.print.noFixedValue", "No fixed value; working assumption: {assumption}", { assumption: x.question?.answer || t("analysis.scope.print.toBeProposed", "to be proposed during the build") })
      : t("analysis.scope.print.openQuestion", "Open question for the business analyst: {question}", { question: x.question?.text ?? "" });
    return [{ label: successShortName(k), text }];
  });
}

/** Read at render time, in the current language. */
const PRIORITY_LABEL: Record<string, string> = {
  get must() { return PRIORITY_WORD.must; },
  get nice() { return PRIORITY_WORD.nice; },
  get later() { return PRIORITY_WORD.later; },
  get excluded() { return t("analysis.scope.notIncluded", "Not included"); },
};
const PRIORITIES = ["must", "nice", "later", "excluded"];

export function printTitle(job: PdfJob, d: PrintData): string {
  if (job.type === "scope") return `${d.projectName} – ${t("analysis.scope.header.scope", "Scope")}`;
  const one = job.type === "screen" ? d.screens.find((s) => s.id === job.screenId) : undefined;
  return one ? `${d.projectName} – ${one.name}` : `${d.projectName} – ${t("analysis.scope.print.screenDesigns", "Screen designs")}`;
}

export function BlocksScopePrint({ data }: { data: PrintData }) {
  const job = usePdfJob((s) => s.job);
  return job ? <Job job={job} data={data} /> : null;
}

function Job({ job, data }: { job: PdfJob; data: PrintData }) {
  usePrintPrep(printTitle(job, data));
  // two frames so the copy is laid out, then print; the job ends with the dialog (idempotent)
  useEffect(() => {
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        window.addEventListener("afterprint", clearScopePdf, { once: true });
        try { window.print(); } finally { clearScopePdf(); }
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      window.removeEventListener("afterprint", clearScopePdf);
    };
  }, []);
  return createPortal(
    <div className={PRINT_ROOT_CLASS}>
      <style nonce={cspNonce()}>{PRINT_CSS + pageFooterCss(data, job)}</style>
      <article className="bg-surface text-ink [text-wrap:pretty]">
        <PrintBody job={job} data={data} />
      </article>
    </div>,
    document.body,
  );
}

export function PrintBody({ job, data }: { job: PdfJob; data: PrintData }) {
  if (job.type === "scope") return <ScopeCopy data={data} />;
  const screens = job.type === "screen" ? data.screens.filter((s) => s.id === job.screenId) : data.screens;
  return (
    <>
      {screens.map((s, i) => (
        <section key={s.id} className={i === 0 ? "" : "sc-break"}>
          <div className="text-[13px] text-ink3">{data.projectName} · {t("analysis.scope.print.screenDesigns", "Screen designs")}</div>
          <h2 className="mt-1 text-[28px] font-medium tracking-[-0.02em]">{s.name}</h2>
          {s.purpose && <p className="mt-1 max-w-[70ch] text-[14px] text-ink2">{s.purpose}</p>}
          {s.device && <div className="mb-4 mt-1 text-[12px] text-ink3">{s.device === "mobile" ? t("analysis.scope.print.shownOnPhone", "Shown on a phone") : t("analysis.scope.print.shownOnDesktop", "Shown on a desktop")}</div>}
        </section>
      ))}
    </>
  );
}

/** Page numbers and a running footer in the page margin (Chrome 131+; other browsers print without them). */
export function pageFooterCss(d: PrintData, job: PdfJob): string {
  const label = printTitle(job, d).replace(/["\\\n]/g, " ");
  return `@media print { @page { margin: 12mm 12mm 16mm;
  @bottom-left { content: "${label}"; font: 9pt sans-serif; color: #6b7280; }
  @bottom-right { content: "${t("analysis.scope.print.page", "Page").replace(/["\\\n]/g, " ")} " counter(page) " ${t("analysis.scope.print.of", "of").replace(/["\\\n]/g, " ")} " counter(pages); font: 9pt sans-serif; color: #6b7280; } } }`;
}

export function dateLabel(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(getCulture() === "de-CH" ? "de-CH" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function Heading({ children }: { children: string }) {
  return <h2 className="sc-keep mb-3 mt-8 [break-after:avoid] border-b border-line pb-2 text-[22px] font-medium tracking-[-0.02em]">{children}</h2>;
}

function Brand() {
  return (
    <div className="flex items-center gap-2 text-[13px] font-medium text-ink2">
      <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-accent text-white">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 20V9l5 3V9l5 3V6l8 4v10z" /><path d="M7 20v-3M12 20v-3M17 20v-3" />
        </svg>
      </span>
      {PRODUCT}
    </div>
  );
}

/** The document's "Scope version" value in words: "First version", "Version 2", or "Not started". */
export function scopeVersionText(n: number | null): string {
  return n === null ? t("analysis.scope.print.notStarted", "Not started") : n > 1 ? t("analysis.scope.print.versionN", "Version {n}", { n }) : t("analysis.scope.print.firstVersion", "First version");
}

export function lockLine(d: PrintData): string {
  if (!d.lockedAt) return t("analysis.scope.print.draftNotLocked", "Draft, not yet locked");
  return d.lockedBy
    ? t("analysis.scope.print.lockedOnBy", "Locked on {date} by {name}", { date: dateLabel(d.lockedAt), name: d.lockedBy })
    : t("analysis.scope.print.lockedOn", "Locked on {date}", { date: dateLabel(d.lockedAt) });
}

function ScopeCopy({ data: d }: { data: PrintData }) {
  // a milestone lists its features by name; a reference whose feature is not read lists nothing (never the raw ref)
  const nameOf = (ref: string): string | null => d.features.find((f) => f.ref === ref || `feature:${f.id}` === ref || f.id === ref)?.name ?? null;
  const inScope = d.features.filter((f) => f.priority !== "excluded");
  const out = d.features.filter((f) => f.priority === "excluded");
  const storiesOf = (id: string) => d.stories.filter((s) => s.featureId === id);
  const storyCount = inScope.reduce((n, f) => n + storiesOf(f.id).length, 0);
  const milestones = [...d.milestones].sort((a, b) => a.number - b.number);
  return (
    <>
      <header className="sc-keep border-b-2 border-accent pb-5">
        <Brand />
        <div className="mt-6 text-[12px] font-medium uppercase tracking-[0.08em] text-ink3">{t("analysis.scope.print.document", "Scope document")}</div>
        <h1 className="mt-1 text-[44px] font-medium leading-[1] tracking-[-0.03em]">{d.projectName}</h1>
        {d.clientName && <div className="mt-2 text-[16px] text-ink2">{t("analysis.scope.print.preparedFor", "Prepared for {name}", { name: d.clientName })}</div>}
        <dl className="mt-5 grid grid-cols-3 gap-4 text-[12.5px]">
          <div><dt className="text-ink3">{t("analysis.scope.print.scopeVersion", "Scope version")}</dt><dd className="font-medium">{scopeVersionText(d.versionNumber)}</dd></div>
          <div><dt className="text-ink3">{t("analysis.scope.print.status", "Status")}</dt><dd className="font-medium">{lockLine(d)}</dd></div>
          <div><dt className="text-ink3">{t("analysis.scope.print.generated", "Generated")}</dt><dd className="font-medium">{dateLabel(d.generatedAt)}</dd></div>
        </dl>
      </header>
      {d.objective && (<><Heading>{t("analysis.scope.print.objective", "Objective")}</Heading><p className="max-w-[70ch] text-[19px] font-medium leading-snug">{d.objective}</p></>)}
      <p className="mt-4 text-[13px] text-ink2">
        {[
          inScope.length === 1 ? t("analysis.scope.print.featuresInScopeOne", "1 feature in scope") : t("analysis.scope.print.featuresInScope", "{count} features in scope", { count: inScope.length }),
          storyCount === 1 ? t("analysis.scope.print.userStoryOne", "1 user story") : t("analysis.scope.print.userStories", "{count} user stories", { count: storyCount }),
          milestones.length === 1 ? t("analysis.scope.print.milestoneOne", "1 milestone") : t("analysis.scope.print.milestones", "{count} milestones", { count: milestones.length }),
          d.screens.length === 1 ? t("analysis.scope.print.screenOne", "1 screen") : t("analysis.scope.print.screens", "{count} screens", { count: d.screens.length }),
          ...(out.length ? [t("analysis.scope.print.notIncludedCount", "{count} not included", { count: out.length })] : []),
        ].join(", ")}.
      </p>
      <Heading>{t("analysis.scope.print.inScope", "In scope: features and user stories")}</Heading>
      {inScope.length === 0 && <p className="text-[13px] text-ink3">{t("analysis.scope.noFeaturesYetDot", "No features yet.")}</p>}
      {PRIORITIES.filter((p) => p !== "excluded").map((p) => {
        const list = inScope.filter((f) => f.priority === p);
        if (!list.length) return null;
        return (
          <section key={p} className="mt-4">
            <h3 className="sc-keep text-[12px] font-medium uppercase tracking-[0.06em] text-ink3">{PRIORITY_LABEL[p]} · {list.length}</h3>
            <ul className="mt-2 space-y-2">
              {list.map((f) => (
                <li key={f.id} className="sc-keep rounded-block bg-surface2 px-4 py-3">
                  <div className="text-[14px] font-medium">{f.name}</div>
                  {f.description && <p className="mt-0.5 text-[13px] text-ink2">{f.description}</p>}
                  <ol className="mt-2 space-y-2">
                    {storiesOf(f.id).map((s) => (
                      <li key={s.id} className="text-[12.5px] text-ink2">
                        {t("analysis.scope.storySentence", "As {who}, I can {what}", { who: s.actor, what: s.text })}
                        {s.acceptanceCriteria && s.acceptanceCriteria.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 text-ink3">
                            {s.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <Heading>{t("analysis.scope.print.outOfScope", "Out of scope")}</Heading>
      {out.length === 0 ? <p className="text-[13px] text-ink3">{t("analysis.scope.print.nothingLeftOut", "Nothing has been left out.")}</p> : (
        <ul className="space-y-2">
          {out.map((f) => (
            <li key={f.id} className="sc-keep rounded-block bg-surface2 px-4 py-3">
              <div className="text-[14px] font-medium">{f.name}</div>
              {f.description && <p className="mt-0.5 text-[13px] text-ink2">{f.description}</p>}
            </li>
          ))}
        </ul>
      )}
      <Heading>{t("analysis.scope.milestones", "Milestones")}</Heading>
      {milestones.length === 0 ? <p className="text-[13px] text-ink3">{t("analysis.scope.milestone.none", "No milestones planned yet.")}</p> : (
        <ol className="space-y-2">
          {milestones.map((m) => (
            <li key={m.id} className="sc-keep rounded-block bg-surface2 px-4 py-3">
              <div className="text-[14px] font-medium">{m.number}. {m.name}</div>
              {m.goal && <p className="text-[13px] text-ink2">{m.goal}</p>}
              {m.featureRefs.some((r) => nameOf(r) !== null) && (
                <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink3">
                  {m.featureRefs.map((r) => ({ r, name: nameOf(r) })).filter((x) => x.name !== null).map((x) => <li key={x.r}>{x.name}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {d.success && !isBlank(d.success) && (
        <>
          <Heading>{t("analysis.scope.success.title", "Success & performance")}</Heading>
          <dl className="space-y-1.5">
            {successLines(d.success).map((l) => (
              <div key={l.label} className="sc-keep grid grid-cols-[160px_1fr] gap-3 text-[13px]">
                <dt className="text-ink3">{l.label}</dt><dd>{l.text}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <Heading>{t("analysis.scope.summary.screens", "Screens")}</Heading>
      {d.screens.length === 0 ? <p className="text-[13px] text-ink3">{t("analysis.scope.print.noScreenDesigns", "No screen designs yet.")}</p> : (
        <ul className="space-y-1.5">
          {d.screens.map((s) => (
            <li key={s.id} className="sc-keep text-[13px]">
              <span className="font-medium">{s.name}</span>
              {s.device && <span className="text-ink3"> · {s.device === "mobile" ? t("analysis.scope.print.phone", "phone") : t("analysis.scope.print.desktop", "desktop")}</span>}
              {s.purpose && <span className="text-ink2"> · {s.purpose}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
