/** Your part in the Build step: feedback on a milestone's preview (a window to write it, the list of what you asked for
 *  and how far the team is with it) and the acceptance of the milestone (a short confirmation). Feedback becomes a fix
 *  ticket of the milestone (milestone.feedback); acceptance signs the milestone off (milestone.accept). */
import { useEffect, useState } from "react";
import { Check, CircleDashed, LoaderCircle, MessageSquarePlus } from "lucide-react";
import type { DeliveryMilestone, DeliveryTicket } from "@/madp/blocks/delivery/types";
import { Button, Label, Modal, Textarea } from "@/madp/ui/kit";
import { LIMITS } from "@/madp/domain/delivery";
import { byNewestNumber } from "@/madp/lib/newest";
import { useTalkAttachments } from "@/madp/blocks/collab/talkUpload";
import { AttachButton, AttachChipList, AttachZone, SentFiles, attachHold, useAttachDraft } from "@/madp/components/feedback/AttachFiles";
import { t, useT } from "@/madp/i18n";

/** The milestone's feedback tickets, newest first (a ticket's number is its creation order). */
export function feedbackOf(tickets: readonly DeliveryTicket[], milestoneId: string): DeliveryTicket[] {
  return byNewestNumber(tickets.filter((t) => t.milestoneId === milestoneId && t.source === "feedback"), (t) => t.number);
}

/** Open and all feedback of a milestone (the Build step's Feedback chip). */
export function feedbackCount(tickets: readonly DeliveryTicket[], milestoneId: string): { open: number; total: number } {
  const all = feedbackOf(tickets, milestoneId);
  return { open: all.filter((t) => t.column !== "done").length, total: all.length };
}

const STATE = (tk: DeliveryTicket) =>
  tk.column === "done" ? { icon: <Check size={13} strokeWidth={3} aria-hidden />, text: t("build.queue.status.done", "Done"), cls: "bg-success text-white dark:text-canvas" }
    : tk.column === "planned" ? { icon: <CircleDashed size={13} aria-hidden />, text: t("build.review.waitingTeam", "Waiting for the team"), cls: "bg-surface2 text-ink3" }
      : { icon: <LoaderCircle size={13} aria-hidden className="animate-spin motion-reduce:animate-none" />, text: t("build.review.onIt", "The team is on it"), cls: "bg-accent-soft text-[rgb(var(--c-accent-text))]" };

