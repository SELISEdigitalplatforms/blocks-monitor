/** Pure model of the Business document tree: visible rows, keyboard, reorder, drop and delete summaries. No React, no DOM. */
import { canMove, type DocNode, type DocRef, type DocTree, type NoteLite } from "../../domain/docs";
import { t } from "@/madp/i18n";

/** The row id of the scratch pad (it exists in the tree from the start; its record is created on the first save). */
export const SCRATCH_ID = "scratch";

export interface TreeRow {
  id: string;
  kind: "scratch" | "folder" | "note" | "file";
  level: number;
  label: string;
  hasChildren: boolean;
  expanded: boolean;
  posInSet: number;
  setSize: number;
  parentId: string | null;
}

export const SCRATCH_LABEL = "Scratch pad";

/** The rows that are on screen: the pinned note (the Project brief) and the scratch pad first at level 1, then the
 *  other roots, descending into expanded folders. */
export function flattenVisible(tree: DocTree, expanded: ReadonlySet<string>, scratch: NoteLite | null, pinnedId?: string | null): TreeRow[] {
  const rows: TreeRow[] = [];
  const pinned = pinnedId ? tree.roots.find((n) => n.id === pinnedId && n.kind === "note") ?? null : null;
  const roots = pinned ? tree.roots.filter((n) => n !== pinned) : tree.roots;
  const lead = pinned ? 2 : 1;
  const total = roots.length + lead;
  if (pinned) {
    rows.push({
      id: pinned.id, kind: "note", level: 1, label: pinned.label,
      hasChildren: false, expanded: false, posInSet: 1, setSize: total, parentId: null,
    });
  }
  rows.push({
    id: SCRATCH_ID, kind: "scratch", level: 1, label: scratch?.title || t("analysis.business.scratchPad", "Scratch pad"),
    hasChildren: false, expanded: false, posInSet: lead, setSize: total, parentId: null,
  });
  const walk = (nodes: readonly DocNode[], level: number, parentId: string | null, offset: number, size: number) => {
    nodes.forEach((n, i) => {
      const isFolder = n.kind === "folder";
      const hasChildren = isFolder && n.children.length > 0;
      const open = hasChildren && expanded.has(n.id);
      rows.push({
        id: n.id, kind: n.kind, level, label: n.label, hasChildren, expanded: open,
        posInSet: i + 1 + offset, setSize: size, parentId,
      });
      if (open) walk(n.children, level + 1, n.id, 0, n.children.length);
    });
  };
  walk(roots, 1, null, lead, total);
  return rows;
}

export type TreeAction =
  | { type: "focus" | "expand" | "collapse" | "open" | "rename" | "delete" | "moveUp" | "moveDown"; id: string };

/** What a key does on the focused row, or null when it does nothing (the caller then leaves the key alone). */
export function treeKeyAction(rows: readonly TreeRow[], focusedId: string | null, key: string, mods: { alt?: boolean } = {}): TreeAction | null {
  if (!rows.length) return null;
  const at = rows.findIndex((r) => r.id === focusedId);
  const row = at >= 0 ? rows[at] : null;
  const navKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
  if (!row) return navKeys.includes(key) ? { type: "focus", id: rows[key === "End" ? rows.length - 1 : 0].id } : null;
  const fixed = row.kind === "scratch";
  switch (key) {
    case "ArrowUp":
      if (mods.alt) return fixed ? null : { type: "moveUp", id: row.id };
      return at > 0 ? { type: "focus", id: rows[at - 1].id } : null;
    case "ArrowDown":
      if (mods.alt) return fixed ? null : { type: "moveDown", id: row.id };
      return at < rows.length - 1 ? { type: "focus", id: rows[at + 1].id } : null;
    case "ArrowRight":
      if (!row.hasChildren) return null;
      if (!row.expanded) return { type: "expand", id: row.id };
      return { type: "focus", id: rows[at + 1].id };
    case "ArrowLeft":
      if (row.hasChildren && row.expanded) return { type: "collapse", id: row.id };
      return row.parentId && rows.some((r) => r.id === row.parentId) ? { type: "focus", id: row.parentId } : null;
    case "Home": return { type: "focus", id: rows[0].id };
    case "End": return { type: "focus", id: rows[rows.length - 1].id };
    case "Enter": return { type: "open", id: row.id };
    case "F2": return fixed ? null : { type: "rename", id: row.id };
    case "Delete": return fixed ? null : { type: "delete", id: row.id };
    default: return null;
  }
}

