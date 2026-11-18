import { useEffect, useState } from "react";
import { Button, Label, Modal, Textarea } from "@/madp/ui/kit";
import { LIMITS } from "@/madp/domain/delivery";
import { useT } from "@/madp/i18n";
import { canSubmitRejection } from "./approvalsUi";

/** Asks for the comment a rejection ("request changes") requires. */
export function RejectDialog({ open, stepName, busy, error, onConfirm, onClose, title, question, confirmLabel }: {
  open: boolean;
  stepName: string;
  /** additive: the window's title (default "Request changes · <step> approval"). */
  title?: string;
  /** additive: the question over the comment (default "What has to change?"). */
  question?: string;
  /** additive: the confirm button (default "Request changes"). */
  confirmLabel?: string;
  busy?: boolean;
  /** A failed rejection, shown in the dialog: the card behind the scrim is out of sight. */
  error?: string | null;
  onConfirm: (comment: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [comment, setComment] = useState("");
  useEffect(() => { if (!open) setComment(""); }, [open]);
  const fieldId = "reject-comment";
  return (
    <Modal open={open} onClose={onClose} title={title ?? t("platform.approvals.reject.title", "Request changes · {step} approval", { step: stepName })} width={480}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("platform.approvals.reject.cancel", "Cancel")}</Button>
        <Button variant="secondary" disabled={!canSubmitRejection(comment) || busy} onClick={() => onConfirm(comment.trim())}>{confirmLabel ?? t("platform.approvals.reject.confirm", "Request changes")}</Button>
      </>}>
      <label htmlFor={fieldId}><Label>{question ?? t("platform.approvals.reject.question", "What has to change?")}</Label></label>
      <Textarea id={fieldId} value={comment} maxLength={LIMITS.approvalComment} aria-required="true" aria-describedby={`${fieldId}-count`}
        onChange={(e) => setComment(e.target.value)} />
      <div id={`${fieldId}-count`} className="mt-1 text-right text-[12px] text-ink3">{comment.length} / {LIMITS.approvalComment}</div>
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
    </Modal>
  );
}