/** `projectId`: show the files sent with each feedback (screenshots, designs). */
export function FeedbackList({ items, projectId }: { items: readonly DeliveryTicket[]; projectId?: string }) {
  const files = useTalkAttachments(projectId ?? null, "ticket", projectId ? items.map((t) => t.id) : []).data;
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className="mt-1">
      <Label>{t("build.review.yourFeedback", "Your feedback")}</Label>
      <ul className="flex flex-col gap-2">
        {items.map((tk) => {
          const s = STATE(tk);
          return (
            <li key={tk.id} className="flex min-w-0 items-start gap-2.5 rounded-block bg-surface2 px-3 py-2.5">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${s.cls}`}>{s.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[14px] text-ink">{tk.description || tk.title}</p>
                {projectId && <SentFiles projectId={projectId} files={files?.get(tk.id)} />}
                <p className="mt-0.5 text-[12px] text-ink3">{s.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FeedbackDialog({ open, projectId, milestone, pending, error, onClose, onSend }: {
  open: boolean;
  projectId: string;
  milestone: DeliveryMilestone | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  /** Resolves true once the feedback is sent; `files`: the screenshots or designs sent with it. */
  onSend: (text: string, files?: { attachmentIds: string[]; draftKey: string }) => Promise<boolean>;
}) {
  const t = useT();
  const [text, setText] = useState("");
  // pictures, PDFs or documents that show what should change: they go onto the fix ticket the development team builds
  const files = useAttachDraft({ projectId, owner: { ownerType: "ticket", forId: milestone?.id ?? null }, disabled: pending });
  useEffect(() => { if (open) { setText(""); files.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const hold = attachHold(files);
  const ok = text.trim().length >= 3 && text.length <= LIMITS.comment && !hold;
  const send = () => {
    if (!ok || pending) return;
    const sent = files.ids.length ? { attachmentIds: files.ids, draftKey: files.draftKey } : undefined;
    void onSend(text.trim(), sent).then((done) => { if (done) { files.reset(); onClose(); } });
  };
  return (
    <Modal open={open} onClose={onClose} title={milestone ? t("build.review.feedbackTitle", "Feedback on milestone {number}", { number: milestone.number }) : t("build.step.chip.feedback", "Feedback")}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={pending}>{t("changes.checks.card.cancel", "Cancel")}</Button>
        <Button variant="primary" onClick={send} disabled={!ok || pending} icon={<MessageSquarePlus size={16} strokeWidth={1.75} aria-hidden />}>
          {pending ? t("changes.page.primary.sending", "Sending…") : t("build.review.send", "Send to the team")}
        </Button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex flex-col gap-3" aria-label={t("build.review.formLabel", "Feedback on the preview")}>
        <p className="text-[14px] text-ink2">
          {milestone ? t("build.review.introNamed", "What should change in “{name}”? Describe it the way you would to a colleague. The development team works it in and puts a new preview online.", { name: milestone.name })
            : t("build.review.intro", "What should change in the preview? Describe it the way you would to a colleague. The development team works it in and puts a new preview online.")}
        </p>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Label>{t("build.review.what", "What should change?")}</Label>
          </div>
          <AttachZone draft={files}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={LIMITS.comment}
              aria-label={t("build.review.what", "What should change?")} placeholder={t("build.review.placeholder", "For example: on the phone the main button is hard to reach. Please move it to the bottom.")} />
          </AttachZone>
          <AttachChipList draft={files} disabled={pending} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <AttachButton draft={files} disabled={pending} label={t("build.review.attach", "Attach a screenshot or file")} />
            <span className="text-[12px] text-ink3">{hold || t("build.review.attachHint", "Add a screenshot, a design or a document if it helps. You can also drop or paste it.")}</span>
          </div>
        </div>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </form>
    </Modal>
  );
}

export function AcceptDialog({ open, milestone, version, last, pending, error, onClose, onAccept }: {
  open: boolean;
  milestone: DeliveryMilestone | null;
  version: string | null;
  /** The last milestone: accepting it releases the app to the development environment. */
  last: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onAccept: () => void;
}) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={milestone ? t("build.review.acceptTitle", "Accept milestone {number}?", { number: milestone.number }) : t("build.review.acceptTitleAny", "Accept the milestone?")}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={pending}>{t("build.review.notYet", "Not yet")}</Button>
        <Button variant="primary" onClick={onAccept} disabled={pending} icon={<Check size={16} strokeWidth={2} aria-hidden />}>
          {pending ? t("build.page.accepting", "Accepting…") : t("build.page.accept", "Accept")}
        </Button>
      </>}>
      <div className="flex flex-col gap-2 text-[14px] text-ink2">
        <p>
          {milestone
            ? (version ? t("build.review.triedNamedVersion", "You tried “{name}” (version {version}) and it does what was agreed.", { name: milestone.name, version }) : t("build.review.triedNamed", "You tried “{name}” and it does what was agreed.", { name: milestone.name }))
            : (version ? t("build.review.triedVersion", "You tried the preview (version {version}) and it does what was agreed.", { version }) : t("build.review.tried", "You tried the preview and it does what was agreed."))}
        </p>
        <p>{last
          ? t("build.review.last", "This is the last milestone: once you accept it, the team releases the app to the development environment and the Release step opens.")
          : t("build.review.final", "Once accepted, the milestone is final. Later changes go through a change request.")}</p>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
