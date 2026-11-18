/**
 * The shared step frame: every journey step looks and behaves the same (STEP-STANDARD.md, "The shared step frame").
 *
 *   eyebrow
 *   Title · subject                                         [extras] [ ONE primary button ]
 *   Role · deliverable · You: your part
 *   (status)  [✓ About] [✓ Goal & users] [✓ Code] [✓ Material 8]
 *   <agent line>
 *   ───────────────────────────────────────────────────────────────────────────
 *   Main title                                                        [main actions]
 *   <children = the deliverable>
 *   ▸ Details (collapsed: history, technical notes, discussions, raw lists)
 *
 * After the sign-off (`signedOff`) the layout stays the same: the chips keep their ticks but are read-only (unless a
 * chip says `editableAfterSignOff`), the status reads the sign-off text and the primary button becomes the link to the
 * next step.
 *
 * Stable props (other steps code against them): eyebrow, title, status, statusTone, role, deliverable, yourPart, primary,
 * extras, chips, agentLine, signedOff, children, details, detailsLabel, detailsOpen. Everything else is additive.
 */
import { isValidElement, useId, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, Check, ChevronRight, CircleCheck, CircleDashed, Clock, Info, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { chipsLeft, chipsStatusText, signOffText } from "./stepModel";
import { useT } from "@/madp/i18n";

export { chipsLeft, chipsStatus, chipsStatusText, formatSignOffTime, signOffText, firstName } from "./stepModel";

/* ── types ────────────────────────────────────────────────────────────────── */

export type StepChipState = "done" | "todo" | "attention" | "info";

export interface StepChip {
  id: string;
  /** Short label ("Material"). */
  label: string;
  /** done ✓ / todo ○ / attention ! / info. (Or `done`: true = "done", false = "todo".) */
  state?: StepChipState;
  done?: boolean;
  /** Short value after the label ("8", "Anna"). */
  value?: ReactNode;
  /** Opens the chip's small window; without it the chip is read-only. */
  onClick?: () => void;
  /** Same as onClick. */
  onOpen?: () => void;
  /** The longer wording (tooltip and screen readers): "Share what you already have · 4 items shared". */
  title?: string;
  /** Same as title. */
  hint?: string;
  /** additive: a small icon before the label. */
  icon?: ReactNode;
  /** additive: the inviting word on an open chip (default "add"). */
  todoLabel?: string;
  /** additive: still opens after the sign-off (e.g. a repository that can change until the build). */
  editableAfterSignOff?: boolean;
  /** additive: an optional extra the client can add; while open it is highlighted (amber, its own icon), not a dotted
   *  to-do. `icon` is the open mark; `tag` an optional small label after the chip's label. */
  addOn?: { icon?: ReactNode; tag?: string };
}

export type StepStatusTone = "done" | "progress" | "waiting" | "attention";

export interface StepPrimary {
  label: string;
  onClick?: () => void;
  /** A link instead of a button (in-app path). */
  href?: string;
  disabled?: boolean;
  /** Why it is disabled (shown under the button, read with it). */
  reason?: ReactNode;
  pending?: boolean;
  pendingLabel?: string;
  icon?: ReactNode;
}

export interface StepSignOff {
  /** "Signed off by Anna Rossi on 26 Oct 2026, 08:45" (signOffText builds it; or give verb / by / at). */
  text?: ReactNode;
  verb?: string;
  by?: string | null;
  at?: string | null;
  /** The next step: the frame's primary button after the sign-off (`to` = `href`). */
  next?: { label: string; href?: string; to?: string };
  /** A custom action in place of the next-step link. */
  action?: ReactNode;
  /** additive: a short extra after the text ("3 new since"). */
  extra?: ReactNode;
}

export interface StepFrameProps {
  eyebrow?: ReactNode;
  /** "Project setup" */
  title: ReactNode;
  /** The one-line status; default from the chips ("Ready" / "2 things left"). Also { tone, text }. */
  status?: ReactNode | StepStatusObject;
  statusTone?: StepStatusTone;
  /** "Business agent" (or { who, delivers, yourPart, avatar? }). */
  role?: ReactNode | StepRoleObject;
  /** Shown as given, with its verb: "prepares your Project brief". */
  deliverable?: ReactNode;
  /** After "You:": "answer the questions, share what you have". */
  yourPart?: ReactNode;
  /** ONE primary button (before the sign-off). */
  primary?: StepPrimary | null;
  /** Compact secondary controls left of the primary button (a type chip). */
  extras?: ReactNode;
  /** At most 5–6 chips. */
  chips?: readonly StepChip[];
  /** "Your business analyst is drafting… ▓▓▒░" (rendered as given). */
  agentLine?: ReactNode;
  /** Set once the step is signed off: same layout, read-only chips, the sign-off text, the link to the next step. */
  signedOff?: StepSignOff | null;
  /** The main area: the deliverable. */
  children?: ReactNode;
  /** Everything secondary, in one collapsed area. */
  details?: ReactNode;
  detailsLabel?: string;
  detailsOpen?: boolean;

  /* additive */
  /** Same as children. */
  main?: ReactNode;
  /** A ready-made primary control in place of `primary`. */
  primaryAction?: ReactNode;
  /** Same as extras. */
  tools?: ReactNode;
  /** The project's name, after the title in a lighter weight. */
  subject?: ReactNode;
  /** The status text when every chip is done (default "Ready"). */
  readyText?: string;
  /** The chip list's accessible name (default "Checklist"). */
  chipsLabel?: string;
  /** Banners between the top block and the main area (errors, view-only notes). */
  notices?: ReactNode;
  /** The main area's heading ("Your material") and its actions (search, add…). */
  mainTitle?: ReactNode;
  mainActions?: ReactNode;
  /** On large screens the main area takes the rest of the window (its child gets the height and scrolls inside). */
  fill?: boolean;
  /** Extra props for the page root (drag and drop, a ref). */
  rootProps?: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };
  /** Rendered over the page inside the root (a drop overlay). */
  overlay?: ReactNode;
  className?: string;
}

