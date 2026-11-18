/** Discussion: a plain-text thread for the whole step, oldest first. */
import { useRef, useState } from "react";
import { MessagesSquare, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Modal, Textarea } from "@/madp/ui/kit";
import { useSanitizationDiscussion } from "@/madp/blocks/sanitization/hooks";
import { useAddComment, useDeleteComment } from "@/madp/blocks/sanitization/ops";
import { SANITIZATION_CAPS } from "@/madp/domain/sanitization";
import { LoadError, ReadOnlyNote, WriteNote, formatAt, type SectionProps } from "./shared";
import { startOnce } from "./CompleteSanitizationModal";
import { useT } from "@/madp/i18n";

/** Deletes one comment once however often the button fires; the dialog closes when the single call settles. */
export function deleteOnce(flag: { current: boolean }, remove: (settled: () => void) => void, close: () => void): boolean {
  return startOnce(flag, (done) => remove(() => { done(); close(); }));
}

export function DiscussionSection({ workspaceId, projectId, access, members }: SectionProps) {
  const t = useT();
  const ctx = { workspaceId, projectId };
  const d = useSanitizationDiscussion(ctx);
  const add = useAddComment(ctx);
  const del = useDeleteComment(ctx);
  const [text, setText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const delInFlight = useRef(false);
  const max = (SANITIZATION_CAPS as Record<string, number>).comment ?? 5000;

  if (d.isError) return <LoadError onRetry={d.refetch} />;
  const comments = [...d.comments].sort((a, b) => String(a.At).localeCompare(String(b.At)) || a.ItemId.localeCompare(b.ItemId));
  const target = comments.find((c) => c.ItemId === confirmId);

  const post = () => {
    if (text.trim() === "" || add.isPending) return;
    add.mutate({ projectId, text }, { onSuccess: () => setText("") });
  };

  return (
    <Card title={t("settings.sanitization.discussion.title", "Talk it through")} icon={<MessagesSquare size={18} strokeWidth={1.75} />}>
      <div className="flex flex-col gap-4">
        {!access.canComment && <ReadOnlyNote access={access} />}
        <WriteNote state={add.isPending || del.isPending ? "saving" : add.isError || del.isError ? "error" : add.isSuccess || del.isSuccess ? "saved" : "idle"}
          error={add.isError ? add.error : del.isError ? del.error : undefined}
          onRetry={add.isError ? post : undefined} />

        {comments.length === 0 && !d.isLoading ? (
          <EmptyState icon={<MessagesSquare size={20} strokeWidth={1.75} />} title={t("settings.sanitization.discussion.empty", "No discussion yet. Start it with a question or a note for the team.")} />
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.map((c) => (
              <li key={c.ItemId} className="rounded-block bg-surface2 p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink3">
                  <span className="font-medium text-ink">{members.nameOf(c.AuthorUserId)}</span>
                  <span>{formatAt(c.At)}</span>
                  {(c.AuthorUserId === access.userId || access.canManage) && (
                    <Button variant="danger" size="sm" className="ml-auto" icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />}
                      aria-label={t("settings.sanitization.discussion.deleteAria", "Delete comment by {name}", { name: members.nameOf(c.AuthorUserId) })} onClick={() => setConfirmId(c.ItemId)}>{t("settings.sanitization.discussion.delete", "Delete")}</Button>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-[14px]">{c.Text}</p>
              </li>
            ))}
          </ul>
        )}

        {access.canComment && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); post(); }}>
            <label htmlFor="disc-new" className="text-[12px] font-medium uppercase tracking-wider text-ink3">{t("settings.sanitization.discussion.addLabel", "Add to the discussion")}</label>
            <Textarea id="disc-new" value={text} maxLength={max} onChange={(e) => setText(e.target.value)} />
            <div className="flex items-center gap-2">
              <Button type="submit" variant="secondary" size="sm" disabled={text.trim() === "" || add.isPending}>{add.isPending ? t("settings.sanitization.discussion.posting", "Posting…") : t("settings.sanitization.discussion.post", "Post comment")}</Button>
            </div>
          </form>
        )}
      </div>

      <Modal open={target !== undefined} onClose={() => setConfirmId(null)} title={t("settings.sanitization.discussion.confirmTitle", "Delete this comment?")} width={460}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmId(null)}>{t("settings.sanitization.discussion.keep", "Keep it")}</Button>
          <Button variant="danger" disabled={del.isPending} aria-busy={del.isPending} onClick={() => target && deleteOnce(delInFlight, (settled) => del.mutate({ projectId, commentId: target.ItemId }, { onSettled: settled }), () => setConfirmId(null))}>{t("settings.sanitization.discussion.confirmDelete", "Delete comment")}</Button>
        </>}>
        <p className="text-[14px] text-ink2">{t("settings.sanitization.discussion.confirmText", "The comment will be removed from the discussion.")}</p>
      </Modal>
    </Card>
  );
}
