/** "Start project analysis": the hand-over to the business analyst as a short guided window. Step 1 says what happens
 *  next (and what is still open, which is fine); step 2 hands over and shows "The business analyst is reading your
 *  material…" with the progress bar, then the next step of the journey opens. Same rules as the hand-over always had. */
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpenCheck, Check, CircleDashed, MessagesSquare, Rocket, ScanSearch } from "lucide-react";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { useNewSinceHandOver, type DocTreeData } from "@/madp/blocks/projects/docReads";
import { useRouteProject } from "@/madp/blocks/projects/reads";
import { useMemberName } from "@/madp/blocks/projects/context";
import { useHandOver } from "@/madp/blocks/projects/mutations";
import { messageFor, messageKeyOf } from "@/madp/blocks/projects/messages";
import { Banner } from "@/madp/ui/kit";
import { ShimmerProgress } from "@/madp/ui/ShimmerProgress";
import { StepHeading } from "@/madp/components/guided/GuidedSteps";
import { Illustration, SetupWindow } from "@/madp/components/setup/SetupWindow";
import { handOverState } from "./businessUi";
import { useSetupChecklist } from "./SetupChecklistCard";
import { useT } from "@/madp/i18n";

/** The reading moment stays on screen at least this long, so the hand-over reads as a step and not as a flash. */
const MIN_READING_MS = 1800;

export function StartAnalysisWindow({ project, data, canEdit, onClose }: {
  project: ProjectRecord; data: DocTreeData | undefined; canEdit: boolean; onClose: () => void;
}) {
  const t = useT();
  const STEPS = [t("analysis.business.start.stepNext", "What happens next"), t("analysis.business.start.stepHanding", "Handing over")];
  const { items } = useSetupChecklist(project, data);
  const navigate = useNavigate();
  const route = useRouteProject();
  const handOver = useHandOver();
  const since = useNewSinceHandOver(project.id);
  const by = useMemberName(project.handedOverByUserId ?? "");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const form = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const existing = project.type === "brownfield";
  const nextPage = `/p/${project.id}/understanding`;

  const state = handOverState({
    project,
    counts: { notes: data ? data.counts.notes : 0, readyFiles: data ? data.counts.readyFiles : 0 },
    hasScratch: Boolean(data?.scratch),
    canEdit,
    newCount: since.count,
    handedOverByName: project.handedOverByUserId ? by : null,
  });
  const open = items.filter((i) => !i.done);

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setStep(1);
    const t0 = Date.now();
    try {
      await handOver.run({ projectId: project.id });
      // Build the project brief from extracted files (fire-and-forget — Understanding page will show status)
      fetch(`/api/brief/${encodeURIComponent(project.id.toUpperCase())}/build`, { method: "POST" }).catch(() => {});
      const wait = MIN_READING_MS - (Date.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      onClose();
      navigate(nextPage);
    } catch (e) {
      if (messageKeyOf(e) === "business.alreadyHandedOver") { route.refetch(); onClose(); navigate(nextPage); return; }
      setError(messageFor(e));
      setStep(0);
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => () => { busy.current = false; }, []);

  return (
    <SetupWindow name={t("analysis.business.start.name", "Start project analysis")} steps={STEPS} step={step} dir={1} headingId={headingId} formRef={form}
      onClose={() => { if (!handOver.isPending) onClose(); }}
      onNext={() => { if (step === 0) void start(); }}
      nextLabel={step === 0 ? t("analysis.business.start.name", "Start project analysis") : t("analysis.business.handingOver", "Handing over…")}
      nextDisabled={step === 1 || state.disabled} busy={step === 1}
      footerNote={state.reason ? <span className="text-[13px] text-ink3">{state.reason}</span> : <span className="text-[13px] text-ink3">{t("analysis.business.start.takesMinutes", "Takes a few minutes. You can keep working meanwhile.")}</span>}>
      {step === 0 ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <Illustration icon={<Rocket size={30} strokeWidth={1.5} />} badge={<ScanSearch size={14} />} />
            <StepHeading id={headingId} title={t("analysis.business.start.ready", "Ready to start the analysis?")}
              text={existing
                ? t("analysis.business.start.readsExisting", "Your business analyst reads your material and the product's code, then comes back with questions and a first picture of the change.")
                : t("analysis.business.start.readsNew", "Your business analyst reads everything you shared, then comes back with questions and a first picture of what to build.")} />
          </div>
          {error && <Banner tone="danger" title={t("analysis.business.start.failed", "The analysis could not be started.")} text={error} />}
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: <BookOpenCheck size={18} />, title: t("analysis.business.start.reads", "Your analyst reads"), text: existing ? t("analysis.business.start.readsWhatExisting", "Your answers, documents and the code.") : t("analysis.business.start.readsWhatNew", "Your answers, notes and documents.") },
              { icon: <MessagesSquare size={18} />, title: t("analysis.business.start.asks", "Your analyst asks"), text: t("analysis.business.start.asksWhat", "Open questions come to you on the next step.") },
              { icon: <Check size={18} />, title: t("analysis.business.start.decide", "You decide"), text: t("analysis.business.start.decideWhat", "Nothing is built until you agree on the goals.") },
            ].map((s, i) => (
              <li key={s.title} className="rounded-block bg-surface2 p-4">
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent">{s.icon}</span>
                <p className="mt-3 text-[15px] font-medium"><span className="sr-only">{i + 1}. </span>{s.title}</p>
                <p className="mt-0.5 text-[13px] text-ink2">{s.text}</p>
              </li>
            ))}
          </ol>
          {open.length > 0 && (
            <div className="rounded-block bg-surface2 p-4">
              <p className="text-[14px] font-medium">{t("analysis.business.start.stillOpen", "Still open, and that's fine")}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {open.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 text-[13px] text-ink2"><CircleDashed size={14} aria-hidden className="shrink-0 text-ink3" />{i.label}</li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-ink3">{t("analysis.business.start.keepAdding", "You can keep adding material after the start; new items are marked as new.")}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid min-h-[320px] place-items-center text-center" role="status" aria-live="polite">
          <div className="flex w-full max-w-md flex-col items-center gap-5">
            <Illustration icon={<BookOpenCheck size={30} strokeWidth={1.5} />} tone="success" />
            <h2 id={headingId} tabIndex={-1} className="text-[24px] font-medium leading-tight tracking-[-0.02em] outline-none">{t("analysis.business.start.reading", "The business analyst is reading your material…")}</h2>
            <ShimmerProgress step={1} total={2} label={t("analysis.business.start.stepHanding", "Handing over")} valueText={t("analysis.business.start.handingToAnalyst", "Handing over to the business analyst")} />
            <p className="text-[14px] text-ink2">{t("analysis.business.start.takesMoment", "This takes a moment. The next step opens by itself.")}</p>
          </div>
        </div>
      )}
    </SetupWindow>
  );
}
