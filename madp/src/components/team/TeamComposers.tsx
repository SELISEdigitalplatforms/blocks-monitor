/** What the person writes to the team. To the business analyst: a change or a new feature, saved with cr.saveDraft and
 *  sent for analysis with cr.submit (the same hooks and rules as the change request window, BlocksChangePanel). To the
 *  tech lead: a technical question, sent through the existing agent chat (agentChat.send on the technical role; the
 *  engine's chat.reply job answers it, a request for a change becomes a change request draft as in the office chat). */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Plus, RotateCcw, Send, SendHorizontal } from "lucide-react";
import { Button, Input, Label, Segmented, Select, Textarea } from "@/ui/kit";
import { useDeliveryContext } from "@/blocks/delivery/context";
import type { ChangeLane } from "@/domain/delivery";
import { MAX_TEXT } from "@/domain/agentChat";
import { STEP_LABEL, useSendAgentMessage } from "@/blocks/collab/chat";
import { AttachButton, AttachChipList, AttachZone, attachHold, useAttachDraft } from "@/components/feedback/AttachFiles";
import {
  BLOCKS_LANES, blocksChangeMessage, crCodeOf, laneLine, useBlocksChangeAccess, useBlocksFeatureRefs, useSaveBlocksDraft, useSubmitBlocksChange,
} from "@/components/changes/blocksChanges";
import { LEAD_CHAT_ROLE } from "./useTeam";
import { useDirtyDraft } from "@/components/project/dirtyDrafts";
import { t, useT } from "@/i18n";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 10_000;
/** The lane's short name, in the current language. */
function laneShort(lane: ChangeLane): string {
  switch (lane) {
    case "change": return t("team.composer.laneChange", "Change");
    case "enhance": return t("team.composer.laneEnhance", "Enhance");
    case "add": return t("team.composer.laneAdd", "New feature");
    case "fix": return t("team.composer.laneFix", "Fix");
  }
}

// ------------------------------------------------------------------------------------------- to the business analyst

