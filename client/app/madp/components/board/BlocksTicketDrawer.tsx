import { useEffect, useMemo, useState } from "react";
import { CircleCheck, FileQuestion } from "lucide-react";
import { initialsOf } from "@/madp/data/feedback";
import { cn } from "@/madp/lib/cn";
import { byNewest } from "@/madp/lib/newest";
import { fmtWhen } from "@/madp/components/intake/IntakeShared";
import type { DeliveryContext } from "@/madp/blocks/delivery/context";
import { useTicketEvents } from "@/madp/blocks/delivery/hooks";
import { useTicketComment, useTicketMove } from "@/madp/blocks/delivery/actions";
import type { DeliveryTicket, DeliveryTicketEvent } from "@/madp/blocks/delivery/types";
import { Avatar, Button, Chip, Drawer, EmptyState, Select, Textarea } from "@/madp/ui/kit";
import { LIMITS, TICKET_COLUMNS } from "../../domain/delivery";
import { agentInitialsOf, agentName, ticketCode, typeLabel } from "./blocksBoard";
import { useT } from "@/madp/i18n";
import { estimateTicket } from "@/madp/domain/engineEstimate";
import { useEstimates } from "@/madp/components/build/EstimatesContext";
import { ticketEstimateChip, ticketEstimateTitle } from "@/madp/components/build/estimateText";
import { EvidenceCards } from "./EvidenceCards";
import { TicketHistory, columnName } from "./TicketHistory";

const H = "text-[13px] font-medium text-ink2";

/** The ticket drawer of a Blocks project: the stored ticket, its real TicketEvent history (moves, agents' remarks,
 *  recorded evidence, comments), a comment box and "Move to" for the roles that may use them. */