const isFolder = (n: DocNode) => n.kind === "folder";

/** Folders are ordered among folders; notes and files share one order after them. */
function group(tree: DocTree, node: DocNode): DocNode[] {
  return tree.siblings(node.folderId).filter((s) => isFolder(s) === isFolder(node));
}

function nodeOf(tree: DocTree, ref: DocRef): DocNode | undefined {
  const n = tree.byId.get(ref.id);
  return n && n.kind === ref.kind ? n : undefined;
}

/** Where a move up / down puts the item: the same folder, before this sibling (null = the end). Null at an edge. */
export function reorderTarget(tree: DocTree, ref: DocRef, dir: "up" | "down"): { folderId: string; beforeId: string | null } | null {
  if (ref.id === SCRATCH_ID) return null;
  const node = nodeOf(tree, ref);
  if (!node) return null;
  const sibs = group(tree, node);
  const i = sibs.findIndex((s) => s.id === node.id);
  if (i < 0) return null;
  if (dir === "up") return i === 0 ? null : { folderId: node.folderId, beforeId: sibs[i - 1].id };
  if (i >= sibs.length - 1) return null;
  return { folderId: node.folderId, beforeId: sibs[i + 2]?.id ?? null };
}

export type DropDecision = { ok: true; folderId: string; beforeId: string | null } | { ok: false; messageKey: string };

export function dropDecision(
  tree: DocTree,
  dragged: DocRef,
  over: { id: string; position: "before" | "inside" | "after" },
): DropDecision {
  const scratchId = tree.scratch?.id;
  if (dragged.id === SCRATCH_ID || dragged.id === scratchId || over.id === SCRATCH_ID || over.id === scratchId) {
    return { ok: false, messageKey: "doc.scratchFixed" };
  }
  if (over.id === dragged.id) return { ok: false, messageKey: "doc.dropSelf" };
  const target = tree.byId.get(over.id);
  if (!target) return { ok: false, messageKey: "doc.notFound" };
  const dragIsFolder = dragged.kind === "folder";

  let folderId: string;
  let beforeId: string | null;
  if (over.position === "inside" && isFolder(target)) {
    folderId = target.id;
    beforeId = null;
  } else if (isFolder(target) !== dragIsFolder) {
    // a note beside a folder goes to the start of the notes of that level; a folder beside a note, to the end of the folders
    folderId = target.folderId;
    const rest = tree.siblings(folderId).filter((s) => isFolder(s) === false && s.id !== dragged.id);
    beforeId = dragIsFolder ? null : rest[0]?.id ?? null;
  } else {
    folderId = target.folderId;
    const sibs = tree.siblings(folderId).filter((s) => isFolder(s) === isFolder(target));
    if (over.position === "before") beforeId = target.id;
    else {
      const i = sibs.findIndex((s) => s.id === target.id);
      beforeId = sibs[i + 1]?.id ?? null;
    }
    if (beforeId === dragged.id) beforeId = sibs[sibs.findIndex((s) => s.id === dragged.id) + 1]?.id ?? null;
  }
  const check = canMove(tree, dragged, folderId);
  if (!check.ok) return { ok: false, messageKey: check.messageKey };
  return { ok: true, folderId, beforeId };
}

export interface MoveTarget { id: string; label: string }

/** The path of a folder as "Meetings / Kick-off" (the root is ""). */
export function folderPath(tree: DocTree, folderId: string): string {
  const parts: string[] = [];
  let id = folderId;
  for (let guard = 0; id && guard < 32; guard++) {
    const n = tree.byId.get(id);
    if (!n) break;
    parts.unshift(n.label);
    id = n.folderId;
  }
  return parts.join(" / ");
}

