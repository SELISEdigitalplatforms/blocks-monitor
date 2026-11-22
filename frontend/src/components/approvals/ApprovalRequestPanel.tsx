import { useEffect, useRef, useState } from "react";
import { Check, UserCheck, X } from "lucide-react";
import { Button, Card, Chip } from "@/ui/kit";
import { formatDateTime } from "@/lib/dates";
import type { DeliveryContext } from "@/blocks/delivery/context";
import type { RequestRecord } from "@/blocks/delivery/types";
import {
  useApprovalRequestCancel,
  useApprovalRequestCreate,
  useApprovalRequestDecide,
} from "@/blocks/delivery/actions";
import { approvalStepLabel } from "@/domain/delivery";
import { decideRight, type Decision, type GatedEnvironment } from "@/domain/promotion";
import { useT } from "@/i18n";
import { canCancel, decisionLabel, envInSentence, envLabel } from "./approvalsUi";
import { RejectDialog } from "./RejectDialog";

const DECISION_TONE: Record<Decision, "neutral" | "success" | "danger"> = { pending: "neutral", approved: "success", rejected: "danger" };
const STATUS_TONE = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral" } as const;
function statusLabel(status: keyof typeof STATUS_TONE, t: (key: string, english: string) => string): string {
  if (status === "approved") return t("platform.approvals.status.approved", "Approved");
  if (status === "rejected") return t("platform.approvals.status.rejected", "Changes asked");
  if (status === "cancelled") return t("platform.approvals.status.cancelled", "Cancelled");
  return t("platform.approvals.status.pending", "Waiting");
}

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatDateTime(d);
}

