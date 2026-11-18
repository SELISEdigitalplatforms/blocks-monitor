/** The Build step's main area, Overview tab: the milestone the step is about now, in plain words (what it delivers, how
 *  far the work is, its preview to try), and every milestone with its state and preview. Read from the same records as
 *  the Board, the Studio and the Timeline; nothing here is invented. */
import type { ReactNode, RefObject } from "react";
import { Check, Copy, ExternalLink, Hammer, MonitorSmartphone } from "lucide-react";
import type { DeliveryMilestone, DeliveryPreview, DeliveryTicket } from "@/madp/blocks/delivery/types";
import { appLink } from "@/madp/domain/appPreview";
import { manualCopy, useCopy } from "@/madp/components/delivery/shared";
import { Bar, Button, Card, Chip, Input } from "@/madp/ui/kit";
import { formatDateTime } from "@/madp/lib/dates";
import { cn } from "@/madp/lib/cn";
import { t, useT } from "@/madp/i18n";
import type { ChipTone } from "@/madp/data/types";
import { isAccepted, milestoneWord, ticketProgress, workWords, type BuildStepState } from "./buildStep";

/** The chip tone of a milestone's word (buildStep.ts milestoneWord), in the language it was said in. */
const wordTone = (word: string): ChipTone => ({
  [t("build.step.milestone.accepted", "Accepted")]: "success", [t("build.step.milestone.delivered", "Delivered")]: "success",
  [t("build.step.milestone.readyToTry", "Ready to try")]: "accent", [t("build.step.milestone.building", "Being built")]: "accent",
  [t("build.step.milestone.stopped", "Stopped")]: "danger", [t("build.step.milestone.planned", "Planned")]: "neutral",
} as Record<string, ChipTone>)[word] ?? "neutral";

/** "Open the preview" (a new tab) and "Copy link"; the address itself only when copying needs the person's hand. */
export function PreviewButtons({ url, label, primary, onOpen }: { url: string; label: string; primary?: boolean; onOpen?: () => void }) {
  const t = useT();
  const { state, copy, target } = useCopy(url);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={label} onClick={onOpen}
        className={cn("inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
          primary ? "bg-accent text-white hover:bg-accent-hover" : "bg-surface text-ink ring-1 ring-inset ring-line hover:bg-surface2")}>
        <ExternalLink size={15} strokeWidth={1.75} aria-hidden />{t("build.overview.openPreview", "Open the preview")}
      </a>
      <Button size="sm" variant="ghost" onClick={copy}
        icon={state === "copied" ? <Check size={14} strokeWidth={1.75} aria-hidden /> : <Copy size={14} strokeWidth={1.75} aria-hidden />}>
        {state === "copied" ? t("build.overview.copied", "Copied") : t("build.overview.copyLink", "Copy link")}
      </Button>
      {state === "manual" && (
        <div className="w-full min-w-0" ref={target as RefObject<HTMLDivElement>}>
          <Input readOnly value={url} aria-label={t("build.overview.previewLink", "Preview link")} onFocus={(e) => e.currentTarget.select()} />
          <p role="status" className="mt-1 text-[12px] text-ink2">{manualCopy(t("build.overview.link", "Link"))}</p>
        </div>
      )}
      {state === "copied" && <span role="status" className="sr-only">{t("build.overview.linkCopied", "Link copied")}</span>}
    </div>
  );
}

const readyLine = (p: DeliveryPreview) => {
  const at = formatDateTime(p.createdAt);
  return at ? t("build.overview.versionSince", "Version {version} · online since {at}", { version: p.version, at }) : t("build.overview.version", "Version {version}", { version: p.version });
};

export interface BuildOverviewProps {
  step: BuildStepState<DeliveryMilestone>;
  milestones: readonly DeliveryMilestone[];
  tickets: readonly DeliveryTicket[];
  previewOf: (milestoneId: string) => DeliveryPreview | null;
  /** The milestone a build runs for now, or null. */
  runningId: string | null;
  /** True when a milestone's newest build (or preview) failed or was cancelled (buildStep.ts milestoneStopped). */
  stoppedOf?: (milestoneId: string) => boolean;
  /** "Accepted by Anna Rossi on 26 Oct 2026, 08:45" for an accepted milestone, else null. */
  acceptedText: (m: DeliveryMilestone) => string | null;
  /** Extra actions beside the preview (feedback, accept). */
  previewActions?: ReactNode;
  /** Under the preview (the feedback list). */
  previewFooter?: ReactNode;
  /** Start the next milestone while the current one waits for acceptance. */
  alsoStart?: { label: string; onClick: () => void; disabled?: boolean } | null;
  onOpenBoard: () => void;
  /** Opens the Queue tab (the planned work and what waits for what). */
  onOpenQueue?: () => void;
  /** A preview link was opened (milestone id). */
  onPreviewOpen?: (milestoneId: string) => void;
}

