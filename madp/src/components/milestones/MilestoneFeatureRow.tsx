import { useId, type DragEvent, type KeyboardEvent } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import { MoveMenu, type MoveMenuItem } from "./MoveMenu";
import { useT } from "@/i18n";

export interface FeatureRowProps {
  featureRef: string;
  name: string;
  /** Position inside its list; the tray rows have no milestone. */
  index: number;
  count: number;
  /** Milestones other than the current one, for "Move to milestone N". */
  targets: { key: string; number: number }[];
  inMilestone: boolean;
  editable: boolean;
  picked: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveTo: (milestoneKey: string) => void;
  onUnassign: () => void;
  onHandleKey: (e: KeyboardEvent<HTMLElement>) => void;
  /** A feature dropped before this row (data is the drag payload). */
  onDropBefore: (data: string) => void;
}

export const FEATURE_DRAG_PREFIX = "feature:";

export function MilestoneFeatureRow(p: FeatureRowProps) {
  const t = useT();
  const help = useId();
  if (!p.editable) {
    return <li className="rounded-block bg-surface2 px-3 py-2 text-[14px] text-ink">{p.name}</li>;
  }
  // the "Not in a milestone" tray has no order to change: it offers only the moves into a milestone
  const items: MoveMenuItem[] = [
    ...(p.inMilestone ? [
      { key: "up", label: t("build.milestones.moveUp", "Move up"), onSelect: p.onMoveUp, disabled: p.index <= 0 },
      { key: "down", label: t("build.milestones.moveDown", "Move down"), onSelect: p.onMoveDown, disabled: p.index >= p.count - 1 },
    ] : []),
    ...p.targets.map((m) => ({ key: `to-${m.key}`, label: t("build.milestones.moveTo", "Move to milestone {number}", { number: m.number }), onSelect: () => p.onMoveTo(m.key) })),
    ...(p.inMilestone ? [{ key: "remove", label: t("build.milestones.removeFrom", "Remove from milestone"), onSelect: p.onUnassign }] : []),
  ];
  const dragStart = (e: DragEvent<HTMLLIElement>) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", FEATURE_DRAG_PREFIX + p.featureRef);
    e.dataTransfer.effectAllowed = "move";
  };
  const over = (e: DragEvent<HTMLLIElement>) => {
    if (e.dataTransfer.types.includes("text/plain")) e.preventDefault();
  };
  const drop = (e: DragEvent<HTMLLIElement>) => {
    const data = e.dataTransfer.getData("text/plain");
    if (!data.startsWith(FEATURE_DRAG_PREFIX)) return;
    e.preventDefault();
    e.stopPropagation();
    p.onDropBefore(data);
  };
  return (
    <li
      draggable
      onDragStart={dragStart}
      onDragOver={over}
      onDrop={drop}
      className={cn("flex items-center gap-2 rounded-block bg-surface2 py-1.5 pl-1.5 pr-2 text-[14px] text-ink motion-safe:transition", p.picked && "ring-2 ring-accent")}
    >
      <button
        type="button"
        data-focus-id={`f:${p.featureRef}`}
        aria-label={t("build.milestones.move", "Move {name}", { name: p.name })}
        aria-pressed={p.picked}
        aria-describedby={help}
        onKeyDown={p.onHandleKey}
        className="grid h-9 w-9 shrink-0 cursor-grab place-items-center rounded-full text-ink3 outline-none hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <GripVertical size={16} strokeWidth={1.75} aria-hidden />
      </button>
      <span id={help} className="sr-only">
        {t("build.milestones.featureKeys", "Space picks up and drops. Up and Down reorder, Left and Right change milestone, Enter drops, Escape cancels.")}
      </span>
      <span className="min-w-0 flex-1 break-words">{p.name}</span>
      <MoveMenu label={t("build.milestones.moveOptions", "Move options for {name}", { name: p.name })} items={items} />
    </li>
  );
}
