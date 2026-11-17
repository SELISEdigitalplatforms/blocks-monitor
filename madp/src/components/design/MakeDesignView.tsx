/** The Look & feel section, presentational: everything it shows comes in as props (MakeDesignPanel reads and writes).
 *
 *   [palette] Look & feel                                   (status)  [ Approve design ]
 *                                                                      why it is off, when it is
 *   one line on what to do here
 *   <the business analyst's agent line with the shimmer bar, while a design is made>
 *   <failure, with Retry design when there is no design yet>
 *   ┌ Your product, screen by screen                                     [View designs] ┐
 *   │ [01 Sign in] [02 Dashboard] [03 …]                                                 │
 *   └────────────────────────────────────────────────────────────────────────────────────┘
 *   <notes: out of date, incomplete, not shown on a screen>
 *   Not quite right?  [✎ Change design · helper]  [↻ Generate fresh design · helper]
 *   ▸ Design change history
 *
 * One primary action, Approve design, at the top right like every approval in the app; Change design and Generate
 * fresh design are quiet options with helper text, and a fresh design (a long piece of design work in Figma) asks first. */
import { useId, useState, type ReactNode } from "react";
import {
  AlertCircle, AlertTriangle, Check, ChevronRight, Info, Layers, LoaderCircle, Maximize2, Monitor, Palette, PencilLine, RefreshCw,
  RotateCw, Smartphone, Tablet,
} from "lucide-react";
import { Button, Chip, Label, Modal, Textarea } from "@/ui/kit";
import type { ChipTone } from "@/data/types";
import { cn } from "@/lib/cn";
import { StepPrimaryButton } from "@/components/step/StepFrame";
import { DocBlock } from "@/components/requirements/ObjectiveTab";
import type { FactoryPrototype } from "@/domain/factoryDesign";
import type { FigmaScreens } from "@/domain/figmaScreens";
import type { MakePrototype } from "@/domain/figmaMake";
import { changeHelp, freshHelp, retryHelp, type DesignActions } from "./designActions";
import { t, useT } from "@/i18n";
import { designTypical, type DesignProgressView } from "./designProgress";
import { DesignProgressLine } from "./DesignProgressLine";
import { screenDevice } from "./DesignViewer";

export type ProductPrototype = MakePrototype | FactoryPrototype | FigmaScreens;
export interface DesignHistoryEntry { id: string; revision: string; status: string; feedback: string }

export interface MakeDesignViewProps {
  editable: boolean;
  status: { label: string; tone: ChipTone };
  actions: DesignActions;
  onApprove: () => void;
  /** A design job runs or is being started. */
  busy: boolean;
  stopping?: boolean;
  onStop?: () => void;
  /** The active job's bar; null while the request is still being sent. */
  progress: DesignProgressView | null;
  /** The active job is an older worker's task, finishing before the new design. */
  legacyActive: boolean;
  /** The active job is the one that made the design on screen, still saving its last screens (not a new design). */
  finishing?: boolean;
  /** The failure to explain (null when nothing failed). */
  failure: string | null;
  prototype: ProductPrototype | null;
  incomplete: boolean;
  current: boolean;
  feedback: string;
  onFeedback: (value: string) => void;
  /** Sends the change request; true when it was accepted. */
  onRequestChange: () => Promise<boolean> | boolean;
  onFresh: () => void;
  onRetry: () => void;
  history: readonly DesignHistoryEntry[];
  error: string | null;
  reads: "ready" | "loading" | "failed";
  /** Opens the design viewer (on a screen, from its tile). */
  onView: (nodeId?: string) => void;
  /** Previews and tests: open with the change form or the fresh-design question showing. */
  defaultChanging?: boolean;
}

const SCREEN_TILES = 8;
function historyLabel(status: string): { text: string; tone: ChipTone } | undefined {
  switch (status) {
    case "queued": return { text: t("analysis.design.history.queued", "Waiting"), tone: "neutral" };
    case "claimed": return { text: t("analysis.design.history.claimed", "Starting"), tone: "ai" };
    case "running": return { text: t("analysis.design.history.running", "In progress"), tone: "ai" };
    case "succeeded": return { text: t("analysis.design.history.succeeded", "Done"), tone: "success" };
    case "failed": return { text: t("analysis.design.history.failed", "Failed"), tone: "danger" };
    case "cancelled": return { text: t("analysis.design.history.cancelled", "Cancelled"), tone: "neutral" };
    default: return undefined;
  }
}
const screenName = (name: string) => name.replace(/^\d+[. -]*/, "");

