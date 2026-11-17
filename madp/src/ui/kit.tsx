/** MADP Factory UI kit. Every screen builds from these pieces only, so the whole app looks like ONE product.
 *  Rules: one primary (blue) action per screen; violet only for AI content; status colours only for status. */
import {
  forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent,
  type MouseEvent as ReactMouseEvent, type ReactNode, type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Check, ChevronDown, Factory, TrendingDown, TrendingUp, X } from "lucide-react";
import type { ChipTone } from "@/data/types";
import { cn } from "@/lib/cn";
import { Popover, itemsPerView } from "./popover";
import { useT } from "@/i18n";

/* ── surfaces ─────────────────────────────────────────────────────────────── */

/** The body's default padding, minus every side the caller pads in bodyClassName (cn() does not merge Tailwind classes,
 *  so a default and an override on the same side would fight and the default would win). */
function bodyPadding(own: string | undefined, headed: boolean) {
  const set = new Set((own ?? "").split(/\s+/).map((c) => /^(p|px|py|pt|pb|pl|pr)-/.exec(c)?.[1]));
  const side = (...keys: string[]) => keys.some((k) => set.has(k));
  return cn(!side("p", "px", "pl") && "pl-6", !side("p", "px", "pr") && "pr-6",
    !side("p", "py", "pt") && (headed ? "pt-4" : "pt-6"), !side("p", "py", "pb") && "pb-6");
}

export function Card({ title, icon, action, arrow, onArrow, className, bodyClassName, children, tone = "surface" }: {
  title?: ReactNode; icon?: ReactNode; action?: ReactNode; arrow?: boolean; onArrow?: () => void;
  className?: string; bodyClassName?: string; children?: ReactNode; tone?: "surface" | "soft" | "stage";
}) {
  const headed = Boolean(title || action || arrow);
  return (
    <section className={cn("rounded-card animate-rise",
      tone === "surface" && "bg-surface shadow-card dark:ring-1 dark:ring-line",
      tone === "soft" && "bg-surface2",
      tone === "stage" && "bg-stage text-white", className)}>
      {headed && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pt-5">
          {icon && <span className="text-ink2">{icon}</span>}
          {title && <h3 className="min-w-0 text-[17px] font-medium tracking-tight">{title}</h3>}
          <div className="ml-auto flex items-center gap-2">
            {action}
            {arrow && <ArrowButton onClick={onArrow} />}
          </div>
        </header>
      )}
      <div className={cn(bodyPadding(bodyClassName, headed), bodyClassName)}>{children}</div>
    </section>
  );
}

export function ArrowButton({ onClick, label }: { onClick?: () => void; label?: string }) {
  const t = useT();
  return (
    <button type="button" aria-label={label ?? t("common.actions.open", "Open")} onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full bg-surface2 text-ink2 transition hover:bg-accent hover:text-white">
      <ArrowUpRight size={16} strokeWidth={1.75} />
    </button>
  );
}

export function StatCard({ label, value, trend, trendText, foot, icon, className }: {
  label: string; value: ReactNode; trend?: number; trendText?: string; foot?: ReactNode; icon?: ReactNode; className?: string;
}) {
  return (
    <Card className={className} bodyClassName="pt-5">
      <div className="flex items-center gap-2 text-ink2">
        {icon}
        <span className="text-[15px]">{label}</span>
      </div>
      <div className="num mt-3 text-[44px] font-medium leading-none tracking-[-0.03em]">{value}</div>
      {(trend !== undefined || trendText) && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-ink3">
          {trend !== undefined && <TrendPill value={trend} />}
          {trendText}
        </div>
      )}
      {foot && <div className="mt-4">{foot}</div>}
    </Card>
  );
}