/** The status as an object: tone "todo" = attention, "busy" = progress, "info" = waiting. */
export interface StepStatusObject { tone: StepStatusTone | "todo" | "busy" | "info"; text: ReactNode }
export interface StepRoleObject { who: ReactNode; delivers?: ReactNode; yourPart?: ReactNode; avatar?: ReactNode }

const TONE_ALIAS: Record<StepStatusObject["tone"], StepStatusTone> = {
  done: "done", progress: "progress", waiting: "waiting", attention: "attention", todo: "attention", busy: "progress", info: "waiting",
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !isValidElement(v) && !Array.isArray(v) && !(Symbol.iterator in v);
const chipState = (c: StepChip): StepChipState => c.state ?? (c.done ? "done" : "todo");

/* ── parts ────────────────────────────────────────────────────────────────── */

const TONE: Record<StepStatusTone, { cls: string; icon: ReactNode }> = {
  done: { cls: "bg-success-soft text-[rgb(var(--c-success-text))]", icon: <CircleCheck size={15} aria-hidden /> },
  progress: { cls: "bg-accent-soft text-[rgb(var(--c-accent-text))]", icon: <LoaderCircle size={15} aria-hidden className="animate-spin motion-reduce:animate-none" /> },
  waiting: { cls: "bg-surface2 text-ink2", icon: <Clock size={15} aria-hidden /> },
  attention: { cls: "bg-warning-soft text-[rgb(var(--c-warning-text))]", icon: <CircleDashed size={15} aria-hidden /> },
};

export function StepStatusPill({ tone, children, className }: { tone: StepStatusTone; children: ReactNode; className?: string }) {
  const t = TONE[tone];
  return (
    <span role="status" className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium", t.cls, className)}>
      {t.icon}<span className="min-w-0">{children}</span>
    </span>
  );
}

const CHIP_MARK: Record<StepChipState, ReactNode> = {
  done: <span aria-hidden className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-success text-white dark:text-canvas"><Check size={12} strokeWidth={3} /></span>,
  todo: <CircleDashed size={16} aria-hidden className="shrink-0 text-[rgb(var(--c-accent-text))]" />,
  attention: <AlertCircle size={16} aria-hidden className="shrink-0 text-[rgb(var(--c-warning-text))]" />,
  info: <Info size={16} aria-hidden className="shrink-0 text-ink3" />,
};
function chipSr(state: StepChipState, t: ReturnType<typeof useT>): string {
  switch (state) {
    case "done": return ` (${t("project.chip.done", "done")})`;
    case "todo": return ` (${t("project.chip.todo", "to do")})`;
    case "attention": return ` (${t("project.chip.needsYou", "needs you")})`;
    case "info": return "";
  }
}

/** One compact checklist chip: ✓/○, icon, label, short value; an open one invites ("+ add"). */
/** The open chip's word adds something ("add", "add files"): it gets the "+" sign; other words open a window. */
const addWord = (todo: string | undefined): boolean => todo === undefined || /^add\b/i.test(todo) || /hinzufügen|ergänzen/i.test(todo);

export function StepChipButton({ chip, readOnly }: { chip: StepChip; readOnly?: boolean }) {
  const t = useT();
  const state = chipState(chip);
  const onClick = chip.onClick ?? chip.onOpen;
  const title = chip.title ?? chip.hint;
  const canOpen = Boolean(onClick) && !readOnly;
  const open = state === "todo" || state === "attention";
  const addOnOpen = Boolean(chip.addOn) && open;
  const body = (
    <>
      {addOnOpen ? <span aria-hidden className="shrink-0 text-[rgb(var(--c-warning-text))] [&>svg]:h-4 [&>svg]:w-4">{chip.addOn?.icon ?? <Plus size={16} />}</span> : CHIP_MARK[state]}
      {chip.icon && <span aria-hidden className="shrink-0 text-ink3 [&>svg]:h-[15px] [&>svg]:w-[15px]">{chip.icon}</span>}
      <span className="whitespace-nowrap">{chip.label}</span>
      {chip.addOn?.tag && (
        <span className="whitespace-nowrap rounded-full bg-[rgb(var(--c-warning-text))] px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-white dark:text-canvas">{chip.addOn.tag}</span>
      )}
      {chip.value !== undefined && chip.value !== null && chip.value !== "" && (
        <span className="num max-w-[10rem] truncate font-medium text-ink">{chip.value}</span>
      )}
      {open && canOpen && (
        // "+ add" for something to add; any other word reads as an action that opens ("review ›"); "" shows only "›"
        <span className={cn("inline-flex items-center gap-0.5 font-medium", addOnOpen ? "text-[rgb(var(--c-warning-text))]" : "text-[rgb(var(--c-accent-text))]")}>
          {addWord(chip.todoLabel) && <Plus size={13} strokeWidth={2.25} aria-hidden />}
          {chip.todoLabel ?? t("project.chip.add", "add")}
          {!addWord(chip.todoLabel) && <ChevronRight size={13} strokeWidth={2.25} aria-hidden />}
        </span>
      )}
      <span className="sr-only">{chipSr(state, t)}{title ? `: ${title}` : ""}</span>
    </>
  );
  const cls = cn(
    "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition",
    addOnOpen ? "border border-warning/70 bg-warning-soft/70 text-ink shadow-card"
      : state === "done" || state === "info" ? "bg-surface text-ink2 ring-1 ring-line"
      : state === "attention" ? "border border-dashed border-warning/60 bg-warning-soft/50 text-ink"
      : "border border-dashed border-accent/55 bg-accent-soft/40 text-ink",
    canOpen && (addOnOpen ? "hover:bg-warning-soft" : open ? "hover:bg-accent-soft" : "hover:bg-surface2 hover:text-ink"),
    canOpen && "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
  );
  return canOpen ? (
    <button type="button" className={cls} title={title} onClick={onClick} data-chip={chip.id} data-state={state}>{body}</button>
  ) : (
    <span className={cls} title={title} data-chip={chip.id} data-state={state}>{body}</span>
  );
}

/** The row of checklist chips, led by the status (wraps on wide screens, scrolls sideways on phones). */
export function StepChips({ chips, lead, label, readOnly }: {
  chips: readonly StepChip[]; lead?: ReactNode; label?: string; readOnly?: boolean;
}) {
  const t = useT();
  return (
    // relative: the chips' screen-reader text (position: absolute) stays inside the scrolling row on phones, so the
    // page itself never grows wider than the screen
    <div className="relative -mx-4 flex min-w-0 max-w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:max-w-full sm:flex-wrap sm:overflow-visible sm:px-0">
      {lead}
      <ul aria-label={label ?? t("project.chip.checklist", "Checklist")} className="flex items-center gap-2 sm:flex-wrap">
        {chips.map((c) => (
          <li key={c.id} className="shrink-0"><StepChipButton chip={c} readOnly={readOnly && !c.editableAfterSignOff} /></li>
        ))}
      </ul>
    </div>
  );
}

/** "Business agent · prepares your Project brief · You: answer the questions, share what you have" */
export function StepRoleLine({ role, deliverable, yourPart, avatar }: { role?: ReactNode; deliverable?: ReactNode; yourPart?: ReactNode; avatar?: ReactNode }) {
  const t = useT();
  if (!role && !deliverable && !yourPart) return null;
  const dot = <span aria-hidden className="text-ink3">·</span>;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-ink2">
      {avatar && <span aria-hidden className="inline-flex shrink-0">{avatar}</span>}
      {role && <span className="font-medium text-ink">{role}</span>}
      {role && deliverable && dot}
      {deliverable && <span>{deliverable}</span>}
      {/* the client's part: on its own line on phones, after a dot on wider screens */}
      {yourPart && (role || deliverable) && <span aria-hidden className="hidden text-ink3 sm:inline">·</span>}
      {yourPart && <span className="basis-full sm:basis-auto"><span className="font-medium text-ink">{t("project.step.you", "You:")}</span> {yourPart}</span>}
    </p>
  );
}