/** The current approval request of an environment: steps, decisions, and the actions the user may take. */
export function ApprovalRequestPanel({ ctx, environment, request, candidateVersion, primary, moves = null }: {
  ctx: DeliveryContext;
  environment: GatedEnvironment;
  request: RequestRecord | null;
  candidateVersion: string | null;
  primary: boolean;
  /** What sending it moves, in plain words ("Once approved, v0.8.0 goes from development to staging with …"). */
  moves?: string | null;
}) {
  const t = useT();
  const decide = useApprovalRequestDecide(ctx);
  const cancel = useApprovalRequestCancel(ctx);
  const create = useApprovalRequestCreate(ctx);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // one outcome line at a time, for this environment only: an older "Approval requested." must not sit next to
  // "Request cancelled.", nor follow the user from Stage to Production
  const { reset: resetDecide } = decide, { reset: resetCancel } = cancel, { reset: resetCreate } = create;
  const resets = useRef([resetDecide, resetCancel, resetCreate]);
  resets.current = [resetDecide, resetCancel, resetCreate];
  useEffect(() => {
    resets.current.forEach((r) => r());
    setConfirmCancel(false); setRejecting(null);
  }, [environment]);
  const only = (keep: "decide" | "cancel" | "create") => {
    if (keep !== "decide") resetDecide();
    if (keep !== "cancel") resetCancel();
    if (keep !== "create") resetCreate();
  };
  const pending = request?.status === "pending";
  const canAsk =
    candidateVersion !== null && !pending &&
    (request === null || request.version !== candidateVersion || request.status === "rejected" || request.status === "cancelled");
  const mayRequest = ctx.can("release.request");
  const envName = envLabel(environment);
  const envLower = envInSentence(environment);
  const rejectStep = rejecting !== null && request ? request.request.steps[rejecting] : null;
  const busy = decide.pending || cancel.pending || create.pending;

  return (
    <Card title={t("platform.approvals.request.title", "{env} approvals", { env: envName })} icon={<UserCheck size={18} strokeWidth={1.75} />}>
      {request ? (
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <span className="font-medium">v{request.version}</span>
            <Chip tone={STATUS_TONE[request.status]}>{statusLabel(request.status, t)}</Chip>
            <span className="text-ink3">{t("platform.approvals.request.attempt", "Attempt {n}", { n: request.attempt })}</span>
            <span className="text-ink3">{t("platform.approvals.request.requestedBy", "Requested by {name}", { name: ctx.memberName(request.requestedByUserId) })}</span>
          </div>
          {request.request.steps.length === 0 && request.status === "pending" ? (
            <p className="mt-3 text-[14px] text-ink3">{t("platform.approvals.request.preparing", "Preparing the approval steps.")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {request.request.steps.map((s, i) => {
                // four-eyes with the one-person fallback: you decide a release you asked for only as its only approver
                const right = ctx.userId && ctx.can("release.approve")
                  ? decideRight(request.request, i, ctx.userId, { requesterId: request.requestedByUserId, activeMemberIds: ctx.activeMemberIds })
                  : null;
                const mine = !!right?.ok;
                const mustOthers = right && !right.ok && right.reason === "ownRequest" ? right.others.map((u) => ctx.memberName(u)).filter(Boolean) : [];
                const selfDecided = s.decision !== "pending" && !!s.decidedBy && s.decidedBy === request.requestedByUserId;
                const required = request.stepRequired[i] ?? false;
                return (
                  <li key={i} className="rounded-block bg-surface2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium">{approvalStepLabel(s.type, s.label)}</span>
                      <Chip>{required ? t("platform.approvals.request.required", "Required") : t("platform.approvals.request.optional", "Optional")}</Chip>
                      <Chip tone={DECISION_TONE[s.decision]}>{decisionLabel(s.decision)}</Chip>
                    </div>
                    <p className="mt-1.5 break-words text-[13px] text-ink3">
                      {t("platform.approvals.request.approvers", "Approvers: {names}", { names: s.approverUserIds.length ? s.approverUserIds.map((u) => ctx.memberName(u)).join(", ") : t("platform.approvals.request.approversNone", "none") })}
                    </p>
                    {s.decision !== "pending" && (
                      <p className="mt-1 break-words text-[13px] text-ink2">
                        {s.decidedBy ? ctx.memberName(s.decidedBy) : t("platform.approvals.request.formerMember", "Former member")}
                        {selfDecided && (s.decision === "approved" ? t("platform.approvals.request.selfApproved", " · self-approved as the only approver") : t("platform.approvals.request.onlyApprover", " · as the only approver"))}
                        {when(s.decidedAt) && ` · ${when(s.decidedAt)}`}
                        {s.comment && <span className="block">“{s.comment}”</span>}
                      </p>
                    )}
                    {mine && right?.ok && right.self && (
                      <p className="mt-2 text-[13px] text-ink2">{t("platform.approvals.request.youOnlyApprover", "You're the only approver, so you can approve this yourself.")}</p>
                    )}
                    {mustOthers.length > 0 && (
                      <p className="mt-2 text-[13px] text-ink3">{t("platform.approvals.request.othersMustApprove", "You asked for this release, so {names} must approve this step.", { names: mustOthers.join(t("platform.approvals.or", " or ")) })}</p>
                    )}
                    {mine && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" icon={<Check size={14} strokeWidth={1.75} />} disabled={busy}
                          onClick={() => { only("decide"); void decide.run({ approvalRequestId: request.id, stepIndex: i, decision: "approved" }); }}>{t("platform.approvals.request.approve", "Approve")}</Button>
                        <Button size="sm" variant="secondary" icon={<X size={14} strokeWidth={1.75} />} disabled={busy}
                          onClick={() => { resets.current.forEach((r) => r()); setRejecting(i); }}>{t("platform.approvals.request.requestChanges", "Request changes")}</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canCancel(ctx, request) && (
            <div className="mt-3">
              {/* cancelling throws away the approvals already given: it is confirmed first */}
              {confirmCancel ? (
                <span role="group" aria-label={t("platform.approvals.request.cancelGroup", "Cancel this approval request")} className="flex flex-wrap items-center gap-2 text-[13px]">
                  {t("platform.approvals.request.cancelQuestion", "Cancel the request for v{version}? Approvals already given are lost.", { version: request.version })}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(false)}>{t("platform.approvals.request.keepIt", "Keep it")}</Button>
                  <Button size="sm" variant="danger" disabled={busy}
                    onClick={() => { only("cancel"); void cancel.run({ approvalRequestId: request.id }).then(() => setConfirmCancel(false)); }}>{t("platform.approvals.request.cancelRequest", "Cancel request")}</Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>{t("platform.approvals.request.cancelRequest", "Cancel request")}</Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[14px] text-ink3">{candidateVersion ? t("platform.approvals.request.nothingSent", "Nothing sent for approval to {env} yet.", { env: envLower }) : t("platform.approvals.request.nothingWaits", "Nothing waits for approval for {env}.", { env: envLower })}</p>
      )}

      {canAsk && candidateVersion && (
        <div className="mt-4">
          <Button variant={primary ? "primary" : "secondary"} data-primary={primary ? "true" : undefined}
            disabled={!mayRequest || busy} aria-describedby={mayRequest ? undefined : `request-why-${environment}`}
            onClick={() => { only("create"); void create.run({ environment, version: candidateVersion }); }}>
            {t("platform.approvals.request.send", "Send v{version} to {env} for approval", { version: candidateVersion, env: envName })}
          </Button>
          {moves && <p className="mt-2 max-w-prose text-[13px] text-ink2">{moves}</p>}
          {!mayRequest && <p id={`request-why-${environment}`} className="mt-2 text-[13px] text-ink3">{t("platform.approvals.request.managerSends", "Your release manager sends it for approval.")}</p>}
        </div>
      )}

      {[decide, cancel, create].map((a, i) => (
        <div key={i}>
          {a.error && <p role="alert" className="mt-3 text-[13px] text-danger">{String(a.error)}</p>}
          {a.success && <p role="status" className="mt-3 text-[13px] text-success">{[t("platform.approvals.request.decisionSaved", "Decision saved."), t("platform.approvals.request.cancelled", "Request cancelled."), t("platform.approvals.request.requested", "Approval requested.")][i]}</p>}
        </div>
      ))}

      <RejectDialog open={rejecting !== null} busy={decide.pending} error={rejecting !== null && decide.error ? String(decide.error) : null}
        stepName={rejectStep ? approvalStepLabel(rejectStep.type, rejectStep.label) : t("platform.approvals.request.stepFallback", "step")}
        onClose={() => setRejecting(null)}
        onConfirm={(comment) => {
          if (!request || rejecting === null) return;
          void decide.run({ approvalRequestId: request.id, stepIndex: rejecting, decision: "rejected", comment }).then((ok) => { if (ok) setRejecting(null); });
        }} />
    </Card>
  );
}
