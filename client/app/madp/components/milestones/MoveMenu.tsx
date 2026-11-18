import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MoveVertical } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { MENU_ITEM, MENU_PANEL } from "@/madp/ui/kit";
import { Popover } from "@/madp/ui/popover";

export interface MoveMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

const ITEM = `${MENU_ITEM} items-center disabled:cursor-not-allowed disabled:opacity-45`;

/** The touch / keyboard alternative to dragging: a menu button with Move up, Move down, Move to … */
export function MoveMenu({ label, items, className }: { label: string; items: MoveMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const els = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    if (!els.length) return;
    const at = els.indexOf(document.activeElement as HTMLElement);
    els[(at + d + els.length) % els.length]?.focus();
  };

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 outline-none transition hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <MoveVertical size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <Popover
          panelRef={menu}
          anchorRef={trigger}
          placement="bottom-end"
          offset={4}
          onClose={() => setOpen(false)}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          className={`w-max min-w-[220px] max-w-[calc(100vw-2rem)] ${MENU_PANEL}`}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className={ITEM}
              onClick={() => {
                setOpen(false);
                it.onSelect();
                trigger.current?.focus();
              }}
            >
              {it.label}
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}
