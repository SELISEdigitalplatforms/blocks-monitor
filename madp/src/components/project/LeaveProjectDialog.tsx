/** "Leave <project> for now?": asked before the project switcher (or the account menu's workspace switch) leaves a
 *  project page while something is unfinished there for the person. A calm list of what waits (leaveGuard.ts, from
 *  useLeaveFacts), then "Stay here" (the default), "Switch — I'll come back later" (nothing changes), and, when the
 *  person started work that is running and may start it again, "Pause the work and switch" (job.cancel through
 *  cancelEngineJob, as the Team panel's "Pause development"). With nothing unfinished the switch goes on at once and
 *  no dialog shows. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClipboardCheck, CirclePlay, Inbox, LoaderCircle, MessageCircleQuestion, PencilLine } from "lucide-react";
import { cancelEngineJob, engineErrorMessage } from "@/blocks/engine/actions";
import { Button, Modal } from "@/ui/kit";
import { leaveTitle, pausable, unfinishedItems, type UnfinishedItem, type UnfinishedKind } from "./leaveGuard";
import { settleLeave, type LeaveRequest } from "./leaveGuardStore";
import { useLeaveFacts } from "./useLeaveFacts";
import { useT } from "@/i18n";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

const KIND_ICON: Record<UnfinishedKind, ReactNode> = {
  draft: <PencilLine {...ICON} />,
  answers: <MessageCircleQuestion {...ICON} />,
  approval: <ClipboardCheck {...ICON} />,
  go: <CirclePlay {...ICON} />,
  waiting: <Inbox {...ICON} />,
  work: <LoaderCircle {...ICON} className="animate-spin motion-reduce:animate-none" />,
};

/** Reads the facts while mounted (LeaveGuardHost mounts it) and answers a waiting switch: at once when nothing is
 *  unfinished, else through the dialog. */
export function LeaveProbe({ projectId, projectName, request }: { projectId: string; projectName: string; request: LeaveRequest | null }) {
  const { loading, facts } = useLeaveFacts(projectId);
  const items = useMemo(() => unfinishedItems(facts), [facts]);
  const clear = !!request && !loading && items.length === 0;
  // nothing unfinished: the switch goes on, no question
  useEffect(() => { if (clear) settleLeave(true); }, [clear, request]);
  const show = !!request && !clear;
  // the menu closes and focus goes back to its button before the dialog opens (the dialog gives focus back there)
  const asked = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!show || !request || asked.current === request.id) return;
    asked.current = request.id;
    request.onAsk?.();
  }, [show, request]);
  return <LeaveProjectDialog key={request?.id ?? 0} open={show} checking={loading} projectName={projectName} items={items} />;
}

/** The dialog itself; its answer settles the waiting switch. */
export function LeaveProjectDialog({ open, checking, projectName, items }: { open: boolean; checking: boolean; projectName: string; items: readonly UnfinishedItem[] }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pauses = pausable(items);
  const hasDraft = items.some((i) => i.kind === "draft");
  const stay = () => { if (!busy) settleLeave(false); };
  const go = () => { if (!busy) settleLeave(true); };
  const pauseAndGo = async () => {
    if (busy || !pauses.length) return;
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    for (const p of pauses) {
      try { await cancelEngineJob(p.jobId); } catch (e) { failed.push(engineErrorMessage(e)); }
    }
    setBusy(false);
    if (failed.length) { setError(t("project.leave.pauseFailed", "The work could not be paused: {error}", { error: failed[0]! })); return; }
    settleLeave(true);
  };

  return (
    <Modal open={open} onClose={stay} title={leaveTitle(projectName)} width={520}
      footer={checking ? (
        <>
          <Button variant="ghost" onClick={go}>{t("project.leave.switchNow", "Switch now")}</Button>
          <Button variant="primary" data-autofocus onClick={stay}>{t("project.leave.stay", "Stay here")}</Button>
        </>
      ) : (
        <>
          {pauses.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => void pauseAndGo()}>{busy ? t("project.leave.pausing", "Pausing…") : t("project.leave.pauseAndSwitch", "Pause the work and switch")}</Button>}
          <Button variant="ghost" disabled={busy} onClick={go}>{t("project.leave.switchLater", "Switch — I'll come back later")}</Button>
          <Button variant="primary" data-autofocus disabled={busy} onClick={stay}>{t("project.leave.stay", "Stay here")}</Button>
        </>
      )}>
      {checking ? (
        <p role="status" className="flex items-center gap-2.5 text-[14px] text-ink2">
          <LoaderCircle {...ICON} className="shrink-0 animate-spin motion-reduce:animate-none" />
          {t("project.leave.checking", "Checking what is still open here…")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] leading-snug text-ink2">{t("project.leave.intro", "You can switch now and come back to it later. Still open here:")}</p>
          <ul className="flex flex-col gap-2">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 rounded-block bg-surface2 px-3.5 py-2.5 text-[14px] leading-snug text-ink">
                <span className="mt-0.5 shrink-0 text-[rgb(var(--c-accent-text))]">{KIND_ICON[i.kind]}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{i.text}</span>
              </li>
            ))}
          </ul>
          {hasDraft && <p className="text-[13px] leading-snug text-ink2">{t("project.leave.unsentLost", "Unsent text is not kept when you switch.")}</p>}
          {pauses.length > 0 && (
            <div className="rounded-block px-3.5 py-3 ring-1 ring-inset ring-line">
              <p className="text-[13px] font-medium text-ink">{t("project.leave.ifYouPause", "If you pause the work you started")}</p>
              <ul className="mt-1 flex flex-col gap-1 text-[13px] leading-snug text-ink2">
                {pauses.map((p) => <li key={p.jobId}>{p.text}</li>)}
              </ul>
            </div>
          )}
          {error && <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
