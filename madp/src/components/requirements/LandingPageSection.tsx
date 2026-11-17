/** "Add-on: Landing page" in the Requirements document: the goals and the Must / Should / Could requirements the
 *  business analyst wrote from the client's landing page answers (Understanding your project). Its own section with its
 *  own review: the requirements can be approved only once it is confirmed for the latest answers. "Change the answers"
 *  reopens the add-on's window; a save writes the section again and asks for a new review. */
import { landingChoiceName } from "./domainLabels";
import { useT } from "@/i18n";
import { PRIORITY_WORD } from "./priority";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ListChecks, PanelsTopLeft, PencilLine } from "lucide-react";
import { blocksAllOptions } from "@/blocks/data/hooks";
import { whereOf } from "@/blocks/data/gql";
import { useBlocksContext } from "@/blocks/context";
import { callProjectOp, putRows } from "@/blocks/projects/mutations";
import { messageFor } from "@/blocks/projects/messages";
import { SCHEMA, type RawRow } from "@/blocks/projects/records";
import { Button, Chip } from "@/ui/kit";
import { ShimmerProgress } from "@/ui/ShimmerProgress";
import { formatDateTime } from "@/lib/dates";
import { LandingPageDialog, useLandingAccess } from "@/components/sanitization/LandingPageAddOn";
import {
  landingReview, parseLandingAddOn, parseLandingSection, type LandingAddOn, type LandingPriority, type LandingReview,
  type LandingSection,
} from "@/domain/landingPage";
import { DocBlock } from "./ObjectiveTab";

interface Row {
  ItemId: string; RepoMode?: string | null; WebsiteUrl?: string | null; LandingPageAddOn?: string | null; LandingPageSection?: string | null;
  Stage?: string | null; ResumeTo?: string | null;
}
const FIELDS = ["ItemId", "RepoMode", "WebsiteUrl", "LandingPageAddOn", "LandingPageSection", "Stage", "ResumeTo"] as const;

export interface LandingSectionState {
  addOn: LandingAddOn | null;
  section: LandingSection | null;
  review: LandingReview;
  row: Row | null;
}

/** While the section is being written it is read every 3 s for this long, then every minute: a draft that never comes
 *  (its job failed or was never queued) was read every 3 s for as long as the page stayed open. */
export const LANDING_FAST_MS = 3_000;
export const LANDING_FAST_FOR_MS = 10 * 60_000;
export const LANDING_SLOW_MS = 60_000;

/** The pace while the section is being written: fast for the first LANDING_FAST_FOR_MS after it was first seen so. */
export function landingPollMs(preparingSince: number | null, now: number): number | false {
  if (preparingSince === null) return false;
  return now - preparingSince < LANDING_FAST_FOR_MS ? LANDING_FAST_MS : LANDING_SLOW_MS;
}

/** The add-on and its section; checks again every few seconds while the section is being written. */
export function useLandingSection(projectId: string): LandingSectionState {
  const { workspaceId } = useBlocksContext();
  const w = whereOf<Row>();
  const preparingSince = useRef<number | null>(null);
  const q = useQuery({
    ...blocksAllOptions<Row>(SCHEMA.project, { workspaceId: workspaceId ?? "", fields: [...FIELDS], where: w.eq("ItemId", projectId), maxItems: 1 }),
    enabled: Boolean(workspaceId && projectId),
    refetchInterval: (query) => {
      const r = (query.state.data as Row[] | undefined)?.[0];
      const preparing = !!r && landingReview(parseLandingAddOn(r.LandingPageAddOn), parseLandingSection(r.LandingPageSection)) === "preparing";
      const now = Date.now();
      preparingSince.current = preparing ? (preparingSince.current ?? now) : null;
      return landingPollMs(preparingSince.current, now);
    },
  });
  const row = q.data?.[0] ?? null;
  const addOn = parseLandingAddOn(row?.LandingPageAddOn);
  const section = parseLandingSection(row?.LandingPageSection);
  return { addOn, section, review: landingReview(addOn, section), row };
}

const word = (p: LandingPriority): string => (p === "must" ? PRIORITY_WORD.must : p === "should" ? PRIORITY_WORD.nice : PRIORITY_WORD.later);
const TONE: Record<LandingPriority, "accent" | "neutral" | "warning"> = { must: "accent", should: "neutral", could: "warning" };