function Note({ tone, icon, title, children, role }: { tone: "warning" | "neutral"; icon: ReactNode; title?: ReactNode; children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className={cn("flex items-start gap-3 rounded-block px-4 py-3 text-[13px] leading-relaxed",
      tone === "warning" ? "bg-warning-soft/70 text-ink" : "bg-surface2 text-ink2")}>
      <span aria-hidden className={cn("mt-0.5 shrink-0", tone === "warning" ? "text-[rgb(var(--c-warning-text))]" : "text-ink3")}>{icon}</span>
      <div className="min-w-0 flex-1">{title && <p className="font-medium text-ink">{title}</p>}<div className={title ? "mt-0.5" : undefined}>{children}</div></div>
    </div>
  );
}

/** A quiet option: the whole row is the button, its helper text (and why it is off) read with it. */
function OptionButton({ icon, label, help, reason, disabled, onClick, expanded, controls, className }: {
  icon: ReactNode; label: string; help: string; reason: string | null; disabled: boolean; onClick: () => void;
  expanded?: boolean; controls?: string; className?: string;
}) {
  const helpId = useId();
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-describedby={helpId} aria-expanded={expanded} aria-controls={controls}
      data-option={label}
      className={cn("group flex w-full min-w-0 items-start gap-3 rounded-block bg-surface2 px-4 py-3 text-left outline-none ring-1 ring-transparent transition",
        "focus-visible:ring-2 focus-visible:ring-accent/60",
        disabled ? "cursor-not-allowed" : "hover:bg-surface hover:ring-line", expanded && "bg-accent-soft/50 ring-accent/30", className)}>
      <span aria-hidden className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-line dark:bg-ink/10 dark:ring-0",
        disabled ? "text-ink3" : "text-ink2 group-hover:text-ink")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[14px] font-medium", disabled ? "text-ink2" : "text-ink")}>{label}</span>
        <span id={helpId} className="mt-0.5 block text-[12px] leading-relaxed text-ink3">
          {help}
          {reason && <span className="mt-1 block font-medium text-ink2" data-reason="">{reason}</span>}
        </span>
      </span>
      {!disabled && <ChevronRight size={16} aria-hidden className={cn("mt-2 shrink-0 text-ink3 transition", expanded && "rotate-90")} />}
    </button>
  );
}

/** A screen's small stand-in: a device-shaped wireframe (the real exports load in the viewer only). */
function ScreenThumb({ device }: { device: ReturnType<typeof screenDevice> | null }) {
  const phone = device === "Mobile";
  const tablet = device === "Tablet";
  return (
    <span aria-hidden className="grid h-[76px] place-items-center rounded-lg bg-canvas">
      <span className={cn("flex flex-col gap-1 rounded-md bg-surface p-1.5 shadow-card ring-1 ring-line", phone ? "h-[62px] w-[34px]" : tablet ? "h-[56px] w-[64px]" : "h-[52px] w-[84px]")}>
        <span className="h-1.5 w-full rounded-sm bg-accent/25" />
        <span className={cn("flex min-h-0 flex-1 gap-1", phone && "flex-col")}>
          {!phone && <span className="w-1/4 rounded-sm bg-line" />}
          <span className="flex flex-1 flex-col gap-1">
            <span className="h-1.5 w-3/4 rounded-sm bg-line" />
            <span className="h-1.5 w-1/2 rounded-sm bg-line" />
            <span className="mt-auto h-2 w-2/5 rounded-full bg-accent/40" />
          </span>
        </span>
      </span>
    </span>
  );
}

