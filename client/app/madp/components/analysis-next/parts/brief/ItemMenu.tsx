/** The one ⋯ menu on a row of the Business Analysis lists: every action on the item in one place, the same icon size
 *  and style for each (16 px lucide icons on the shared menu surface, MENU_PANEL). An entry can open a short list of
 *  choices in the same panel ("Change priority ▸" → Must / Should / Could), with a way back.
 *  Keyboard: Enter / Space / ↓ on the button opens it; ↑ ↓ Home End move; → opens an entry's choices and ← goes back;
 *  Escape goes back, then closes and returns focus to the button; Tab closes. With no entries it renders an empty
 *  slot of the same size, so rows stay aligned. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Ellipsis, type LucideIcon } from "lucide-react";
import { MENU_ITEM, MENU_PANEL } from "@/madp/ui/kit";
import { Popover } from "@/madp/ui/popover";
import { cn } from "@/madp/lib/cn";

export interface MenuChoice { key: string; label: string; hint?: string; checked: boolean; onSelect: () => void }

export interface MenuEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect?: () => void;
  /** Opens these choices in the panel instead of acting. */
  choices?: MenuChoice[];
  /** A short value at the end of the entry (a count). */
  hint?: string;
  disabled?: boolean;
  /** Why it is disabled (its tooltip). */
  disabledNote?: string;
  /** Destructive (Delete): red, with a rule above it. */
  danger?: boolean;
}

/** MENU_ITEM's shape without its colours (cn does not merge classes, so a red entry cannot just add a colour). */
const DANGER_ITEM = "flex w-full items-center gap-3 rounded-block px-3 py-2.5 text-left text-[14px] text-[rgb(var(--c-danger-text))] outline-none transition hover:bg-danger-soft focus-visible:bg-danger-soft focus-visible:ring-2 focus-visible:ring-accent/50";
const ITEM = `${MENU_ITEM} items-center`;
const ROWS = '[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemradio"]';

export const MENU_TRIGGER = "grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink3 outline-none transition hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50";

export function ItemMenu({ label, entries, triggerAttrs, onOpen, className }: {
  /** The button's name: "Actions for R-3 Sign in with e-mail". */
  label: string;
  entries: MenuEntry[];
  /** Extra data attributes on the button (the feedback card points at it and returns focus to it). */
  triggerAttrs?: Record<`data-${string}`, string>;
  onOpen?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const backTo = useRef<string | null>(null);
  const id = useId();
  const subEntry = sub ? entries.find((e) => e.key === sub && e.choices) ?? null : null;

  // the panel is placed in its own layout effect (it runs first): focus the first entry, the chosen choice, or the
  // entry the person came back from
  useLayoutEffect(() => {
    if (!open) return;
    const panel = menu.current;
    if (!panel) return;
    const want = subEntry
      ? panel.querySelector<HTMLElement>('[aria-checked="true"]')
      : backTo.current ? panel.querySelector<HTMLElement>(`[data-entry="${CSS.escape(backTo.current)}"]`) : null;
    backTo.current = null;
    (want ?? panel.querySelector<HTMLElement>(ROWS))?.focus();
  }, [open, sub]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !menu.current?.contains(t)) { setOpen(false); setSub(null); }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("touchstart", away); };
  }, [open]);

  if (entries.length === 0) return <span aria-hidden className={cn("h-8 w-8 shrink-0", className)} />;

  const show = () => { onOpen?.(); setSub(null); setOpen(true); };
  const close = (refocus: boolean) => {
    setOpen(false); setSub(null);
    if (refocus) trigger.current?.focus();
  };
  const back = () => { backTo.current = sub; setSub(null); };
  /** Acts, then gives focus back to the button unless the action moved it (a form that opened, the comment card). */
  const act = (fn: () => void) => {
    close(false);
    fn();
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body) trigger.current?.focus();
    });
  };
  const pick = (e: MenuEntry) => {
    if (e.disabled) return;
    if (e.choices) setSub(e.key);
    else if (e.onSelect) act(e.onSelect);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (subEntry) back(); else close(true); return; }
    if (e.key === "Tab") { close(false); return; }
    if (subEntry && e.key === "ArrowLeft") { e.preventDefault(); back(); return; }
    if (!subEntry && e.key === "ArrowRight") {
      const k = (document.activeElement as HTMLElement | null)?.dataset.entry;
      const en = entries.find((x) => x.key === k);
      if (en?.choices && !en.disabled) { e.preventDefault(); setSub(en.key); }
      return;
    }
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ROWS));
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (at + 1) % rows.length
      : e.key === "ArrowUp" ? (at - 1 + rows.length) % rows.length
      : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    rows[next]?.focus();
  };

  return (
    <>
      <button ref={trigger} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? id : undefined} {...triggerAttrs}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); show(); } }}
        className={cn(MENU_TRIGGER, open && "bg-surface2 text-ink", className)}>
        <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <Popover key={subEntry ? subEntry.key : "main"} anchorRef={trigger} panelRef={menu} placement="bottom-end" offset={4}
          onClose={() => close(false)} id={id} role="menu" aria-label={subEntry ? subEntry.label : label} onKeyDown={onKey}
          className={cn("w-max min-w-[220px] max-w-[calc(100vw-2rem)]", MENU_PANEL)}>
          {subEntry ? (
            <>
              <button type="button" role="menuitem" data-entry="back" onClick={back}
                className={cn(ITEM, "py-2 text-[13px] font-medium")}>
                <ChevronLeft size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
                {subEntry.label}
              </button>
              <div role="separator" className="mx-2 my-1 h-px bg-line" />
              {subEntry.choices!.map((c) => (
                <button key={c.key} type="button" role="menuitemradio" aria-checked={c.checked}
                  onClick={() => act(() => { if (!c.checked) c.onSelect(); })} className={ITEM}>
                  <Check size={16} strokeWidth={2} aria-hidden className={cn("shrink-0", c.checked ? "text-[rgb(var(--c-accent-text))]" : "invisible")} />
                  <span className="flex min-w-0 flex-col">
                    <span className={cn(c.checked && "font-medium text-ink")}>{c.label}</span>
                    {c.hint && <span className="text-[12px] leading-snug text-ink3">{c.hint}</span>}
                  </span>
                </button>
              ))}
            </>
          ) : entries.map((en) => (
            <div key={en.key} role="none">
              {en.danger && <div role="separator" className="mx-2 my-1 h-px bg-line" />}
              <button type="button" role="menuitem" data-entry={en.key} aria-disabled={en.disabled || undefined}
                aria-haspopup={en.choices ? "menu" : undefined} title={en.disabled ? en.disabledNote : undefined}
                onClick={() => pick(en)}
                className={cn(en.danger ? DANGER_ITEM : ITEM, en.disabled && "cursor-not-allowed opacity-45")}>
                <en.icon size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{en.label}</span>
                {en.hint && <span className="num rounded-full bg-surface2 px-1.5 text-[12px] text-ink2">{en.hint}</span>}
                {en.choices && <ChevronRight size={16} strokeWidth={1.75} className="shrink-0 text-ink3" aria-hidden />}
              </button>
            </div>
          ))}
        </Popover>
      )}
    </>
  );
}