export function BlocksTicketDrawer({ ctx, ticket, featureName, milestoneName, onClose }: {
  ctx: DeliveryContext; ticket: DeliveryTicket | null; featureName: (ref: string) => string;
  milestoneName?: (id: string | null) => string; onClose: () => void;
}) {
  const t = useT();
  const events = useTicketEvents(ctx, ticket?.id ?? null);
  const comment = useTicketComment(ctx);
  const move = useTicketMove(ctx);
  const [text, setText] = useState("");
  const [to, setTo] = useState("");
  const ticketId = ticket?.id ?? null;
  useEffect(() => { setText(""); setTo(""); comment.reset(); move.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ticketId]);

  const mayComment = ctx.can("comment");
  const mayMove = ctx.can("board.edit");
  const send = async () => {
    if (!ticket || !mayComment || comment.pending || !text.trim()) return;
    if (await comment.run({ ticketId: ticket.id, text: text.trim() })) setText("");
  };
  const doMove = async () => { if (to && (await move.run({ ticketId: ticket!.id, fromColumn: ticket!.column, toColumn: to as DeliveryTicket["column"] }))) setTo(""); };
  const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : t("build.board.actionFailed", "The action could not be completed. Try again."));
  const authorOf = (e: DeliveryTicketEvent) => (e.isAuto || !e.authorUserId ? agentName(e.authorLabel ?? "") : ctx.memberName(e.authorUserId));

  const { moves, remarks, evidence, comments } = useMemo(() => {
    // newest first: the latest move, remark, evidence and comment on top
    const all = byNewest(events.data, (e) => e.at);
    return {
      moves: all.filter((e) => e.kind === "move"),
      remarks: all.filter((e) => e.kind === "note" || (e.kind === "comment" && (e.isAuto || !e.authorUserId))),
      evidence: all.filter((e) => e.kind === "artifact"),
      comments: all.filter((e) => e.kind === "comment" && !e.isAuto && e.authorUserId),
    };
  }, [events.data]);

  const done = ticket?.isDone ?? false;
  // the real estimate (what the ticket adds to its build's time on MADP), as on its card
  const calibration = useEstimates();
  const estimate = ticket ? estimateTicket(calibration, ticket.type) : null;
  const lane = ticket && milestoneName ? milestoneName(ticket.milestoneId) : "";

  return (
    <Drawer open={ticket !== null} onClose={onClose} title={ticket ? `${ticketCode(ticket)} · ${typeLabel(ticket.type)}` : t("build.proofDrawer.ticket", "Ticket")} width={480}>
      {!ticket ? (
        <EmptyState icon={<FileQuestion size={20} strokeWidth={1.75} aria-hidden />} title={t("build.board.drawer.notFound", "Ticket not found")} text={t("build.board.drawer.notFoundText", "This ticket is no longer on the board.")} />
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-[20px] font-medium leading-snug [overflow-wrap:anywhere]">{ticket.title}</h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone={done ? "success" : "accent"}>{columnName(ticket.column)}</Chip>
              <Chip>{featureName(ticket.featureRef)}</Chip>
              {lane && <Chip>{lane}</Chip>}
              {estimate && <Chip title={ticketEstimateTitle(estimate)}>{ticketEstimateChip(estimate)}</Chip>}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[13px]">
              <Avatar initials={agentInitialsOf(ticket.agent)} size={28} tone="soft" />
              <span><span className="text-ink3">{t("build.board.drawer.agent", "Agent: ")}</span><span className="font-medium">{agentName(ticket.agent)}</span></span>
            </div>
            {done && ticket.doneAt && <p className="mt-2 text-[13px] text-ink2">{t("build.board.drawer.doneWhen", "Done {when}", { when: fmtWhen(ticket.doneAt) })}</p>}
          </div>

          <section>
            <h4 className={H}>{t("build.board.drawer.description", "Description")}</h4>
            {ticket.description
              ? <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{ticket.description}</p>
              : <p className="mt-1 text-[13px] text-ink3">{t("build.board.drawer.noDescription", "No description.")}</p>}
          </section>

          <section>
            <h4 className={H}>{t("changes.analysis.criteria", "Acceptance criteria")}</h4>
            {ticket.acceptance.length === 0 ? <p className="mt-1 text-[13px] text-ink3">{t("build.board.drawer.noCriteria", "No acceptance criteria.")}</p> : (
              <ol className="mt-2 space-y-2">
                {ticket.acceptance.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                    <CircleCheck size={16} strokeWidth={1.75} aria-hidden className={cn("mt-0.5 shrink-0", done ? "text-success" : "text-ink3")} />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{a}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {events.error ? <p role="alert" className="text-[13px] text-danger">{t("build.board.drawer.historyFailed", "The history could not be loaded.")}</p>
            : events.isLoading ? <p role="status" className="text-[13px] text-ink3">{t("build.board.drawer.historyLoading", "Loading the history…")}</p> : (
              <>
                <section>
                  <h4 className={cn(H, "mb-2")}>{t("build.board.drawer.history", "Status and history")}</h4>
                  <TicketHistory moves={moves} authorOf={authorOf} />
                  {events.unreadable.length > 0 && (
                    <p className="mt-2 text-[13px] text-ink3">{events.unreadable.length === 1 ? t("build.board.drawer.unreadableOne", "One history entry can't be read.") : t("build.board.drawer.unreadable", "{count} history entries can't be read.", { count: events.unreadable.length })}</p>
                  )}
                </section>

                <section>
                  <h4 className={cn(H, "mb-2")}>{t("build.board.drawer.remarks", "Agents' remarks")}</h4>
                  {remarks.length === 0 ? <p className="text-[13px] text-ink3">{t("build.board.drawer.noRemarks", "No remarks yet.")}</p> : (
                    <ul className="space-y-3">
                      {remarks.map((r) => (
                        <li key={r.id} className="text-[13px] leading-snug">
                          <span className="font-medium">{authorOf(r)}</span>
                          <span className="text-[12px] text-ink3"> · <time dateTime={r.at}>{fmtWhen(r.at)}</time></span>
                          <p className="mt-0.5 whitespace-pre-wrap text-ink2 [overflow-wrap:anywhere]">{r.text}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {(done || evidence.length > 0) && (
                  <section>
                    <h4 className={cn(H, "mb-2")}>{t("build.board.drawer.evidence", "Change log / evidence")}</h4>
                    <EvidenceCards evidence={evidence} authorOf={authorOf} projectId={ctx.projectId} done={done} />
                  </section>
                )}

                <section>
                  <h4 className={cn(H, "mb-2")}>{t("build.board.drawer.comments", "Comments")}</h4>
                  {comments.length === 0 ? <p className="mb-3 text-[13px] text-ink3">{t("build.board.drawer.noComments", "No comments yet.")}</p> : (
                    <ul className="mb-3 space-y-4">
                      {comments.map((c) => {
                        const name = authorOf(c);
                        return (
                          <li key={c.id} className="flex gap-3">
                            <Avatar initials={initialsOf(name)} size={28} tone="soft" className="shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="text-[13px] font-medium">{name}</span>
                                <time dateTime={c.at} className="text-[12px] text-ink3">{fmtWhen(c.at)}</time>
                              </div>
                              <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{c.text}</p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}

          <div>
            <label htmlFor="blocks-ticket-comment" className={H}>{t("build.board.drawer.addComment", "Add a comment")}</label>
            <Textarea id="blocks-ticket-comment" className="mt-2 min-h-[72px]" placeholder={t("build.board.drawer.commentPlaceholder", "Add a comment…")} maxLength={LIMITS.comment} value={text}
              disabled={!mayComment || comment.pending}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <span className="num text-[12px] text-ink3">{text.length}/{LIMITS.comment}</span>
              <Button variant="secondary" size="sm" disabled={!mayComment || comment.pending || !text.trim()} onClick={() => void send()}>{t("build.board.drawer.send", "Add comment")}</Button>
            </div>
            {!mayComment && <p className="mt-2 text-[12px] text-ink3">{t("build.board.drawer.noCommentRole", "Your role can't comment on tickets.")}</p>}
            {comment.error && <p role="alert" className="mt-2 text-[13px] text-danger">{errText(comment.error)}</p>}
            {comment.success && <p role="status" className="mt-2 text-[13px] text-success">{t("build.board.drawer.commentAdded", "Comment added.")}</p>}
          </div>

          {mayMove && (
            <div>
              <h4 className={H}>{t("build.board.drawer.moveTo", "Move to")}</h4>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Select label={t("build.board.drawer.moveTo", "Move to")} className="min-w-[180px]" value={to} onChange={setTo} placeholder={t("build.board.drawer.chooseColumn", "Choose a column")} disabled={move.pending}
                  options={TICKET_COLUMNS.filter((c) => c !== ticket.column).map((c) => ({ value: c, label: columnName(c) }))} />
                <Button variant="secondary" disabled={!to || move.pending} onClick={() => void doMove()}>{t("build.board.drawer.move", "Move")}</Button>
              </div>
              {move.error && <p role="alert" className="mt-2 text-[13px] text-danger">{errText(move.error)}</p>}
              {move.success && <p role="status" className="mt-2 text-[13px] text-success">{t("build.board.drawer.moved", "Ticket moved.")}</p>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
