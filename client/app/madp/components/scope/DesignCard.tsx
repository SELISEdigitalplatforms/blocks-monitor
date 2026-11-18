/** One generated screen design (a design.generate result): the screenshot in a fixed frame that opens the preview
 *  window, its number, name, purpose, the features it serves, the device, and feedback beside it (never nested in the
 *  button). Only what the MADP engine returned is shown; a screen without a readable image shows its name. */
import { useRef } from "react";
import { Eye, LoaderCircle, MessageSquareCheck, Monitor, Smartphone } from "lucide-react";
import type { DesignScreenRecord } from "@/madp/blocks/scope/records";
import { cn } from "@/madp/lib/cn";
import { Chip } from "@/madp/ui/kit";
import { FeedbackItem } from "@/madp/components/feedback/FeedbackItem";
import { ScopeFeedbackButton } from "./blocks/ScopeFeedback";
import { useT } from "@/madp/i18n";

/** the one preview frame height of every design card, desktop and mobile alike */
export const DESIGN_FRAME_H = "h-[220px]";

export const SCREEN_UPDATED_TEXT = "Updated from your comment";
export const SCREEN_WORKING_TEXT = "The designer is working on this…";
/** The two texts above are the English source; the card shows them in the current language. */

/** What a screen card says about its feedback thread: "updated" once the designer made a new version from a comment
 *  (version above 1 and the thread waits for the person), "working" while the designer is on it, else nothing. */
export function screenFeedbackState(version: number | null | undefined, threadStatus: string | null | undefined): "updated" | "working" | null {
  if (threadStatus === "working") return "working";
  if (threadStatus === "updated" && (version ?? 1) > 1) return "updated";
  return null;
}

export function DesignCard({ screen, index, url, featureNames, onOpen, onImageError, version, threadStatus }: {
  screen: DesignScreenRecord;
  index: number;
  url: string | undefined;
  featureNames: string[];
  onOpen: () => void;
  /** Called at most once per card: the signed URL may have expired, so the page fetches fresh ones. */
  onImageError: () => void;
  /** the screen's Version (1 = the first design) */
  version?: number | null;
  /** the status of the screen's feedback thread (open, working, updated, resolved), or null without one */
  threadStatus?: string | null;
}) {
  const t = useT();
  const retried = useRef(false);
  const mobile = screen.viewport === "mobile";
  const fb = screenFeedbackState(version, threadStatus);
  return (
    <FeedbackItem as="li" type="screen" id={screen.id} className="flex min-w-0 flex-col rounded-block bg-surface2 p-3">
      <button type="button" data-screen-card={screen.id} onClick={onOpen} aria-label={t("analysis.scope.design.openAria", "Open the {name} design", { name: screen.name })}
        className="group/prev relative block w-full overflow-hidden rounded-[14px] bg-canvas outline-none ring-1 ring-line transition hover:ring-ink3/40 focus-visible:ring-2 focus-visible:ring-accent/50">
        <div className={cn(DESIGN_FRAME_H, "grid w-full place-items-center p-3")}>
          {url ? (
            <img src={url} alt={screen.name} loading="lazy" referrerPolicy="no-referrer"
              className={cn("h-auto max-h-[196px] w-auto max-w-full object-contain object-top shadow-card ring-1 ring-line", mobile ? "rounded-[14px]" : "rounded-[6px]")}
              onError={() => { if (!retried.current) { retried.current = true; onImageError(); } }} />
          ) : (
            <span className="hatched grid h-full w-full place-items-center rounded-block bg-surface2 px-4 text-center text-[14px] text-ink3">{screen.name}</span>
          )}
        </div>
        <span aria-hidden className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] shadow-card transition [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/prev:opacity-100 [@media(hover:hover)]:group-focus-visible/prev:opacity-100">
          <Eye size={12} strokeWidth={1.75} /> {t("analysis.scope.design.openPreview", "Open preview")}
        </span>
      </button>
      <div className="px-1 pt-3">
        <div className="flex items-start gap-2">
          <span className="num mt-0.5 w-4 shrink-0 text-[12px] text-ink3">{index + 1}</span>
          <div className="min-w-0 flex-1 break-words text-[14px] font-medium">{screen.name}</div>
          <ScopeFeedbackButton target={{ type: "screen", id: screen.id }} label={screen.name} className="-my-1" />
        </div>
        {screen.purpose && <div className="mt-1 break-words text-[12px] text-ink2">{screen.purpose}</div>}
        {fb === "working" && (
          <p role="status" className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink3">
            <LoaderCircle size={12} strokeWidth={1.75} aria-hidden className="shrink-0 animate-spin motion-reduce:animate-none" />
            {t("analysis.scope.design.working", "The designer is working on this…")}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {fb === "updated" && (
            <Chip tone="accent" icon={<MessageSquareCheck size={12} strokeWidth={1.75} aria-hidden />}>{t("analysis.scope.design.updated", "Updated from your comment")}</Chip>
          )}
          {featureNames.map((n) => (
            <Chip key={n} className="max-w-full" title={n}><span className="truncate">{n}</span></Chip>
          ))}
          <Chip icon={mobile ? <Smartphone size={12} strokeWidth={1.75} aria-hidden /> : <Monitor size={12} strokeWidth={1.75} aria-hidden />}>
            {mobile ? t("analysis.scope.design.mobile", "Mobile") : t("analysis.scope.design.desktop", "Desktop")}
          </Chip>
        </div>
      </div>
    </FeedbackItem>
  );
}