export function TrendPill({ value, suffix = "%" }: { value: number; suffix?: string }) {
  return (
    <span className="num inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[12px] font-medium text-white">
      {value < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
      {value > 0 ? "+" : ""}{value}{suffix}
    </span>
  );
}

/* ── actions ──────────────────────────────────────────────────────────────── */

type BtnVariant = "primary" | "secondary" | "ghost" | "ai" | "danger" | "danger-quiet";
export function Button({ variant = "secondary", size = "md", icon, iconRight, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; icon?: ReactNode; iconRight?: ReactNode }) {
  return (
    <button type="button" {...rest}
      className={cn("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "h-8 px-3.5 text-[13px]", size === "md" && "h-10 px-5 text-[14px]", size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" && "bg-accent text-white hover:bg-accent-hover",
        // the strong neutral: ink on light; a raised grey in dark (a white pill would outshine the primary)
        variant === "secondary" && "bg-ink text-canvas hover:opacity-90 dark:bg-ink/15 dark:text-ink dark:hover:bg-ink/20 dark:hover:opacity-100",
        variant === "ghost" && "bg-surface2 text-ink hover:bg-line",
        variant === "ai" && "bg-ai text-white hover:opacity-90",
        variant === "danger" && "bg-danger-soft text-danger hover:bg-danger hover:text-white",
        // a destructive way out beside a primary (a dialog's "Discard"): red text, the soft red only on hover, never louder than the primary
        variant === "danger-quiet" && "text-danger hover:bg-danger-soft",
        className)}>
      {icon}{children}{iconRight}
    </button>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, { icon: ReactNode; label: string; badge?: boolean; className?: string }
  & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">>(function IconButton({ icon, label, badge, className, ...rest }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} title={label} {...rest}
      className={cn("group relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink2 transition hover:bg-line hover:text-ink dark:ring-1 dark:ring-line", className)}>
      {icon}
      {/* placed from the centre, so it sits on the icon's corner at any button size */}
      {badge && <span className="absolute left-[calc(50%+2px)] top-[calc(50%-10px)] h-2 w-2 rounded-full bg-accent ring-2 ring-surface transition group-hover:ring-line" />}
    </button>
  );
});

/* ── labels ───────────────────────────────────────────────────────────────── */

/** 12 px text on a soft fill: each tone's text names its -text token directly (AA on its soft fill in both themes; in
 *  dark the accent text is a lighter blue, as the accent itself on the dark accent-soft is about 2.7:1). */
const CHIP: Record<ChipTone, string> = {
  neutral: "bg-surface2 text-ink2",
  accent: "bg-accent-soft text-[rgb(var(--c-accent-text))]",
  ai: "bg-ai-soft text-[rgb(var(--c-ai-text))]",
  success: "bg-success-soft text-[rgb(var(--c-success-text))]",
  warning: "bg-warning-soft text-[rgb(var(--c-warning-text))]",
  danger: "bg-danger-soft text-[rgb(var(--c-danger-text))]",
};

export function Chip({ tone = "neutral", icon, className, children, title }: { tone?: ChipTone; icon?: ReactNode; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium", CHIP[tone], className)}>
      {icon}{children}
    </span>
  );
}

/** Marks text the AI wrote (violet, the only place violet is used). */
export function AiTag({ children }: { children?: ReactNode }) {
  const t = useT();
  return <Chip tone="ai" icon={<Factory size={12} strokeWidth={1.75} />}>{children ?? t("shell.kit.writtenByFactory", "Written by the factory")}</Chip>;
}

