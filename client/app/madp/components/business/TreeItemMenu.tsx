/** The "…" menu of a tree row: Rename, Move to…, Move up, Move down, Delete. The scratch pad offers Open only. */
import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Ellipsis, FolderInput, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { MENU_ITEM, MENU_PANEL } from "@/madp/ui/kit";
import { Popover } from "@/madp/ui/popover";
import { t, useT } from "@/madp/i18n";

export type TreeMenuAction = "open" | "rename" | "move" | "moveUp" | "moveDown" | "delete";

const ITEM = `${MENU_ITEM} items-center`;

export interface TreeItemMenuProps {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: TreeMenuAction) => void;
  canEdit: boolean;
  editReason: string | null;
  scratch?: boolean;
  /** false at the first / last place of the sibling group */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

const ITEMS: { action: TreeMenuAction; text: string; icon: LucideIcon; danger?: boolean }[] = [
  { action: "rename", get text() { return t("analysis.business.menu.rename", "Rename"); }, icon: Pencil },
  { action: "move", get text() { return t("analysis.business.menu.moveTo", "Move to…"); }, icon: FolderInput },
  { action: "moveUp", get text() { return t("analysis.business.menu.moveUp", "Move up"); }, icon: ArrowUp },
  { action: "moveDown", get text() { return t("analysis.business.menu.moveDown", "Move down"); }, icon: ArrowDown },
  { action: "delete", get text() { return t("analysis.business.menu.delete", "Delete"); }, icon: Trash2, danger: true },
];

export function TreeItemMenu({ label, open, onOpenChange, onAction, canEdit, editReason, scratch, canMoveUp = true, canMoveDown = true }: TreeItemMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const t = useT();
  const name = t("analysis.business.menu.optionsFor", "Options for {name}", { name: label });

  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) onOpenChange(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("touchstart", away); };
  }, [open, onOpenChange]);

  const close = () => { onOpenChange(false); trigger.current?.closest<HTMLElement>('[role="treeitem"]')?.focus(); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab") { onOpenChange(false); return; }
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + d + items.length) % items.length]?.focus();
  };
  const pick = (action: TreeMenuAction) => { onOpenChange(false); onAction(action); };

  const disabledFor = (a: TreeMenuAction) => !canEdit || (a === "moveUp" && !canMoveUp) || (a === "moveDown" && !canMoveDown);

  return (
    <>
      <button ref={trigger} type="button" tabIndex={-1} aria-label={name} title={name} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); onOpenChange(!open); }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink2 outline-none transition hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50">
        <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <Popover anchorRef={trigger} panelRef={menu} placement="bottom-end" offset={4} onClose={() => onOpenChange(false)}
          id={id} role="menu" aria-label={name} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}
          className={`w-max min-w-[200px] max-w-[calc(100vw-2rem)] ${MENU_PANEL}`}>
          {scratch ? (
            <button type="button" role="menuitem" className={ITEM} onClick={() => pick("open")}>{t("analysis.business.file.open", "Open")}</button>
          ) : (
            <>
              {ITEMS.map((it) => {
                const off = disabledFor(it.action);
                return (
                  <button key={it.action} type="button" role="menuitem" aria-disabled={off || undefined} title={!canEdit ? editReason ?? undefined : undefined}
                    onClick={() => { if (!off) pick(it.action); }}
                    className={`${ITEM} ${it.danger ? "text-danger" : ""} ${off ? "cursor-not-allowed opacity-45" : ""}`}>
                    <it.icon size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
                    {it.text}
                  </button>
                );
              })}
              {!canEdit && editReason && <p className="px-3 pb-2 pt-1 text-[12px] text-ink3">{editReason}</p>}
            </>
          )}
        </Popover>
      )}
    </>
  );
}
