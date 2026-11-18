/** "Preview the screens": the generated designs (design.generate screenshots) in a near full screen window. The design
 *  shows at full size and scrolls with the window; the toggle switches to the same screen's other device when the
 *  engine made one, ←/→ move between the screens, and Feedback opens the screen's feedback thread. A screen the designer
 *  redesigned from a comment can be compared with its previous version, then accepted (the thread closes) or commented
 *  on again. */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Columns2, LoaderCircle, MessageSquare, MessageSquareCheck, Monitor, Smartphone } from "lucide-react";
import type { DesignScreenRecord } from "@/madp/blocks/scope/records";
import { scopeErrorMessage } from "@/madp/blocks/scope/messages";
import { cn } from "@/madp/lib/cn";
import { AiTag, Button, Chip, Modal, Segmented } from "@/madp/ui/kit";
import { useOpenScopeFeedback } from "./blocks/ScopeFeedback";
import { useT } from "@/madp/i18n";

const SECTION = "text-[12px] font-medium uppercase tracking-wider text-ink3";

export const COMPARE_TEXT = "Compare with the previous version";
export const UPDATED_NOTE = "The designer made a new version of this screen from your comment. Have a look, then accept it or comment again.";
export const ACCEPTED_TEXT = "Accepted and closed.";
/** The texts above are the English source; the window shows them in the current language. */

/** A screen's feedback thread, as the preview needs it. */
export interface PreviewThread { id: string; status: string }
/** The previous version of a screen: its screenshot URL when one could be read. */
export interface PreviewPrevious { id: string; url: string | undefined }