export function BuildOverview({ step, milestones, tickets, previewOf, runningId, stoppedOf, acceptedText, previewActions, previewFooter, alsoStart, onOpenBoard, onOpenQueue, onPreviewOpen }: BuildOverviewProps) {
  const t = useT();
  const m = step.current;
  const sorted = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);
  const preview = m ? previewOf(m.id) : null;
  const url = preview ? appLink(preview)?.href ?? null : null;
  const pct = step.currentTickets.total ? Math.round((step.currentTickets.done / step.currentTickets.total) * 100) : 0;
  const word = m ? milestoneWord(m, runningId === m.id, stoppedOf?.(m.id)) : "";
  const accepted = m ? acceptedText(m) : null;

  const previewBody = (() => {
    if (!m) return null;
    if (url && preview) {
      return (
        <>
          <p className="text-[14px] text-ink">
            {step.phase === "review" ? t("build.overview.tryIt", "Try it in your browser: click through it as your users would, then accept it or tell the team what to change.")
              : isAccepted(m) ? t("build.overview.acceptedVersion", "This is the version that was accepted.") : t("build.overview.online", "The preview is online.")}
          </p>
          <p className="num text-[12px] text-ink3">{readyLine(preview)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PreviewButtons url={url} label={t("build.overview.openPreviewOf", "Open the preview of milestone {number}: {name}", { number: m.number, name: m.name })} onOpen={() => onPreviewOpen?.(m.id)} />
            {previewActions}
          </div>
          {previewFooter}
        </>
      );
    }
    const text = step.phase === "deploying" ? t("build.overview.deploying", "The milestone is built. Its preview is going online and opens here in a moment.")
      : step.phase === "building" || step.phase === "queued" ? t("build.overview.building", "The preview goes online as soon as the team has built and checked every ticket.")
        : t("build.overview.later", "The preview comes once this milestone is built.");
    return <p className="text-[14px] text-ink2">{text}</p>;
  })();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      {m ? (
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink3">
            <span className="num">{t("build.overview.milestoneOf", "Milestone {number} of {total}", { number: m.number, total: sorted.length })}</span>
            <Chip tone={wordTone(word)}>{word}</Chip>
          </div>
          <h3 className="mt-2 text-[20px] font-medium leading-snug tracking-[-0.01em]">{m.name}</h3>
          {m.goal && <p className="mt-1.5 max-w-[70ch] text-[14px] leading-relaxed text-ink2">{m.goal}</p>}
          {accepted && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-[13px] text-[rgb(var(--c-success-text))]">
              <Check size={14} strokeWidth={2.25} aria-hidden />{accepted}
            </p>
          )}

          <div className="mt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[14px] font-medium text-ink">
                {t("build.overview.ticketsDone", "{done} of {total} tickets done", { done: step.currentTickets.done, total: step.currentTickets.total })}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <button type="button" onClick={onOpenBoard} className="text-[13px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">
                  {t("build.overview.seeBoard", "See them on the board")}
                </button>
                {onOpenQueue && (
                  <button type="button" onClick={onOpenQueue} className="text-[13px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">
                    {t("build.overview.seeQueue", "See the queue")}
                  </button>
                )}
              </span>
            </div>
            <Bar value={pct} tone={pct === 100 ? "success" : "accent"} className="mt-2 h-2" />
            <p className="mt-2 text-[13px] text-ink2">{workWords(tickets, m.id)}</p>
          </div>

          <div id="build-preview" tabIndex={-1} className="mt-5 flex min-w-0 scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] flex-col gap-3 border-t border-line pt-5 outline-none">
            <h4 className="flex items-center gap-2 text-[15px] font-medium">
              <MonitorSmartphone size={17} strokeWidth={1.75} aria-hidden className="text-ink3" />{t("build.overview.preview", "The preview")}
            </h4>
            {previewBody}
          </div>
        </Card>
      ) : (
        <Card><p className="text-[14px] text-ink2">{t("build.page.noMilestonesText", "The locked scope has no milestones to build.")}</p></Card>
      )}

      <Card title={t("build.overview.allMilestones", "All milestones")} className="min-w-0">
        <ol id="build-milestones" tabIndex={-1} className="flex flex-col outline-none">
          {sorted.map((x) => {
            const w = milestoneWord(x, runningId === x.id, stoppedOf?.(x.id));
            const p = previewOf(x.id);
            const link = p ? appLink(p)?.href ?? null : null;
            const tp = ticketProgress(tickets, x.id);
            const done = isAccepted(x);
            return (
              <li key={x.id} className={cn("flex min-w-0 items-start gap-3 border-b border-line py-3 last:border-b-0", x.id === m?.id && "font-medium")}>
                <span aria-hidden className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] num",
                  done ? "bg-success text-white dark:text-canvas" : x.id === m?.id ? "bg-accent-soft text-[rgb(var(--c-accent-text))]" : "bg-surface2 text-ink2")}>
                  {done ? <Check size={13} strokeWidth={3} /> : x.number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 break-words text-[14px] text-ink">{x.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] font-normal text-ink3">
                    <span>{w}</span>
                    <span aria-hidden>·</span>
                    <span className="num">{tp.total === 1 ? t("build.overview.ticketsOfOne", "{done} of 1 ticket", { done: tp.done }) : t("build.overview.ticketsOfMany", "{done} of {total} tickets", { done: tp.done, total: tp.total })}</span>
                    {link && (<>
                      <span aria-hidden>·</span>
                      <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => onPreviewOpen?.(x.id)} className="font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline"
                        aria-label={t("build.overview.openPreviewOf", "Open the preview of milestone {number}: {name}", { number: x.number, name: x.name })}>{t("build.overview.previewShort", "Preview")}</a>
                    </>)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        {alsoStart && (
          <div className="mt-3 border-t border-line pt-3">
            <Button size="sm" variant="secondary" icon={<Hammer size={14} strokeWidth={1.75} aria-hidden />} onClick={alsoStart.onClick} disabled={alsoStart.disabled}>
              {alsoStart.label}
            </Button>
            <p className="mt-1.5 text-[12px] text-ink3">{t("build.overview.goOn", "The team can go on with the next milestone while you try this one.")}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