export function LandingPageSection({ projectId, state, editable, memberName }: {
  projectId: string; state: LandingSectionState; editable: boolean; memberName: (id: string | null | undefined) => string | null;
}) {
  const t = useT();
  const { workspaceId } = useBlocksContext();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addOn, section, review, row } = state;
  const access = useLandingAccess(row ?? { ItemId: projectId });
  if (review === "none" || !addOn) return null;
  const canChange = access.editable;
  // changed after the requirements were approved: carried by a change request, not reviewed here
  const late = access.way === "change" && review !== "confirmed";

  const confirm = async () => {
    if (!section || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await callProjectOp<{ project: RawRow }>("project.addon.landingPage.confirm", { projectId, revision: section.revision });
      if (workspaceId && data.project) putRows(workspaceId, SCHEMA.project, [data.project]);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  const tag = review === "confirmed" ? <Chip tone="success" icon={<Check size={12} strokeWidth={2.25} />}>{t("analysis.requirements.landingConfirmed", "Confirmed")}</Chip>
    : late && addOn.changeNumber ? <Chip tone="warning">{t("analysis.requirements.landingChangeRequest", "Change request #{number}", { number: addOn.changeNumber })}</Chip>
    : review === "review" ? <Chip tone="warning">{t("analysis.requirements.landingToReview", "To review")}</Chip> : null;

  return (
    <section id="doc-landing" aria-label={t("analysis.requirements.landingPage", "Landing page")} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
      <DocBlock title={t("analysis.requirements.landingPage", "Landing page")} icon={<PanelsTopLeft size={18} strokeWidth={1.75} />}
        action={<>
          {tag}
          {canChange && (
            <Button size="sm" variant="ghost" icon={<PencilLine size={14} aria-hidden />} onClick={() => setOpen(true)}>{t("analysis.requirements.landingChangeAnswers", "Change the answers")}</Button>
          )}
        </>}>
        <p className="mb-3 text-[13px] text-ink2">{landingChoiceName(addOn.choice)}{addOn.answers?.title ? ` · "${addOn.answers.title}"` : ""}</p>
        {review === "preparing" || !section ? (
          <div role="status" className="rounded-block bg-surface2 px-4 py-3">
            <p className="text-[13px] text-ink2"><span className="font-medium text-ink">{t("analysis.requirements.yourAnalyst", "Your business analyst")}</span> · {t("analysis.requirements.landingWriting", "Writing the landing page section from your answers.")}</p>
            <ShimmerProgress step={45} total={100} ticks={false} active label={t("analysis.requirements.landingWritingLabel", "Writing the landing page section")} valueText={t("analysis.requirements.working", "Working")} size="sm" className="mt-2" />
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            {review === "review" && editable && (
              <p className="flex flex-wrap items-center gap-2 rounded-block bg-accent-soft/60 px-3 py-2 text-[13px] text-ink">
                <ListChecks size={15} aria-hidden className="text-[rgb(var(--c-accent-text))]" />
                <Chip tone="accent">{t("analysis.requirements.landingPrepared", "Prepared by your business analyst — review")}</Chip>
                <span className="text-ink2">{t("analysis.requirements.landingCheckBelow", "Check the goals and requirements below, then confirm them. To change them, change the answers.")}</span>
              </p>
            )}
            <div>
              <h4 className="mb-1.5 text-[13px] font-medium text-ink2">{t("analysis.requirements.landingGoals", "Goals")}</h4>
              <ul className="flex max-w-[72ch] list-disc flex-col gap-1 pl-5 text-[15px] leading-relaxed text-ink">
                {section.goals.map((g) => <li key={g} className="break-words">{g}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="mb-1.5 text-[13px] font-medium text-ink2">{t("analysis.requirements.checkRequirements", "Requirements")}</h4>
              <ol className="flex flex-col divide-y divide-line">
                {section.requirements.map((r, i) => (
                  <li key={`${i}-${r.title}`} className="flex min-w-0 flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                    <span className="w-16 shrink-0"><Chip tone={TONE[r.priority]}>{word(r.priority)}</Chip></span>
                    <span className="min-w-0">
                      <span className="block break-words text-[15px] font-medium text-ink">{r.title}</span>
                      <span className="block break-words text-[14px] text-ink2">{r.text}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            {late ? (
              <p className="text-[13px] text-ink2">{addOn.changeNumber
                ? t("analysis.requirements.landingLateChange", "Changed after the requirements were approved, so it goes to the development team as change request #{number}.", { number: addOn.changeNumber })
                : t("analysis.requirements.landingLate", "Changed after the requirements were approved.")}</p>
            ) : review === "confirmed" ? (
              <p className="text-[13px] text-ink2">{memberName(section.confirmedByUserId)
                ? t("analysis.requirements.landingConfirmedByOn", "Confirmed by {name} on {date}.", { name: memberName(section.confirmedByUserId) ?? "", date: formatDateTime(section.confirmedAt) })
                : t("analysis.requirements.landingConfirmedOn", "Confirmed on {date}.", { date: formatDateTime(section.confirmedAt) })}</p>
            ) : editable ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" icon={<Check size={15} aria-hidden />} disabled={busy} onClick={() => void confirm()}>
                  {busy ? t("analysis.requirements.confirming", "Confirming…") : t("analysis.requirements.landingConfirm", "Confirm the landing page section")}
                </Button>
                {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
              </div>
            ) : (
              <p className="text-[13px] text-ink2">{t("analysis.requirements.landingWaiting", "Waiting for the project team to confirm this section.")}</p>
            )}
          </div>
        )}
      </DocBlock>
      {canChange && row && workspaceId && (
        <LandingPageDialog open={open} onClose={() => setOpen(false)} workspaceId={workspaceId} projectId={projectId}
          websiteUrl={row.WebsiteUrl ?? ""} saved={addOn} way={access.way} />
      )}
    </section>
  );
}