const LINK_PRIMARY = "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-5 text-[14px] font-medium text-white transition hover:bg-accent-hover outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/** The frame's one primary action: a button, or a link when it has an href. */
export function StepPrimaryButton({ primary }: { primary: StepPrimary }) {
  const reasonId = useId();
  const label = primary.pending ? primary.pendingLabel ?? primary.label : primary.label;
  const control = primary.href && !primary.disabled ? (
    <Link to={primary.href} className={LINK_PRIMARY}>{primary.icon}{label}{!primary.icon && <ArrowRight size={16} aria-hidden />}</Link>
  ) : (
    <Button variant="primary" className="h-11 px-5" onClick={primary.onClick} disabled={primary.disabled || primary.pending}
      aria-busy={primary.pending || undefined} aria-describedby={primary.reason ? reasonId : undefined}
      icon={primary.icon}>{label}</Button>
  );
  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      {control}
      {primary.reason && <span id={reasonId} className="max-w-[22rem] text-[12px] text-ink3 sm:text-right">{primary.reason}</span>}
    </div>
  );
}

/** The main area's height on large screens: from its top (at scroll 0) to the bottom of the window. */
function useFillHeight(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const calc = () => {
      const y = el.getBoundingClientRect().top + window.scrollY;
      setH(Math.max(460, Math.round(window.innerHeight - y - 20)));
    };
    calc();
    window.addEventListener("resize", calc);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(calc) : null;
    if (ro && top.current) ro.observe(top.current);
    return () => { window.removeEventListener("resize", calc); ro?.disconnect(); };
  }, [enabled]);
  return { ref, top, height: h };
}