export function DesignPreviewModal({ screens, index, urls, featureNamesOf, onIndexChange, onClose, onImageError, threadOf, previousOf, onAccept, noAcceptReason }: {
  screens: DesignScreenRecord[];
  index: number;
  urls: Record<string, string>;
  featureNamesOf: (screen: DesignScreenRecord) => string[];
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onImageError: () => void;
  /** the screen's feedback thread, or null without one */
  threadOf?: (screen: DesignScreenRecord) => PreviewThread | null;
  /** the screen's previous version (same screen, lower version), or null when it has none */
  previousOf?: (screen: DesignScreenRecord) => PreviewPrevious | null;
  /** accepts the designer's update and closes the thread; absent when the person may not (or the scope is locked) */
  onAccept?: (threadId: string) => Promise<unknown>;
  /** why "Accept and close" is not offered (shown under the update), when it is not */
  noAcceptReason?: string;
}) {
  const t = useT();
  const openFeedback = useOpenScopeFeedback();
  const activeRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [compare, setCompare] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<{ id: string; text: string } | null>(null);
  const n = screens.length;
  const screen = screens[index];
  const go = (d: 1 | -1) => n > 0 && onIndexChange((index + d + n) % n);

  // the arrows move the selection: when the keyboard is in the list, the focus moves with it
  useEffect(() => { if (navRef.current?.contains(document.activeElement)) activeRef.current?.focus(); }, [index]);
  useEffect(() => {
    if (n === 0) return;
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest("[role=radiogroup],[role=tablist],input,textarea")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onIndexChange((index + 1) % n); }
      if (e.key === "ArrowLeft") { e.preventDefault(); onIndexChange((index - 1 + n) % n); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [index, n, onIndexChange]);

  if (!screen) return null;
  const mobile = screen.viewport === "mobile";
  const other = screens.findIndex((s, i) => i !== index && s.name === screen.name && s.viewport !== screen.viewport);
  const url = urls[screen.id];
  const features = featureNamesOf(screen);
  const DeviceIcon = mobile ? Smartphone : Monitor;
  const feedback = () => {
    onClose();
    openFeedback({ type: "screen", id: screen.id }, screen.name);
  };
  const thread = threadOf?.(screen) ?? null;
  const status: string = thread?.status ?? "";
  const previous = previousOf?.(screen) ?? null;
  const comparing = compare && previous !== null;
  const updated = thread !== null && status === "updated";
  const accept = async () => {
    if (!thread || !onAccept || accepting) return;
    setAccepting(thread.id);
    setAcceptError(null);
    try {
      await onAccept(thread.id);
      setAccepted(thread.id);
    } catch (e) {
      setAcceptError({ id: thread.id, text: scopeErrorMessage(e) });
    } finally {
      setAccepting(null);
    }
  };
  const image = (src: string | undefined, alt: string, key: string) => (src ? (
    <div className={cn("mx-auto w-full", mobile && "max-w-[390px]")}>
      <img key={key} src={src} alt={alt} referrerPolicy="no-referrer" onError={onImageError}
        className={cn("mx-auto block h-auto max-w-full shadow-card ring-1 ring-line", mobile ? "rounded-[28px]" : "rounded-[10px]")} />
    </div>
  ) : (
    <p className="px-4 py-10 text-center text-[14px] text-ink3">{t("analysis.scope.preview.noScreenshot", "The screenshot is not available right now.")}</p>
  ));

  return (
    <Modal open onClose={onClose} width={1680}
      title={<span className="flex flex-wrap items-center gap-3">{screen.name} <AiTag>{t("analysis.scope.preview.designedBy", "Designed by your team")}</AiTag></span>}
      footer={<>
        <div className="mr-auto hidden items-center gap-1.5 text-[12px] text-ink3 sm:flex">
          <kbd className="rounded-md bg-surface2 px-1.5 py-0.5 font-sans">←</kbd><kbd className="rounded-md bg-surface2 px-1.5 py-0.5 font-sans">→</kbd>
          <span>{t("analysis.scope.preview.toMove", "to move")} · <span className="num" role="status" aria-live="polite">{t("analysis.scope.preview.nOfM", "{n} of {total}", { n: index + 1, total: n })}</span></span>
        </div>
        {other >= 0 && (
          <Segmented label={t("analysis.scope.preview.device", "Device")} value={mobile ? "mobile" : "desktop"}
            onChange={(v) => { if ((v === "mobile") !== mobile) onIndexChange(other); }}
            options={[{ value: "desktop", label: t("analysis.scope.design.desktop", "Desktop") }, { value: "mobile", label: t("analysis.scope.design.mobile", "Mobile") }]} />
        )}
        <Button variant="ghost" aria-label={t("analysis.scope.preview.previousScreen", "Previous screen")} icon={<ArrowLeft size={16} aria-hidden />} onClick={() => go(-1)} disabled={n < 2}>
          <span className="hidden sm:inline">{t("analysis.scope.preview.previous", "Previous")}</span>
        </Button>
        <Button variant="ghost" aria-label={t("analysis.scope.preview.nextScreen", "Next screen")} iconRight={<ArrowRight size={16} aria-hidden />} onClick={() => go(1)} disabled={n < 2}>
          <span className="hidden sm:inline">{t("analysis.scope.preview.next", "Next")}</span>
        </Button>
      </>}>
      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="min-w-0">
          {screen.purpose && <p className="break-words text-[14px] text-ink2">{screen.purpose}</p>}
          {features.length > 0 && (
            <>
              <div className={cn(SECTION, screen.purpose ? "mt-5" : "")}>{t("analysis.scope.preview.serves", "Serves")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {features.map((f) => <Chip key={f} className="max-w-full" title={f}><span className="truncate">{f}</span></Chip>)}
              </div>
            </>
          )}
          <div className={cn(SECTION, (screen.purpose || features.length > 0) && "mt-5")}>{t("analysis.scope.preview.shownOn", "Shown on")}</div>
          <div className="mt-2">
            <Chip icon={<DeviceIcon size={13} strokeWidth={1.75} aria-hidden />}>{mobile ? t("analysis.scope.design.mobile", "Mobile") : t("analysis.scope.design.desktop", "Desktop")}</Chip>
          </div>
          {status === "working" && (
            <p role="status" className="mt-5 flex items-center gap-2 text-[13px] text-ink3">
              <LoaderCircle size={14} strokeWidth={1.75} aria-hidden className="shrink-0 animate-spin motion-reduce:animate-none" />
              {t("analysis.scope.design.working", "The designer is working on this…")}
            </p>
          )}
          {updated && accepted !== thread.id ? (
            <div className="mt-5 rounded-block bg-accent-soft/60 px-4 py-3">
              <Chip tone="accent" icon={<MessageSquareCheck size={12} strokeWidth={1.75} aria-hidden />}>{t("analysis.scope.design.updated", "Updated from your comment")}</Chip>
              <p className="mt-2 text-[13px] text-ink2">{t("analysis.scope.preview.updatedNote", "The designer made a new version of this screen from your comment. Have a look, then accept it or comment again.")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {onAccept && (
                  <Button size="sm" variant="primary" icon={<Check size={14} strokeWidth={1.75} aria-hidden />} disabled={accepting !== null} onClick={() => void accept()}>
                    {accepting === thread.id ? t("analysis.scope.preview.closing", "Closing…") : t("analysis.scope.preview.acceptClose", "Accept and close")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<MessageSquare size={14} strokeWidth={1.75} aria-hidden />} onClick={feedback}>
                  {t("analysis.scope.preview.commentAgain", "Comment again")}
                </Button>
              </div>
              {!onAccept && noAcceptReason && <p className="mt-2 text-[12px] text-ink3">{noAcceptReason}</p>}
              {acceptError?.id === thread.id && <p role="alert" className="mt-2 text-[13px] text-danger">{acceptError.text}</p>}
            </div>
          ) : (
            <>
              {thread && accepted === thread.id && <p role="status" className="mt-5 text-[13px] text-ink2">{t("analysis.scope.preview.accepted", "Accepted and closed.")}</p>}
              <Button variant="ghost" className="mt-5" icon={<MessageSquare size={16} strokeWidth={1.75} aria-hidden />} onClick={feedback}>
                {t("analysis.scope.preview.feedback", "Feedback on this screen")}
              </Button>
            </>
          )}
          {previous && (
            <Button variant={comparing ? "secondary" : "ghost"} className="mt-2" aria-pressed={comparing}
              icon={<Columns2 size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setCompare((c) => !c)}>
              {comparing ? t("analysis.scope.preview.showNewOnly", "Show only the new version") : t("analysis.scope.preview.compare", "Compare with the previous version")}
            </Button>
          )}
          <nav ref={navRef} aria-label={t("analysis.scope.summary.screens", "Screens")} className="mt-5 flex flex-wrap gap-1.5 xl:flex-col xl:gap-1">
            {screens.map((sc, idx) => (
              <button key={sc.id} ref={idx === index ? activeRef : undefined} type="button" aria-current={idx === index ? "true" : undefined}
                aria-label={sc.viewport === "mobile" ? t("analysis.scope.preview.navMobile", "{name}, mobile", { name: sc.name }) : t("analysis.scope.preview.navDesktop", "{name}, desktop", { name: sc.name })} onClick={() => onIndexChange(idx)}
                className={cn("flex items-start gap-3 rounded-full text-left outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50 xl:rounded-block xl:px-3 xl:py-2",
                  idx === index ? "xl:bg-surface2" : "xl:hover:bg-surface2/60")}>
                <span className={cn("num grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-medium transition xl:mt-0.5 xl:h-6 xl:w-6 xl:text-[11px]",
                  idx === index ? "bg-ink text-canvas" : "bg-surface2 text-ink2")}>{idx + 1}</span>
                <span className="sr-only min-w-0 xl:not-sr-only">
                  <span className="block break-words text-[14px] font-medium">{sc.name}</span>
                  <span className="block text-[12px] text-ink3">{sc.viewport === "mobile" ? t("analysis.scope.design.mobile", "Mobile") : t("analysis.scope.design.desktop", "Desktop")}</span>
                </span>
              </button>
            ))}
          </nav>
        </div>

        <div className="scroll-thin min-w-0 overflow-auto rounded-block bg-surface2 p-3 sm:p-5">
          {comparing && previous ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <figure className="min-w-0">
                <figcaption className={cn(SECTION, "mb-2")}>{t("analysis.scope.preview.previousVersion", "Previous version")}</figcaption>
                {image(previous.url, t("analysis.scope.preview.altPrevious", "{name} design, previous version", { name: screen.name }), previous.id)}
              </figure>
              <figure className="min-w-0">
                <figcaption className={cn(SECTION, "mb-2")}>{t("analysis.scope.preview.newVersion", "New version")}</figcaption>
                {image(url, t("analysis.scope.preview.altNew", "{name} design, new version", { name: screen.name }), screen.id)}
              </figure>
            </div>
          ) : image(url, mobile ? t("analysis.scope.preview.altMobile", "{name} design, mobile", { name: screen.name }) : t("analysis.scope.preview.altDesktop", "{name} design, desktop", { name: screen.name }), screen.id)}
        </div>
      </div>
    </Modal>
  );
}