export function MakeDesignView(p: MakeDesignViewProps) {
  const { actions, prototype } = p;
  const t = useT();
  const [changing, setChanging] = useState(Boolean(p.defaultChanging));
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const formId = useId();
  const fieldId = useId();
  const figma = prototype?.provider === "figma-design" ? prototype : null;
  const screens = figma?.screens ?? [];
  const more = Math.max(0, screens.length - SCREEN_TILES);
  // a failed request with no design yet still offers Retry design, with its own message
  const failureText = p.failure ?? (actions.retry.show ? p.error ?? t("analysis.design.failure.default", "Your screen designs could not be completed. Your team needs to check the design service before trying again.") : null);
  const submitDisabled = actions.change.disabled || !p.feedback.trim() || sending;
  const send = async () => {
    if (submitDisabled) return;
    setSending(true);
    try { if (await p.onRequestChange()) setChanging(false); } finally { setSending(false); }
  };

  const header = (
    <div className="flex flex-wrap items-start justify-end gap-2" data-design-actions="">
      <span className="flex items-center sm:h-11">
        <Chip tone={p.status.tone} icon={actions.approved ? <Check size={12} strokeWidth={2.25} aria-hidden /> : undefined}>{p.status.label}</Chip>
      </span>
      {actions.approve.show && (
        <StepPrimaryButton primary={{
          label: t("analysis.design.view.approve", "Approve this design revision"), onClick: p.onApprove, disabled: actions.approve.disabled, pending: actions.approve.pending, pendingLabel: t("analysis.design.view.approving", "Approving…"),
          reason: actions.approve.reason ?? undefined, icon: <Check size={16} strokeWidth={2} aria-hidden />,
        }} />
      )}
    </div>
  );

  return (
    <DocBlock title={t("analysis.design.view.lookAndFeel", "Look & feel")} icon={<Palette size={18} strokeWidth={1.75} />} action={header}>
      <div className="flex min-w-0 flex-col gap-4" data-design-section="">
        <p className="max-w-[72ch] text-[14px] leading-relaxed text-ink2">
          {p.editable
            ? t("analysis.design.view.introEditable", "Review the screens your tech lead will build. Approve them when they look right, or ask for a change.")
            : t("analysis.design.view.introReadOnly", "Review the screens your tech lead will build. Approving them is up to the project team.")}
        </p>

        {p.busy && (
          <div className="flex flex-col gap-2">
          <DesignProgressLine view={p.progress}
            title={p.stopping ? t("analysis.design.view.stoppingDesign", "Stopping design…") : p.legacyActive ? t("analysis.design.view.finishingEarlier", "Finishing an earlier design task") : p.finishing ? t("analysis.design.view.finishing", "Your business analyst is finishing this design") : prototype ? t("analysis.design.view.makingNew", "Your business analyst is making a new design") : t("analysis.design.view.designing", "Your business analyst is designing the screens")} />
          {p.onStop && <div><Button variant="ghost" size="sm" disabled={p.stopping} onClick={p.onStop}>{p.stopping ? t("analysis.design.view.stopping", "Stopping…") : t("analysis.design.view.stop", "Stop design")}</Button></div>}
          {p.stopping && <p role="status" className="text-[13px] text-ink3">{t("analysis.design.view.waitingRunnerStop", "Waiting for the design runner to stop. If it is offline, it will stop when it reconnects. Changes already submitted to Figma may remain.")}</p>}
          </div>
        )}

        {p.error && !failureText && <p role="alert" className="rounded-block bg-danger-soft/60 px-4 py-3 text-[13px] text-[rgb(var(--c-danger-text))]">{p.error}</p>}

        {failureText && (
          <div className="flex flex-wrap items-start gap-3 rounded-block bg-danger-soft/60 px-4 py-3.5" data-design-failure="">
            <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-[rgb(var(--c-danger-text))]" />
            <div className="min-w-[min(100%,14rem)] flex-1">
              <p className="text-[14px] font-medium text-ink">{t("analysis.design.view.couldNotComplete", "The design could not be completed")}</p>
              <p role="alert" className="mt-0.5 text-[13px] leading-relaxed text-ink2">{failureText}</p>
              {p.failure && p.error && <p role="alert" className="mt-1 text-[13px] text-[rgb(var(--c-danger-text))]">{p.error}</p>}
            </div>
            {actions.retry.show && <RetryButton action={actions.retry} onRetry={p.onRetry} />}
          </div>
        )}

        {prototype && (prototype.previewUrl ? (
          <div className="overflow-hidden rounded-block ring-1 ring-line" data-design-card="">
            <div className="flex flex-wrap items-center gap-4 bg-surface2 px-4 py-4 sm:px-5">
              <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ai-soft text-[rgb(var(--c-ai-text))]"><Layers size={21} strokeWidth={1.6} /></span>
              <div className="min-w-[min(100%,12rem)] flex-1">
                <h4 className="text-[15px] font-medium text-ink">{t("analysis.design.view.screenByScreen", "Your product, screen by screen")}</h4>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink3">
                  {figma
                    ? incompleteOr(p.incomplete, figma)
                    : t("analysis.design.view.reviewInViewer", "Review the generated layouts, navigation and screen states in the design viewer.")}
                </p>
              </div>
              <Button variant="secondary" iconRight={<Maximize2 size={15} aria-hidden />} onClick={() => p.onView()} className="w-full sm:w-auto">{t("analysis.design.view.viewDesigns", "View designs")}</Button>
            </div>
            {screens.length > 0 && (
              <ul aria-label={t("analysis.design.view.screensAria", "Screens in this design")} className="grid grid-cols-2 gap-2 bg-surface p-3 sm:grid-cols-3 lg:grid-cols-4">
                {screens.slice(0, SCREEN_TILES).map((s, i) => {
                  const device = s.viewport ? screenDevice(s.viewport.width) : null;
                  const DeviceIcon = device === "Mobile" ? Smartphone : device === "Tablet" ? Tablet : Monitor;
                  const n = s.requirementKeys.length;
                  return (
                    <li key={s.nodeId} className="min-w-0">
                      <button type="button" onClick={() => p.onView(s.nodeId)} aria-label={t("analysis.design.view.openScreen", "Open screen {n}: {name}", { n: i + 1, name: screenName(s.name) })}
                        className="flex h-full w-full min-w-0 flex-col gap-2 rounded-xl bg-surface2 p-2 text-left outline-none ring-1 ring-line transition hover:ring-accent/50 focus-visible:ring-2 focus-visible:ring-accent/60">
                        <ScreenThumb device={device} />
                        <span className="min-w-0 px-0.5">
                          <span className="line-clamp-2 block text-[12px] font-medium leading-snug text-ink"><span className="num mr-1 text-ink3">{String(i + 1).padStart(2, "0")}</span>{screenName(s.name)}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-1 text-[11px] text-ink3">
                            {device && <span className="inline-flex items-center gap-1 whitespace-nowrap"><DeviceIcon size={12} aria-hidden className="shrink-0" />{device}<span aria-hidden>·</span></span>}
                            <span className="whitespace-nowrap">{n} {n === 1 ? "requirement" : "requirements"}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {more > 0 && (
                  <li className="min-w-0">
                    <button type="button" onClick={() => p.onView()}
                      className="grid h-full min-h-[120px] w-full place-items-center rounded-xl border border-dashed border-line px-2 text-center text-[13px] font-medium text-ink2 outline-none transition hover:border-accent/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
                      {more === 1 ? t("analysis.design.view.moreScreen", "+{count} more screen", { count: more }) : t("analysis.design.view.moreScreens", "+{count} more screens", { count: more })}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        ) : (
          <Note tone="neutral" role="status" icon={<LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />}>
            {t("analysis.design.view.imported", "Your design has been imported. Its interactive live preview is being prepared and will appear here when it is ready.")}
          </Note>
        ))}

        {prototype && !p.current && !p.busy && (
          <Note tone="warning" role="status" icon={<AlertCircle size={16} />}>
            {t("analysis.design.view.notMatching", "This design does not match the latest goals and requirements. Request an updated revision before approval.")}
          </Note>
        )}
        {figma && p.incomplete && (
          <Note tone="warning" icon={<AlertCircle size={16} />} title={t("analysis.design.view.previewIncomplete", "Preview incomplete")}>
            {figma.totalScreens != null
              ? t("analysis.design.view.previewsOf", "{count} of {total} screen previews are available. Exports and visual corrections remain unfinished, so approval is disabled.", { count: figma.screens.length, total: figma.totalScreens })
              : t("analysis.design.view.previewsOfPlanned", "{count} of the planned screen previews are available. Exports and visual corrections remain unfinished, so approval is disabled.", { count: figma.screens.length })}
          </Note>
        )}
        {figma && !!figma.noScreen?.length && (
          <Note tone="neutral" icon={<Info size={16} />} title={t("analysis.design.view.notShown", "Not shown on a screen ({count})", { count: figma.noScreen.length })}>
            <p className="text-[12px] text-ink3">{t("analysis.design.view.notShownHint", "The business analyst found nothing to see on a screen for these requirements. Check the reasons before you approve.")}</p>
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {figma.noScreen.map((n) => (
                <li key={n.key} className="flex min-w-0 flex-col gap-0.5 py-2 first:pt-1 last:pb-0 sm:flex-row sm:gap-3">
                  <span className="shrink-0 font-medium text-ink sm:w-56 sm:truncate" title={n.title || n.key}>{n.title || n.key}</span>
                  <span className="min-w-0 break-words">{n.reason}</span>
                </li>
              ))}
            </ul>
          </Note>
        )}
        {prototype?.provider === "factory" && (
          <p className="text-[12px] text-ink3">{t("analysis.design.view.factoryPreview", "Factory-managed preview. Feedback is checked against your goals, requirements and constraints; changes to agreed scope need clarification first.")}</p>
        )}

        {!prototype && !p.busy && !failureText && p.reads === "ready" && (
          <Note tone="neutral" role="status" icon={<Layers size={16} />}>{t("analysis.design.view.willAppear", "Your interactive design will appear here once the business analyst has completed it.")}</Note>
        )}

        {(actions.change.show || actions.fresh.show) && (
          <div className="flex flex-col gap-3 border-t border-line pt-4" data-design-options="">
            <h4 className="text-[13px] font-medium text-ink2">{t("analysis.design.view.notQuiteRight", "Not quite right?")}</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {actions.change.show && (
                <OptionButton icon={<PencilLine size={15} aria-hidden />} label={t("analysis.design.view.changeDesign", "Change design")} help={changeHelp()}
                  reason={actions.change.reason} disabled={actions.change.disabled && !changing} expanded={changing} controls={formId}
                  onClick={() => setChanging((v) => !v)} className="sm:order-1" />
              )}
              {actions.fresh.show && (
                <OptionButton icon={<RefreshCw size={15} aria-hidden />} label={t("analysis.design.view.generateFresh", "Generate fresh design")} help={freshHelp()}
                  reason={actions.fresh.reason} disabled={actions.fresh.disabled} onClick={() => setAsking(true)} className="order-2" />
              )}
            {/* phones: the form opens right under Change design; wider screens: under both options */}
            {actions.change.show && changing && (
              <div id={formId} className="order-1 rounded-block p-4 ring-1 ring-line sm:order-3 sm:col-span-2" data-change-form="">
                <label htmlFor={fieldId}><Label>{t("analysis.design.view.requestChangeLabel", "Request a design change")}</Label></label>
                <Textarea id={fieldId} value={p.feedback} maxLength={4000} disabled={p.busy || sending} rows={3} autoFocus
                  placeholder={t("analysis.design.view.requestChangePlaceholder", "What should change in the journeys, layout or visual direction?")}
                  onChange={(e) => p.onFeedback(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setChanging(false); } }} />
                <p className="mt-2 text-[12px] leading-relaxed text-ink3">{t("analysis.design.view.feedbackWithin", "Design feedback must stay within the agreed goals and requirements. Changes to product behavior need a requirements update first.")}</p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={() => setChanging(false)}>{t("analysis.design.view.cancel", "Cancel")}</Button>
                  <Button variant="secondary" disabled={submitDisabled} aria-busy={sending || undefined} onClick={() => void send()}>
                    {sending ? t("analysis.design.view.sending", "Sending…") : t("analysis.design.view.requestChanges", "Request design changes")}
                  </Button>
                </div>
              </div>
            )}
            </div>
          </div>
        )}

        {p.history.length > 0 && (
          <details className="group rounded-block bg-surface2">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-block px-4 py-3 text-[13px] font-medium text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
              <ChevronRight size={15} aria-hidden className="transition group-open:rotate-90" />{t("analysis.design.view.history", "Design change history ({count})", { count: p.history.length })}
            </summary>
            <ol className="flex flex-col divide-y divide-line px-4 pb-3">
              {p.history.map((h) => {
                const s = historyLabel(h.status) ?? { text: h.status, tone: "neutral" as ChipTone };
                return (
                  <li key={h.id} className="py-2.5 text-[13px]">
                    <p className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{t("analysis.design.view.revision", "Revision {n}", { n: h.revision })}</span><Chip tone={s.tone}>{s.text}</Chip></p>
                    {h.feedback && <p className="mt-1 whitespace-pre-wrap break-words text-ink2">{h.feedback}</p>}
                  </li>
                );
              })}
            </ol>
          </details>
        )}

        {p.reads !== "ready" && (
          <p role="status" className="flex items-center gap-2 text-[13px] text-ink2">
            {p.reads === "loading" && <LoaderCircle size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />}
            {p.reads === "failed" ? t("analysis.design.view.detailsFailed", "Design details could not be loaded. Refresh the page to try again.") : t("analysis.design.view.loadingYours", "Loading your design…")}
          </p>
        )}
      </div>

      <Modal open={asking} onClose={() => setAsking(false)} title={t("analysis.design.view.freshTitle", "Generate a fresh design?")}
        footer={<>
          <Button variant="ghost" onClick={() => setAsking(false)}>{t("analysis.design.view.keepThis", "Keep this design")}</Button>
          <Button variant="primary" icon={<RefreshCw size={15} aria-hidden />} disabled={actions.fresh.disabled}
            onClick={() => { setAsking(false); p.onFresh(); }}>{t("analysis.design.view.generateFresh", "Generate fresh design")}</Button>
        </>}>
        <div className="flex flex-col gap-3 text-[14px] leading-relaxed text-ink2">
          <p>{t("analysis.design.view.freshExplain", "The business analyst starts over from your current goals and requirements, with a new visual direction in a new Figma file. This takes {typical} of design work in Figma, including a review and polish of every screen.", { typical: designTypical() })}</p>
          <ul className="flex flex-col gap-1.5">
            <li className="flex gap-2"><Check size={16} aria-hidden className="mt-0.5 shrink-0 text-[rgb(var(--c-success-text))]" />{t("analysis.design.view.freshKept", "This design and its saved previews are kept.")}</li>
            <li className="flex gap-2"><Info size={16} aria-hidden className="mt-0.5 shrink-0 text-ink3" />{t("analysis.design.view.freshApproval", "The new design needs your approval again before development uses it.")}</li>
          </ul>
          <p className="text-[13px] text-ink3">{t("analysis.design.view.freshInstead", "To adjust this design instead, choose Change design.")}</p>
        </div>
      </Modal>
    </DocBlock>
  );
}

function incompleteOr(incomplete: boolean, figma: FigmaScreens): string {
  const names = figma.screens.slice(0, 3).map((s) => screenName(s.name)).join(", ");
  const list = figma.screens.length > 3 ? t("analysis.design.view.andMore", "{names} and more", { names }) : names;
  return incomplete
    ? t("analysis.design.view.savedSoFar", "{count} saved screen previews so far · {list}.", { count: figma.screens.length, list })
    : t("analysis.design.view.screenDesigns", "{count} screen designs · {list}. Approval passes these exact screens and their specifications to development.", { count: figma.screens.length, list });
}

function RetryButton({ action, onRetry }: { action: DesignActions["retry"]; onRetry: () => void }) {
  const t = useT();
  const id = useId();
  return (
    <div className="flex w-full flex-col items-start gap-1 sm:w-auto sm:max-w-[16rem] sm:items-end">
      <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden />} disabled={action.disabled} aria-describedby={id} onClick={onRetry}>{t("analysis.design.view.retry", "Retry design")}</Button>
      <span id={id} className="text-[12px] text-ink3 sm:text-right">{action.reason ?? retryHelp()}</span>
    </div>
  );
}
