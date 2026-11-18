/** The accessible Business document tree: keyboard, menus, drag and drop, dialogs. Logic lives in treeModel.ts. */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, CirclePlus, FilePlus2, FolderPlus, Pin } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { Banner, Button, Chip } from "@/madp/ui/kit";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { useDeleteFolder, useMoveDocItem } from "@/madp/blocks/projects/docMutations";
import type { DocTreeData } from "@/madp/blocks/projects/docReads";
import { messageFor } from "@/madp/blocks/projects/messages";
import { canCreateFolder, isNewSinceHandOver, type DocItemKind, type DocNode, type DocRef } from "../../domain/docs";
import { fileIconFor, folderKindIcon, NOTE_ICON, SCRATCH_ICON } from "./icons";
import {
  SCRATCH_ID, dropDecision, dropMessage, flattenVisible, reorderTarget, treeKeyAction, type TreeRow,
} from "./treeModel";
import { TreeItemMenu, type TreeMenuAction } from "./TreeItemMenu";
import { NewFolderDialog } from "./NewFolderDialog";
import { RenameDialog } from "./RenameDialog";
import { MoveDialog } from "./MoveDialog";
import { DeleteDialog, progressText } from "./DeleteDialog";
import { useT } from "@/madp/i18n";

export interface DocTreeProps {
  projectId: string;
  data: DocTreeData;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: ReadonlySet<string>;
  onToggle: (folderId: string, open: boolean) => void;
  onNewNote: (folderId: string) => void;
  canEdit: boolean;
  editReason: string | null;
  handedOverAt: string | null;
  /** The New folder / New note buttons above the tree (the page can show its own instead). */
  toolbar?: boolean;
  /** A top-level note shown first with a pin (the Project brief). */
  pinnedId?: string | null;
  className?: string;
  /** An item was deleted from its menu (the page lets go of it when it was the one open). */
  onDeleted?: (item: DocRef) => void;
}

type Dialog = { type: "rename" | "move" | "delete"; ref: DocRef } | null;
type DropState = { id: string; position: "before" | "inside" | "after"; ok: boolean } | null;

function usePointerFine(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(pointer: fine)");
    setFine(mq.matches);
    const on = (e: MediaQueryListEvent) => setFine(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return fine;
}

const DROP_STYLE = {
  before: "border-t-accent",
  after: "border-b-accent",
  inside: "bg-accent-soft border-accent/40",
} as const;

/** A folder whose delete was interrupted: "Deleting 'X'…" with Finish deleting. */
export function DeletingRow({ projectId, folderId, name, canEdit }: { projectId: string; folderId: string; name: string; canEdit: boolean }) {
  const t = useT();
  const del = useDeleteFolder();
  const progress = progressText(del.remaining);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-block bg-surface2 px-3 py-2.5 text-[14px] text-ink2">
      <span className="min-w-0 flex-1 break-words">{t("analysis.business.tree.deletingName", "Deleting '{name}'…", { name })}{progress ? <span role="status" aria-live="polite" className="ml-2 text-[12px] text-ink3">{progress}</span> : null}</span>
      {canEdit && (
        <Button size="sm" variant="secondary" disabled={del.isRunning} onClick={() => { void del.run({ projectId, folderId }).catch(() => undefined); }}>
          {del.isRunning ? t("analysis.business.delete.deleting", "Deleting…") : t("analysis.business.delete.finish", "Finish deleting")}
        </Button>
      )}
      {del.error ? <span role="alert" className="basis-full text-[12px] text-danger">{messageFor(del.error)}</span> : null}
    </li>
  );
}