export function ChangeComposer({ projectId, onSent }: { projectId: string; onSent: () => void }) {
  const t = useT();
  const ctx = useDeliveryContext(projectId);
  const access = useBlocksChangeAccess(projectId);
  const features = useBlocksFeatureRefs(ctx);
  const draftApi = useSaveBlocksDraft(ctx.workspaceId, projectId);
  const submitApi = useSubmitBlocksChange(ctx.workspaceId, projectId);
  const [open, setOpen] = useState(false);
  const [lane, setLane] = useState<ChangeLane>("change");
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const options = useMemo(() => features.map((f) => ({ value: f.ref, label: `${f.name} · ${f.milestone}` })), [features]);
  // a product with no locked scope: a change is about the product as a whole (as in the change request window)
  const needsTarget = lane !== "add" && options.length > 0;
  useEffect(() => {
    if (needsTarget && !options.some((o) => o.value === ref)) setRef(options[0]?.value ?? "");
  }, [needsTarget, options, ref]);

  const disabled = busy !== null || !access.canRun;
  const files = useAttachDraft({ projectId, owner: { ownerType: "change-request", forId: draftId }, disabled });
  const hold = attachHold(files);
  // text not sent for analysis yet: leaving the project says so (LeaveProjectDialog)
  useDirtyDraft(projectId, t("team.composer.dirtyChange", "change request for your business analyst"), access.canRun && Boolean(title.trim() || description.trim()));

  if (!access.canRun) {
    return (
      <p className="text-[12px] leading-snug text-ink3">
        {!access.available ? t("team.composer.notAvailable", "You can ask for changes and new features once the first milestone is on the development environment.")
          : t("team.composer.noRoleChange", "Your role can follow change requests here but not create them.")}
      </p>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-1.5">
        {status && <p role="status" className="text-[12px] text-[rgb(var(--c-success-text))]">{status}</p>}
        <Button variant="primary" size="sm" className="w-full justify-center" icon={<Plus {...ICON} />} onClick={() => { setStatus(""); setOpen(true); }}>
          {t("team.composer.requestChange", "Request a change or a new feature")}
        </Button>
      </div>
    );
  }

  const run = async (kind: "save" | "send") => {
    if (busy) return;
    const effectiveRef = needsTarget ? ref : "";
    const problem = needsTarget && !effectiveRef ? t("team.composer.pickFeature", "Pick the feature this change is about.")
      : !title.trim() && !description.trim() ? t("team.composer.needTitleOrDescription", "Add a title or a description.")
      : kind === "send" && (!title.trim() || !description.trim()) ? t("team.composer.needTitleAndDescription", "Add a title and a description before sending it.") : hold || null;
    if (problem) { setError(problem); return; }
    setBusy(kind); setError("");
    try {
      const draft = await draftApi.save({
        changeRequestId: draftId ?? undefined, lane, featureRef: effectiveRef, title: title.trim(), description: description.trim(),
        ...(files.ids.length ? { attachmentIds: files.ids, draftKey: files.draftKey } : {}),
      });
      files.reset();
      setDraftId(draft.changeRequestId);
      if (kind === "save") { setStatus(t("team.composer.savedDraft", "Saved as {code} (a draft).", { code: crCodeOf(draft.number) })); return; }
      await submitApi.submit(draft.changeRequestId);
      setTitle(""); setDescription(""); setDraftId(null); setOpen(false);
      setStatus(t("team.composer.sent", "Sent as {code}. Your business analyst starts the analysis in a moment.", { code: crCodeOf(draft.number) }));
      onSent();
    } catch (e) {
      setError(blocksChangeMessage(e));
    } finally { setBusy(null); }
  };

  return (
    <form className="flex min-w-0 flex-col gap-3" aria-label={t("team.composer.requestChange", "Request a change or a new feature")} onSubmit={(e) => { e.preventDefault(); void run("send"); }}>
      <div className="min-w-0">
        <Segmented label={t("team.composer.kindLabel", "What kind of change")} value={lane} onChange={(v) => { setLane(v); setError(""); }}
          options={BLOCKS_LANES.map((l) => ({ value: l, label: laneShort(l) }))} className="max-w-full overflow-x-auto" />
        <p className="mt-1.5 text-[12px] leading-snug text-ink3">{laneLine(lane, options.length > 0)}</p>
      </div>
      {needsTarget && (
        <div className="min-w-0">
          <Label>{t("team.composer.feature", "Feature")}</Label>
          <Select label={t("team.composer.feature", "Feature")} size="sm" value={ref} disabled={disabled} onChange={(v) => { setRef(v); setError(""); }} options={options} />
        </div>
      )}
      <div className="min-w-0">
        <label htmlFor="team-cr-title"><Label>{t("team.composer.title", "Title")}</Label></label>
        <Input autoFocus id="team-cr-title" value={title} disabled={disabled} maxLength={TITLE_MAX} placeholder={t("team.composer.titlePlaceholder", "A short name for the change")}
          onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="min-w-0">
        <label htmlFor="team-cr-description"><Label>{t("team.composer.description", "What changes and why")}</Label></label>
        <AttachZone draft={files}>
          <Textarea id="team-cr-description" value={description} disabled={disabled} maxLength={DESCRIPTION_MAX} className="min-h-[88px]"
            placeholder={t("team.composer.descriptionPlaceholder", "What changes and why…")} onChange={(e) => setDescription(e.target.value)} />
        </AttachZone>
        <AttachChipList draft={files} disabled={disabled} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AttachButton draft={files} disabled={disabled} label={t("team.composer.attachChange", "Attach a design, screenshot or document")} className="!h-8 !w-8" />
          <span className="min-w-0 flex-1 text-[12px] text-ink3">{hold || t("team.composer.attachHint", "A design, a screenshot or a document helps. You can also drop or paste it.")}</span>
        </div>
      </div>
      {error && <p role="alert" className="text-[12px] text-danger [overflow-wrap:anywhere]">{error}</p>}
      {status && <p role="status" className="text-[12px] text-ink2">{status}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setOpen(false); setError(""); }}>{t("team.composer.close", "Close")}</Button>
        <Button type="button" size="sm" variant="secondary" disabled={disabled || !!hold} onClick={() => void run("save")}>{busy === "save" ? t("team.actions.saving", "Saving…") : t("team.composer.saveDraft", "Save draft")}</Button>
        <Button type="submit" size="sm" variant="primary" disabled={disabled || !!hold} icon={<Send {...ICON} />}>{busy === "send" ? t("team.actions.sending", "Sending…") : t("team.analyst.sendForAnalysis", "Send for analysis")}</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------- to the tech lead

export function QuestionComposer({ projectId, canAsk, onSent }: { projectId: string; canAsk: boolean; onSent: () => void }) {
  const t = useT();
  const flow = useSendAgentMessage(projectId, LEAD_CHAT_ROLE);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const composing = useRef(false);
  const files = useAttachDraft({ projectId, owner: { ownerType: "agent-chat" }, disabled: !canAsk || flow.busy });
  const hold = attachHold(files);
  useDirtyDraft(projectId, t("team.composer.dirtyQuestion", "message to your tech lead"), canAsk && text.trim() !== "");
  const { state, settle } = flow;
  // a finished send is handled once (the flow outlives this screen)
  useEffect(() => { if (state.phase === "done") settle(); }, [state, settle]);

  if (!canAsk) return <p className="text-[12px] leading-snug text-ink3">{t("team.composer.noRoleQuestion", "Your role can follow the builds here but not ask questions.")}</p>;

  const send = async () => {
    const q = text.trim();
    if (!q || flow.busy || hold) return;
    if (q.length > MAX_TEXT) { setError(t("team.composer.tooLong", "Keep a question under {max} characters.", { max: MAX_TEXT })); return; }
    setError("");
    const attached = files.ids.length ? { attachmentIds: files.ids, draftKey: files.draftKey } : undefined;
    files.reset();
    setText("");
    onSent();
    await flow.send(q, attached);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || composing.current || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void send();
  };
  const failed = state.phase === "failed" ? state : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {(state.phase === "sending" || state.phase === "creating" || state.phase === "recording") && (
        <p role="status" className="text-[12px] text-ink3">{state.phase === "sending" ? STEP_LABEL.send : state.phase === "creating" ? STEP_LABEL.draft : STEP_LABEL.record}</p>
      )}
      {(error || failed) && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-block bg-danger-soft px-3 py-2 text-[12px] text-danger">
          <span className="min-w-0 [overflow-wrap:anywhere]">{error || failed?.message}</span>
          {failed && <Button size="sm" variant="ghost" icon={<RotateCcw {...ICON} />} onClick={() => void flow.retry()}>{t("team.composer.retry", "Retry")}</Button>}
        </div>
      )}
      <AttachZone draft={files}>
        <label htmlFor="team-question" className="sr-only">{t("team.composer.askLead", "Ask your tech lead a technical question")}</label>
        <Textarea id="team-question" rows={2} value={text} maxLength={MAX_TEXT} disabled={flow.busy} className="min-h-[60px] !text-[13px]"
          placeholder={t("team.composer.askLead", "Ask your tech lead a technical question")} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
      </AttachZone>
      <AttachChipList draft={files} disabled={flow.busy} />
      <div className="flex items-center justify-between gap-2">
        <AttachButton draft={files} disabled={flow.busy} label={t("team.composer.attachQuestion", "Attach files for your tech lead")} className="!h-8 !w-8" />
        <Button size="sm" variant="primary" disabled={flow.busy || !text.trim() || !!hold} icon={<SendHorizontal {...ICON} />} onClick={() => void send()}>{t("team.composer.send", "Send")}</Button>
      </div>
    </div>
  );
}