/* ── the frame ────────────────────────────────────────────────────────────── */

export function StepFrame({
  eyebrow, title, status, statusTone, role, deliverable, yourPart, primary, extras, chips, agentLine, signedOff, children,
  details, detailsLabel: detailsLabelIn, detailsOpen,
  subject, readyText: readyTextIn, chipsLabel, notices, mainTitle, mainActions, fill, rootProps, overlay, className,
  main, primaryAction, tools,
}: StepFrameProps) {
  const t = useT();
  const detailsLabel = detailsLabelIn ?? t("project.step.details", "Details");
  const readyText = readyTextIn ?? t("project.step.ready", "Ready");
  const statusObj = isObj(status) ? (status as unknown as StepStatusObject) : null;
  const roleObj = isObj(role) ? (role as unknown as StepRoleObject) : null;
  const signText: ReactNode = signedOff ? signedOff.text ?? signOffText({ verb: signedOff.verb, by: signedOff.by, at: signedOff.at }) : null;
  const nextHref = signedOff?.next ? signedOff.next.href ?? signedOff.next.to ?? "" : "";
  const extrasNode = extras ?? tools;
  const box = useFillHeight(Boolean(fill));
  const signed = Boolean(signedOff);
  const left = chips ? chipsLeft(chips) : 0;
  const statusText: ReactNode = signedOff ? signText
    : statusObj ? statusObj.text : (status as ReactNode) ?? (chips && chips.length ? chipsStatusText(chips, readyText) : null);
  const tone: StepStatusTone = signedOff ? "done" : statusTone ?? (statusObj ? TONE_ALIAS[statusObj.tone] : undefined) ?? (chips && chips.length ? (left === 0 ? "done" : "attention") : "waiting");
  const pill = statusText ? (
    <StepStatusPill tone={tone}>
      {statusText}{signedOff?.extra ? <span className="font-normal opacity-80"> · {signedOff.extra}</span> : null}
    </StepStatusPill>
  ) : null;
  const action: ReactNode = signedOff
    ? signedOff.action ?? (signedOff.next && nextHref ? <Link to={nextHref} className={LINK_PRIMARY}>{signedOff.next.label}<ArrowRight size={16} aria-hidden /></Link> : null)
    : primary ? <StepPrimaryButton primary={primary} /> : primaryAction ?? null;
  const { ref: rootRef, className: rootCls, ...rest } = rootProps ?? {};
  const hasMainHead = Boolean(mainTitle || mainActions);

  return (
    <div ref={rootRef} {...rest} className={cn("relative", rootCls, className)} data-step-frame="" data-signed-off={signed || undefined}>
      <div ref={box.top} className="flex flex-col gap-3 animate-rise">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-72">
            {eyebrow && <div className="mb-0.5 text-[13px] text-ink3">{eyebrow}</div>}
            <h1 className="text-[26px] font-medium leading-tight tracking-[-0.02em] sm:text-[30px]">
              {title}
              {subject ? <span className="font-normal text-ink3"><span aria-hidden> · </span><span className="sr-only">, </span>{subject}</span> : null}
            </h1>
          </div>
          {(extrasNode || action) && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:items-start sm:justify-end">
              {extrasNode && <div className="flex flex-wrap items-center gap-2 sm:h-11">{extrasNode}</div>}
              {action && <div className="w-full sm:w-auto [&_a]:w-full [&_button]:w-full sm:[&_a]:w-auto sm:[&_button]:w-auto">{action}</div>}
            </div>
          )}
        </div>
        <StepRoleLine role={roleObj ? roleObj.who : (role as ReactNode)} deliverable={roleObj ? roleObj.delivers : deliverable}
          yourPart={roleObj ? roleObj.yourPart : yourPart} avatar={roleObj?.avatar} />
        {chips && chips.length > 0
          ? <>
              {/* phones: the status gets its own line, so a long sign-off line wraps instead of scrolling out of sight */}
              {statusText && (
                <div className="sm:hidden">
                  <StepStatusPill tone={tone} className="rounded-[18px]">
                    {statusText}{signedOff?.extra ? <span className="font-normal opacity-80"> · {signedOff.extra}</span> : null}
                  </StepStatusPill>
                </div>
              )}
              <StepChips chips={chips} lead={pill ? <span className="hidden sm:contents">{pill}</span> : undefined} label={chipsLabel} readOnly={signed} />
            </>
          : pill && <div>{pill}</div>}
        {agentLine}
        {notices}
      </div>

      <section aria-label={typeof mainTitle === "string" ? mainTitle : undefined} className="mt-5 border-t border-line pt-5">
        {hasMainHead && (
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            {mainTitle && <h2 className="min-w-0 flex-1 text-[18px] font-medium tracking-[-0.01em]">{mainTitle}</h2>}
            {mainActions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{mainActions}</div>}
          </div>
        )}
        <div ref={box.ref}
          style={fill && box.height ? ({ "--step-fill-h": `${box.height}px` } as CSSProperties) : undefined}
          className={cn("min-w-0", fill && "lg:h-[var(--step-fill-h,auto)]")}>
          {children ?? main}
        </div>
      </section>

      {details && (
        <details open={detailsOpen} className="group mt-6 rounded-card bg-surface shadow-card dark:ring-1 dark:ring-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-card px-5 py-4 text-[14px] font-medium text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={16} aria-hidden className="transition group-open:rotate-90" />{detailsLabel}
          </summary>
          <div className="px-5 pb-5">{details}</div>
        </details>
      )}
      {overlay}
    </div>
  );
}
