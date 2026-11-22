/** "Move to…": a picker of the places an item can go (paths as "Meetings / Kick-off"); it moves to the end. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button, Modal } from "@/ui/kit";
import { rootLabel, moveTargets } from "./treeModel";
import { Folder } from "lucide-react";
import { useMoveDocItem } from "@/blocks/projects/docMutations";
import { showToast } from "@/ui/Toast";
import { messageFor } from "@/blocks/projects/messages";
import { useT } from "@/i18n";
import type { DocRef, DocTree } from "../../domain/docs";

export interface MoveDialogProps {
  open: boolean;
  projectId: string;
  tree: DocTree;
  item: DocRef;
  onClose: () => void;
}

export function MoveDialog({ open, projectId, tree, item, onClose }: MoveDialogProps) {
  const t = useT();
  const { run } = useMoveDocItem();
  const targets = useMemo(() => (open ? moveTargets(tree, item) : []), [open, tree, item]);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = tree.byId.get(item.id)?.label ?? t("analysis.business.move.item", "item");

  useEffect(() => {
    if (open) { setTarget(null); setError(null); }
  }, [open]);

  const moving = useRef(false);
  const move = async () => {
    if (target === null || moving.current) return;
    moving.current = true;
    setBusy(true);
    setError(null);
    try {
      await run({ projectId, ref: item, folderId: target, beforeId: null });
      const dest = tree.byId.get(target)?.label;
      showToast(target === "" || !dest ? t("analysis.business.move.movedTop", "Moved to the top level.") : t("analysis.business.move.movedTo", "Moved to '{name}'.", { name: dest }));
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      moving.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("analysis.business.move.title", "Move '{name}'", { name: label })} width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("analysis.business.cancel", "Cancel")}</Button>
          <Button variant="secondary" disabled={target === null || busy} onClick={move}>{busy ? t("analysis.business.move.moving", "Moving…") : t("analysis.business.move.moveHere", "Move here")}</Button>
        </>
      }>
      {targets.length === 0 ? (
        <p className="text-[14px] text-ink2">{t("analysis.business.move.nowhere", "There is no other place this can go.")}</p>
      ) : (
        <ul role="listbox" aria-label={t("analysis.business.move.moveTo", "Move to")} className="flex flex-col gap-1">
          {targets.map((tg, i) => (
            <li key={tg.id || "root"} role="option" aria-selected={target === tg.id}>
              <button type="button" data-autofocus={i === 0 ? true : undefined} onClick={() => setTarget(tg.id)}
                className={`flex w-full items-center gap-3 rounded-block px-3 py-2.5 text-left text-[14px] outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent/50 ${target === tg.id ? "bg-accent-soft font-medium text-ink" : "text-ink2"}`}>
                <Folder size={16} strokeWidth={1.75} className="shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{tg.id === "" ? rootLabel() : tg.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <Banner tone="danger" title={error} className="mt-4" />}
    </Modal>
  );
}