export function Dot({ tone = "accent", pulse }: { tone?: ChipTone; pulse?: boolean }) {
  const bg = { neutral: "bg-ink3", accent: "bg-accent", ai: "bg-ai", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return <span className={cn("inline-block h-2 w-2 rounded-full", bg, pulse && "animate-pulse-dot")} />;
}

/* ── navigation within a page ─────────────────────────────────────────────── */

/** One choice of a few (a radio group): the arrow keys move the choice, like any native radio group. */
export function Segmented<T extends string>({ options, value, onChange, className, label }: {
  options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; label?: string;
}) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (options.findIndex((o) => o.value === value) + d + options.length) % options.length;
    onChange(options[i].value);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={cn("inline-flex rounded-full bg-surface2 p-1 ring-1 ring-inset ring-line", className)} role="radiogroup" aria-label={label} onKeyDown={move}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cn("h-8 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition",
            value === o.value ? "bg-accent-soft text-[rgb(var(--c-accent-text))]" : "text-ink2 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className, label, idPrefix }: {
  tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; label?: string; idPrefix?: string;
}) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
    e.preventDefault();
    const cur = tabs.findIndex((t) => t.value === value);
    const i = k === "Home" ? 0 : k === "End" ? tabs.length - 1 : (cur + (k === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[i].value);
    (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={cn("flex gap-6 border-b border-line", className)} role="tablist" aria-label={label} onKeyDown={idPrefix ? move : undefined}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          {...(idPrefix ? { id: `${idPrefix}-tab-${t.value}`, "aria-controls": `${idPrefix}-panel-${t.value}`, tabIndex: value === t.value ? 0 : -1 } : {})}
          className={cn("-mb-px shrink-0 whitespace-nowrap rounded-t-md border-b-2 pb-3 text-[14px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
            value === t.value ? "border-accent text-ink" : "border-transparent text-ink3 hover:text-ink")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── people ───────────────────────────────────────────────────────────────── */

export function Avatar({ initials, size = 36, tone = "ink", className }: { initials: string; size?: number; tone?: "ink" | "accent" | "soft"; className?: string }) {
  return (
    <span style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={cn("grid shrink-0 place-items-center rounded-full font-medium",
        tone === "ink" && "bg-ink text-canvas", tone === "accent" && "bg-accent text-white", tone === "soft" && "bg-surface2 text-ink2", className)}>
      {initials}
    </span>
  );
}

/* ── status ───────────────────────────────────────────────────────────────── */

/** One status sentence + the single next action. */
export function Banner({ tone = "accent", title, text, action, className }: { tone?: ChipTone; title: ReactNode; text?: ReactNode; action?: ReactNode; className?: string }) {
  const bar = { neutral: "bg-ink3", accent: "bg-accent", ai: "bg-ai", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-block bg-surface px-5 py-4 shadow-card dark:ring-1 dark:ring-line", className)}>
      <div className="flex min-w-[min(100%,16rem)] flex-1 items-stretch gap-4">
        <span className={cn("min-h-10 w-1.5 shrink-0 self-stretch rounded-full", bar)} />
        <div className="flex min-w-0 flex-col justify-center">
          <div className="text-[15px] font-medium">{title}</div>
          {text && <div className="mt-0.5 text-[13px] text-ink2">{text}</div>}
        </div>
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

export function ProgressRing({ value, size = 56, stroke = 6, label }: { value: number; size?: number; stroke?: number; label?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface2" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className="stroke-accent transition-[stroke-dashoffset] duration-300 ease-out" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, value)) / 100)} />
      </svg>
      <span className="num absolute text-[13px] font-medium">{label ?? `${Math.round(value)}%`}</span>
    </div>
  );
}

export function Bar({ value, tone = "accent", hatchRest = true, className }: { value: number; tone?: ChipTone; hatchRest?: boolean; className?: string }) {
  const bg = { neutral: "bg-ink", accent: "bg-accent", ai: "bg-ai", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full", hatchRest ? "hatched bg-surface2" : "bg-surface2", className)}>
      {/* ease-out: a value that updates many times a second still keeps up (an ease-in restart would stall it) */}
      <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out", bg)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* ── page structure ───────────────────────────────────────────────────────── */

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-4 animate-rise">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[13px] text-ink3">{eyebrow}</div>}
        <h1 className="text-[34px] font-medium leading-tight tracking-[-0.02em]">{title}</h1>
        {subtitle && <div className="mt-1 max-w-2xl text-[15px] text-ink2">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-block hatched bg-surface2 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink3">{icon}</div>}
      <div className="text-[16px] font-medium">{title}</div>
      {text && <p className="mt-1 max-w-sm text-[14px] text-ink2">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-ink3">{children}</div>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("h-11 w-full rounded-block bg-surface2 px-4 text-[14px] text-ink outline-none ring-accent/40 placeholder:text-ink3 focus:ring-2 disabled:cursor-not-allowed disabled:text-ink2 disabled:opacity-70", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("min-h-[96px] w-full rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink outline-none ring-accent/40 placeholder:text-ink3 focus:ring-2 disabled:cursor-not-allowed disabled:text-ink2 disabled:opacity-70", props.className)} />;
}

/* ── menus and select ─────────────────────────────────────────────────────── */

/** One popover family: every menu and the Select list share this surface, and MENU_ITEM for a row (add items-* per menu). */
export const MENU_PANEL = "rounded-card bg-surface p-2 shadow-float ring-1 ring-line animate-rise";
export const MENU_ITEM = "flex w-full gap-3 rounded-block px-3 py-2.5 text-left text-[14px] text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:bg-surface2 focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/50";

export interface SelectOption { value: string; label: string; disabled?: boolean }

/** The next enabled option from `from` in direction `dir` (stops at the ends); -1 when none is enabled. */
export function stepOption(options: SelectOption[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
  return options.some((o) => !o.disabled) && from >= 0 && from < options.length && !options[from].disabled ? from : -1;
}

/** The first enabled option (dir 1) or the last (dir -1). */
export function edgeOption(options: SelectOption[], dir: 1 | -1): number {
  return stepOption(options, dir === 1 ? -1 : options.length, dir);
}

/** PageDown / PageUp: the enabled option `perPage` enabled options on from `from` (held at the ends); from none, the
 *  first or the last enabled option. */
export function pageOption(options: SelectOption[], from: number, dir: 1 | -1, perPage: number): number {
  if (from < 0 || from >= options.length) return edgeOption(options, dir);
  let i = from;
  for (let n = 0; n < Math.max(1, perPage); n++) {
    const next = stepOption(options, i, dir);
    if (next < 0 || next === i) break;
    i = next;
  }
  return i;
}

/** Type-ahead: the next enabled option after `from` whose label starts with `text` (wraps); -1 when none. */
export function matchOption(options: SelectOption[], text: string, from: number): number {
  const q = text.toLowerCase();
  for (let n = 1; n <= options.length; n++) {
    const i = (from + n + options.length) % options.length;
    if (!options[i].disabled && options[i].label.toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

/** A themed, accessible listbox in place of a native select. Flips upward near the bottom and aligns right near the edge. */
export function Select({ value, onChange, options, label, className, size = "md", disabled, placeholder }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; label: string; className?: string;
  size?: "sm" | "md"; disabled?: boolean; placeholder?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selected = options.findIndex((o) => o.value === value);

  const show = () => {
    if (disabled) return;
    setActive(selected >= 0 && !options[selected].disabled ? selected : edgeOption(options, 1));
    setOpen(true);
  };
  const close = (refocus: boolean) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const pick = (i: number) => {
    if (i < 0 || options[i].disabled) return;
    onChange(options[i].value);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!root.current?.contains(t) && !list.current?.contains(t)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const k = e.key;
    if (!open) {
      if (k === "Enter" || k === " " || k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); show(); }
      return;
    }
    if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); setActive(stepOption(options, active, k === "ArrowDown" ? 1 : -1)); }
    else if (k === "Home" || k === "End") { e.preventDefault(); setActive(edgeOption(options, k === "Home" ? 1 : -1)); }
    else if (k === "PageDown" || k === "PageUp") {
      e.preventDefault();
      const view = list.current;
      const perPage = view ? itemsPerView(view, view.children[Math.max(0, active)] as HTMLElement | undefined) : 10;
      setActive(pageOption(options, active, k === "PageDown" ? 1 : -1, perPage));
    }
    else if (k === "Enter" || k === " ") { e.preventDefault(); pick(active); }
    else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === "Tab") close(false);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + k, at: now };
      const i = matchOption(options, typed.current.text, typed.current.text.length > 1 ? active - 1 : active);
      if (i >= 0) setActive(i);
    }
  };

  const current = selected >= 0 ? options[selected].label : placeholder ?? "";
  return (
    <div ref={root} className={cn("relative min-w-0", className)} onKeyDown={onKey}>
      <button ref={trigger} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? id : undefined} disabled={disabled} onClick={() => (open ? close(false) : show())}
        className={cn("flex w-full min-w-0 items-center justify-between gap-2 rounded-block bg-surface2 px-4 text-left text-[14px] text-ink outline-none ring-accent/40 focus-visible:ring-2 disabled:cursor-not-allowed disabled:text-ink2 disabled:opacity-70",
          size === "sm" ? "h-9" : "h-11")}>
        <span className="min-w-0 truncate">{current}</span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink3" />
      </button>
      {open && (
        <Popover anchorRef={trigger} panelRef={list} onClose={() => setOpen(false)} id={id} role="listbox" aria-label={label} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          style={{ minWidth: trigger.current?.offsetWidth }}
          className={cn("scroll-thin max-h-64 w-max max-w-[calc(100vw-2rem)] overflow-y-auto", MENU_PANEL)}>
          {options.map((o, i) => (
            <div key={o.value} id={`${id}-${i}`} role="option" aria-selected={i === selected} aria-disabled={o.disabled || undefined}
              onMouseEnter={() => !o.disabled && setActive(i)} onClick={() => pick(i)}
              className={cn("flex items-center gap-3 rounded-block px-3 py-2.5 text-[14px] transition",
                o.disabled ? "cursor-not-allowed text-ink3 opacity-60" : "cursor-pointer text-ink2",
                i === active && !o.disabled && "bg-surface2 text-ink", i === selected && "font-medium text-ink")}>
              <span className="min-w-0 flex-1">{o.label}</span>
              {i === selected && <Check size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />}
            </div>
          ))}
        </Popover>
      )}
    </div>
  );
}

/* ── overlays ─────────────────────────────────────────────────────────────── */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal overlay's behaviour: focus moves into the panel (its close button) and Tab stays inside, Escape closes, the
 *  page behind does not scroll, and on close focus returns to whatever opened it. */
function useDialog(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const box = panel.current;
    box?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const body = document.body.style;
    const before = { overflow: body.overflow, paddingRight: body.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    body.overflow = "hidden";
    if (gutter > 0) body.paddingRight = `${gutter}px`;
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close.current(); return; }
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      body.overflow = before.overflow;
      body.paddingRight = before.paddingRight;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
  return panel;
}

/** The scrim closes its dialog only on a click that both starts and ends on the scrim itself: selecting text in a field
 *  and releasing the mouse outside the panel must not close the dialog (and throw away what was typed). */
export function useBackdropDismiss(onClose: () => void) {
  return scrimHandlers(useRef(false), onClose);
}

/** The scrim's mouse handlers (pure, for useBackdropDismiss): `downOnScrim` remembers where the press started. */
export function scrimHandlers(downOnScrim: { current: boolean }, onClose: () => void) {
  type ScrimEvent = Pick<ReactMouseEvent, "target" | "currentTarget">;
  return {
    onMouseDown: (e: ScrimEvent) => { downOnScrim.current = e.target === e.currentTarget; },
    onClick: (e: ScrimEvent) => {
      const close = downOnScrim.current && e.target === e.currentTarget;
      downOnScrim.current = false;
      if (close) onClose();
    },
  };
}

/** The header's end: the close button. */
function HeaderEnd({ onClose }: { onClose: () => void }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      <CloseButton onClick={onClose} />
    </span>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" aria-label={t("common.actions.close", "Close")} data-autofocus onClick={onClick}
      className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 transition hover:bg-line hover:text-ink"><X size={16} /></button>
  );
}

/** Right-side inspector panel (V_DTOR style). */
export function Drawer({ open, onClose, title, children, width = 440, side = 'right' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; side?: 'right' | 'bottom';
}) {
  const panel = useDialog(open, onClose);
  const scrim = useBackdropDismiss(onClose);
  const id = useId();
  if (!open) return null;
  if (side === 'bottom') {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(var(--c-scrim)/0.28)] backdrop-blur-[2px] dark:bg-[rgb(var(--c-scrim)/0.6)]" {...scrim}>
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}
          className="mx-3 mb-3 flex max-h-[min(85dvh,calc(100dvh-24px))] w-[calc(100vw-24px)] max-w-[720px] flex-col overflow-hidden rounded-card bg-surface shadow-float animate-rise dark:ring-1 dark:ring-line">
          <header className="flex items-center gap-3 border-b border-line px-6 py-4">
            <h3 id={id} className="min-w-0 text-[17px] font-medium">{title}</h3>
            <HeaderEnd onClose={onClose} />
          </header>
          <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgb(var(--c-scrim)/0.28)] backdrop-blur-[2px] dark:bg-[rgb(var(--c-scrim)/0.6)]" {...scrim}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} style={{ width }} onClick={(e) => e.stopPropagation()}
        className="m-3 flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-card bg-surface shadow-float animate-rise dark:ring-1 dark:ring-line">
        <header className="flex items-center gap-3 border-b border-line px-6 py-4">
          <h3 id={id} className="min-w-0 text-[17px] font-medium">{title}</h3>
          <HeaderEnd onClose={onClose} />
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Modal({ open, onClose, title, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const panel = useDialog(open, onClose);
  const scrim = useBackdropDismiss(onClose);
  const id = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--c-scrim)/0.28)] p-4 backdrop-blur-[2px] dark:bg-[rgb(var(--c-scrim)/0.6)]" {...scrim}>
      {/* never wider or taller than the screen: the body scrolls inside, the header and footer stay */}
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} style={{ width: `min(${width}px, 100%)` }} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-card bg-surface shadow-float animate-rise dark:ring-1 dark:ring-line">
        <header className="flex items-center gap-3 px-6 pt-5">
          <h3 id={id} className="min-w-0 text-[19px] font-medium">{title}</h3>
          <HeaderEnd onClose={onClose} />
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