/** "Top level", in the current language (read at render time). */
export const rootLabel = (): string => t("analysis.business.tree.topLevel", "Top level");

/** The places an item can go: the root and every folder canMove allows, each with its path. */
export function moveTargets(tree: DocTree, ref: DocRef): MoveTarget[] {
  const out: MoveTarget[] = [];
  if (canMove(tree, ref, "").ok) out.push({ id: "", label: rootLabel() });
  const walk = (nodes: readonly DocNode[]) => {
    for (const n of nodes) {
      if (!isFolder(n)) continue;
      if (canMove(tree, ref, n.id).ok) out.push({ id: n.id, label: folderPath(tree, n.id) });
      walk(n.children);
    }
  };
  walk(tree.roots);
  return out;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function countBelow(node: DocNode, c = { folders: 0, notes: 0, files: 0 }) {
  for (const ch of node.children) {
    if (ch.kind === "folder") { c.folders++; countBelow(ch, c); }
    else if (ch.kind === "note") c.notes++;
    else if (ch.file?.status === "ready") c.files++;
  }
  return c;
}

/** The confirmation text for a delete, naming what goes. */
export function deleteSummary(tree: DocTree, ref: DocRef): { title: string; message: string } {
  const node = nodeOf(tree, ref);
  const name = node?.label ?? t("analysis.business.tree.thisItem", "this item");
  const plain = t("analysis.business.tree.deleteMessage", "Delete '{name}'? This can't be undone.", { name });
  if (ref.kind !== "folder" || !node) {
    return { title: ref.kind === "note" ? t("analysis.business.tree.deleteNote", "Delete note") : t("analysis.business.tree.deleteFile", "Delete file"), message: plain };
  }
  const c = countBelow(node);
  const parts: string[] = [];
  if (c.folders) parts.push(plural(c.folders, t("analysis.business.tree.folderOne", "folder"), t("analysis.business.tree.folderMany", "folders")));
  if (c.notes) parts.push(plural(c.notes, t("analysis.business.tree.noteOne", "note"), t("analysis.business.tree.noteMany", "notes")));
  if (c.files) parts.push(plural(c.files, t("analysis.business.tree.fileOne", "file"), t("analysis.business.tree.fileMany", "files")));
  const list = parts.length > 1 ? t("analysis.business.tree.listAnd", "{first} and {last}", { first: parts.slice(0, -1).join(", "), last: parts[parts.length - 1]! }) : parts[0];
  return {
    title: t("analysis.business.tree.deleteFolder", "Delete folder"),
    message: list ? t("analysis.business.tree.deleteFolderMessage", "Delete '{name}' with {list}? This can't be undone.", { name, list }) : plain,
  };
}

/** The plain sentence for a refused move or drop. */
export function dropMessage(messageKey: string): string {
  switch (messageKey) {
    case "doc.cycle": return t("analysis.business.tree.dropCycle", "A folder can't move into itself or one of its subfolders.");
    case "doc.tooDeep": return t("analysis.business.tree.dropTooDeep", "Folders can be nested at most 6 levels deep.");
    case "doc.scratchFixed": return t("analysis.business.tree.dropScratchFixed", "The scratch pad stays at the top and can't be moved or deleted.");
    case "doc.dropSelf": return t("analysis.business.tree.dropSelf", "Drop it on another item.");
    case "doc.notFound": return t("analysis.business.tree.dropNotFound", "This item no longer exists.");
    default: return t("analysis.business.tree.dropElse", "That item can't go there.");
  }
}

/** The plain sentence for a failed name / title check (src/domain/docs). */
export function checkMessage(c: { messageKey: string; params?: Record<string, unknown> }): string {
  if (c.messageKey === "doc.nameRequired") return t("analysis.business.tree.nameRequired", "Enter a name.");
  if (c.messageKey === "doc.nameTooLong") return t("analysis.business.tree.nameTooLong", "Names can be at most {max} characters.", { max: String(c.params?.max ?? "") });
  return t("analysis.business.tree.nameInvalid", "That name can't be used.");
}