export function DocTree({ projectId, data, selectedId, onSelect, expanded, onToggle, onNewNote, canEdit, editReason, handedOverAt, toolbar = true, pinnedId = null, className, onDeleted }: DocTreeProps) {
  const t = useT();
  const { tree, scratch } = data;
  const move = useMoveDocItem();
  const fine = usePointerFine();
  const rows = useMemo(() => flattenVisible(tree, expanded, scratch, pinnedId), [tree, expanded, scratch, pinnedId]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newFolderAt, setNewFolderAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<DocRef | null>(null);
  const [drop, setDrop] = useState<DropState>(null);
  const refs = useRef(new Map<string, HTMLElement>());

  const selectedRowId = selectedId && scratch && selectedId === scratch.id ? SCRATCH_ID : selectedId;
  // roving tabindex: the focused row, else the selected one, else the first
  const tabId = rows.some((r) => r.id === focusId) ? focusId : rows.some((r) => r.id === selectedRowId) ? selectedRowId : rows[0]?.id ?? null;

  const refOf = useCallback((id: string): DocRef | null => {
    const n = tree.byId.get(id);
    return n ? { kind: n.kind, id: n.id } : null;
  }, [tree]);

  const focusRow = (id: string) => { setFocusId(id); refs.current.get(id)?.focus(); };
  const fail = (e: unknown) => setError(messageFor(e));
  const reason = canEdit ? null : editReason;

  const doMove = async (ref: DocRef, target: { folderId: string; beforeId: string | null }) => {
    setError(null);
    try {
      await move.run({ projectId, ref, folderId: target.folderId, beforeId: target.beforeId });
    } catch (e) {
      fail(e);
    }
  };

  const reorder = (id: string, dir: "up" | "down") => {
    const ref = refOf(id);
    const to = ref && reorderTarget(tree, ref, dir);
    if (ref && to) void doMove(ref, to);
  };

  const act = (id: string, action: TreeMenuAction) => {
    const ref = refOf(id);
    if (action === "open" || id === SCRATCH_ID) { onSelect(id); return; }
    if (!ref || !canEdit) return;
    if (action === "rename" || action === "move" || action === "delete") setDialog({ type: action, ref });
    else reorder(id, action === "moveUp" ? "up" : "down");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, row: TreeRow) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) { e.preventDefault(); setMenuFor(row.id); return; }
    const a = treeKeyAction(rows, row.id, e.key, { alt: e.altKey });
    if (!a) return;
    e.preventDefault();
    switch (a.type) {
      case "focus": focusRow(a.id); break;
      case "expand": onToggle(a.id, true); break;
      case "collapse": onToggle(a.id, false); break;
      case "open": onSelect(a.id); break;
      case "rename": act(a.id, "rename"); break;
      case "delete": act(a.id, "delete"); break;
      case "moveUp": act(a.id, "moveUp"); break;
      case "moveDown": act(a.id, "moveDown"); break;
    }
  };

  const positionOf = (e: DragEvent<HTMLElement>, isFolder: boolean): "before" | "inside" | "after" => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5;
    if (isFolder) return y < 1 / 3 ? "before" : y > 2 / 3 ? "after" : "inside";
    return y < 0.5 ? "before" : "after";
  };

  const onDragOver = (e: DragEvent<HTMLElement>, row: TreeRow) => {
    if (!dragged) return;
    if (row.kind === "scratch") { e.dataTransfer.dropEffect = "none"; setDrop({ id: row.id, position: "after", ok: false }); return; }
    const position = positionOf(e, row.kind === "folder");
    const d = dropDecision(tree, dragged, { id: row.id, position });
    if (!d.ok) { e.dataTransfer.dropEffect = "none"; setDrop({ id: row.id, position, ok: false }); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDrop({ id: row.id, position, ok: true });
  };

  const onDrop = (e: DragEvent<HTMLElement>, row: TreeRow) => {
    e.preventDefault();
    const ref = dragged;
    setDragged(null);
    setDrop(null);
    if (!ref || row.kind === "scratch") return;
    const d = dropDecision(tree, ref, { id: row.id, position: positionOf(e, row.kind === "folder") });
    if (!d.ok) { setError(dropMessage(d.messageKey)); return; }
    void doMove(ref, { folderId: d.folderId, beforeId: d.beforeId });
  };

  const selectedNode = selectedId ? tree.byId.get(selectedId) : undefined;
  const folderAtSelection = selectedNode?.kind === "folder" ? selectedNode.id : "";
  const openNewFolder = () => {
    const ok = canCreateFolder(tree, folderAtSelection);
    if (!ok.ok) { setError(dropMessage(ok.messageKey)); return; }
    setError(null);
    setNewFolderAt(folderAtSelection);
  };

  const dialogNode: DocNode | undefined = dialog ? tree.byId.get(dialog.ref.id) : undefined;

  return (
    <div className={cn("rounded-card bg-surface p-4 shadow-card dark:ring-1 dark:ring-line", className)}>
      {toolbar && <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!canEdit} title={reason ?? undefined} aria-describedby={reason ? "doc-tree-reason" : undefined}
          icon={<FolderPlus size={16} strokeWidth={1.75} aria-hidden />} onClick={openNewFolder}>{t("analysis.business.folder.new", "New folder")}</Button>
        <Button size="sm" variant="secondary" disabled={!canEdit} title={reason ?? undefined} aria-describedby={reason ? "doc-tree-reason" : undefined}
          aria-label={folderAtSelection ? t("analysis.business.tree.newNoteIn", "New note in {name}", { name: selectedNode?.label ?? t("analysis.business.tree.folder", "folder") }) : t("analysis.business.tree.newNoteTop", "New note at the top level")}
          icon={<FilePlus2 size={16} strokeWidth={1.75} aria-hidden />} onClick={() => onNewNote(folderAtSelection)}>{t("analysis.business.tree.newNote", "New note")}</Button>
      </div>}
      {reason && toolbar && <ViewOnlyNote id="doc-tree-reason" text={reason} className="mb-3" />}
      {error && (
        <Banner tone="danger" title={error} className="mb-3"
          action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>{t("analysis.business.dismiss", "Dismiss")}</Button>} />
      )}
      <ul role="tree" aria-label={t("analysis.business.tree.material", "Project material")} className="flex flex-col gap-0.5">
        {rows.map((row) => {
          const node = tree.byId.get(row.id);
          const scratchRow = row.kind === "scratch";
          const pinnedRow = row.id === pinnedId;
          const Icon = pinnedRow ? Pin : scratchRow ? SCRATCH_ICON
            : node?.kind === "folder" ? folderKindIcon(node.folder?.kind ?? "other")
            : node?.kind === "file" ? fileIconFor({ name: node.label, mime: node.file?.mime ?? "" })
            : NOTE_ICON;
          const selected = row.id === selectedRowId;
          const isNew = Boolean(handedOverAt && node && isNewSinceHandOver(node.createdDate, handedOverAt));
          const dropHere = drop?.id === row.id ? drop : null;
          const group = node ? tree.siblings(node.folderId).filter((s) => (s.kind === "folder") === (node.kind === "folder")) : [];
          const at = group.findIndex((s) => s.id === row.id);
          const canDrag = fine && canEdit && !scratchRow;
          return (
            <li key={row.id} role="none">
              <div
                ref={(el) => { if (el) refs.current.set(row.id, el); else refs.current.delete(row.id); }}
                role="treeitem" aria-level={row.level} aria-posinset={row.posInSet} aria-setsize={row.setSize}
                aria-expanded={row.kind === "folder" ? row.expanded : undefined} aria-selected={selected}
                tabIndex={row.id === tabId ? 0 : -1}
                draggable={canDrag || undefined}
                onFocus={(e) => { if (e.target === e.currentTarget) setFocusId(row.id); }}
                onClick={() => { setFocusId(row.id); onSelect(row.id); }}
                onKeyDown={(e) => onKeyDown(e, row)}
                onDragStart={(e) => {
                  const ref = refOf(row.id);
                  if (!canDrag || !ref) { e.preventDefault(); return; }
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", row.id);
                  setDragged(ref);
                }}
                onDragOver={fine ? (e) => onDragOver(e, row) : undefined}
                onDragLeave={fine ? () => setDrop((d) => (d?.id === row.id ? null : d)) : undefined}
                onDrop={fine ? (e) => onDrop(e, row) : undefined}
                onDragEnd={() => { setDragged(null); setDrop(null); }}
                style={{ paddingLeft: 8 + (row.level - 1) * 16 }}
                className={cn(
                  "group flex cursor-pointer items-start gap-2 rounded-block border-2 border-transparent py-1.5 pr-1 text-[14px] outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
                  selected ? "bg-accent-soft text-ink" : "text-ink2 hover:bg-surface2 hover:text-ink",
                  dragged?.id === row.id && "opacity-50",
                  dropHere && (dropHere.ok ? DROP_STYLE[dropHere.position] : "cursor-not-allowed opacity-60"),
                )}
                data-drop={dropHere ? (dropHere.ok ? dropHere.position : "none") : undefined}
              >
                {row.kind === "folder" ? (
                  <button type="button" tabIndex={-1} disabled={!row.hasChildren} aria-hidden
                    onClick={(e) => { e.stopPropagation(); onToggle(row.id, !row.expanded); }}
                    className="grid h-6 w-5 shrink-0 place-items-center text-ink3 disabled:opacity-0">
                    {row.expanded ? <ChevronDown size={16} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.75} aria-hidden />}
                  </button>
                ) : <span className="w-5 shrink-0" aria-hidden />}
                <Icon size={18} strokeWidth={1.75} className={cn("mt-0.5 shrink-0", pinnedRow && "text-[rgb(var(--c-accent-text))]")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("min-w-0 break-words leading-6", pinnedRow && "font-medium text-ink")}>{row.label}</span>
                    {pinnedRow && <span className="sr-only"> {t("analysis.business.tree.pinned", "(pinned)")}</span>}
                    {node?.kind === "folder" && node.children.length > 0 && (
                      <span className="num shrink-0 text-[12px] text-ink3" aria-label={node.children.length === 1 ? t("analysis.business.tree.oneItem", "1 item") : t("analysis.business.tree.items", "{count} items", { count: node.children.length })}>{node.children.length}</span>
                    )}
                  </span>
                  {isNew && <Chip tone="accent" icon={<CirclePlus size={12} strokeWidth={1.75} aria-hidden />} className="mt-0.5">{t("analysis.business.tree.newSince", "New since hand-over")}</Chip>}
                </span>
                <TreeItemMenu label={row.label} open={menuFor === row.id} onOpenChange={(o) => setMenuFor(o ? row.id : null)}
                  onAction={(a) => act(row.id, a)} canEdit={canEdit} editReason={editReason} scratch={scratchRow}
                  canMoveUp={at > 0} canMoveDown={at >= 0 && at < group.length - 1} />
              </div>
            </li>
          );
        })}
      </ul>
      {data.deletingFolders.length > 0 && (
        <ul aria-label={t("analysis.business.tree.beingDeleted", "Folders being deleted")} className="mt-3 flex flex-col gap-2">
          {data.deletingFolders.map((f) => <DeletingRow key={f.id} projectId={projectId} folderId={f.id} name={f.name} canEdit={canEdit} />)}
        </ul>
      )}

      <NewFolderDialog open={newFolderAt !== null} projectId={projectId} parentId={newFolderAt ?? ""} onClose={() => setNewFolderAt(null)}
        onCreated={(id) => { if (newFolderAt) onToggle(newFolderAt, true); onSelect(id); }} />
      {dialog?.type === "rename" && dialogNode && (
        <RenameDialog open projectId={projectId} kind={dialog.ref.kind as DocItemKind} id={dialog.ref.id} name={dialogNode.label}
          folderKind={dialogNode.folder?.kind} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "move" && dialogNode && (
        <MoveDialog open projectId={projectId} tree={tree} item={dialog.ref} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "delete" && dialogNode && (
        <DeleteDialog open projectId={projectId} tree={tree} item={dialog.ref} onClose={() => setDialog(null)} onDeleted={onDeleted} />
      )}
    </div>
  );
}
