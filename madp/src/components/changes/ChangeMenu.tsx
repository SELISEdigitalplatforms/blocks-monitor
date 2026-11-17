import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { EllipsisVertical, ListPlus, Replace } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { MENU_ITEM, MENU_PANEL } from "@/ui/kit";
import { Popover } from "@/ui/popover";
import { isBlocksProjectId } from "@/domain/projects";
import { BLOCKS_LANE_META as LANE_META, isBlocksFeatureTarget, useBlocksChangeAccess } from "./blocksChanges";
import { openChangeRequest, type ChangeTarget } from "./changeUi";
import { useParams } from "react-router-dom";

const ITEM = `${MENU_ITEM} items-center`;

/** The row action menu after a release: Change feature / Enhance feature on the exact feature or requirement.
 *  On a Blocks project only a feature can be changed (L8 validates the target); other rows get no control. */
export function ChangeMenu({ target, className }: { target: ChangeTarget; className?: string }) {
  const id = useParams().id;
  if (!isBlocksProjectId(id)) return null;
  return isBlocksFeatureTarget(target) ? <BlocksChangeMenu id={id!} target={target} className={className} /> : null;
}

function BlocksChangeMenu({ id, target, className }: { id: string; target: ChangeTarget; className?: string }) {
  const { canRun } = useBlocksChangeAccess(id);
  return <MenuView canRun={canRun} target={target} className={className} />;
}

function MenuView({ canRun, target, className }: { canRun: boolean; target: ChangeTarget; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // The popover is placed in its own layout effect (it runs first), so the first item can take focus right here.
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (wrap.current && !wrap.current.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
    };
  }, [open]);

  if (!canRun) return null;

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (lane: "change" | "enhance") => {
    setOpen(false);
    openChangeRequest({ lane, target });
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
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + d + items.length) % items.length]?.focus();
  };

  return (
    <span ref={wrap} className={cn("relative inline-flex shrink-0", className)}>
      <button
        ref={trigger}
        type="button"
        aria-label={t("changes.menu.options", "Change options for {title}", { title: target.title })}
        title={t("changes.menu.options", "Change options for {title}", { title: target.title })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 outline-none transition hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <EllipsisVertical size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <Popover
          anchorRef={trigger}
          panelRef={menu}
          placement="bottom-end"
          offset={4}
          onClose={() => setOpen(false)}
          id={menuId}
          role="menu"
          aria-label={t("changes.menu.options", "Change options for {title}", { title: target.title })}
          onKeyDown={onKey}
          className={`w-max min-w-[200px] max-w-[calc(100vw-2rem)] ${MENU_PANEL}`}
        >
          <button type="button" role="menuitem" className={ITEM} onClick={() => pick("change")}>
            <Replace size={16} strokeWidth={1.75} className="shrink-0 text-ink2" aria-hidden />
            {LANE_META.change.label}
          </button>
          <button type="button" role="menuitem" className={ITEM} onClick={() => pick("enhance")}>
            <ListPlus size={16} strokeWidth={1.75} className="shrink-0 text-ink2" aria-hidden />
            {LANE_META.enhance.label}
          </button>
        </Popover>
      )}
    </span>
  );
}
