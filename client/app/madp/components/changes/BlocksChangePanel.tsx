import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { byNewestNumber } from "@/madp/lib/newest";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AttachButton, AttachChipList, AttachZone, SentFiles, attachHold, useAttachDraft } from "@/madp/components/feedback/AttachFiles";
import { useTalkAttachments } from "@/madp/blocks/collab/talkUpload";
import { Send } from "lucide-react";
import { useT } from "@/madp/i18n";
import { Button, Input, Label, Select, Textarea } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { useDeliveryContext } from "@/madp/blocks/delivery/context";
import { useChangeRequests } from "@/madp/blocks/delivery/hooks";
import type { ChangeLane } from "@/madp/domain/delivery";
import {
  BLOCKS_LANES, BLOCKS_LANE_META, blocksChangeMessage, crCodeOf, laneLine, newestBlocksDraft, useBlocksChangeAccess, useBlocksFeatureRefs,
  useSaveBlocksDraft, useSubmitBlocksChange,
} from "./blocksChanges";
import { dismissChangeRequest, parseChangeParam, useChangeUi } from "./changeUiState";
import { crStatusLabel } from "@/madp/components/delivery/releaseUi";
import { prefixPath } from "@/madp/lib/pathPrefix";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 10_000;

/** The change request panel of a Blocks project: drafts are saved with cr.saveDraft and sent for analysis with
 *  cr.submit (the business analyst's change.analyse job); the build starts only after the approval, on the change
 *  request's page. Nothing is prefilled or simulated. */
export function BlocksChangePanel({ projectId }: { projectId: string }) {
  const t = useT();
  const open = useChangeUi((s) => s.open)!;
  const ctx = useDeliveryContext(projectId);
  const requests = useChangeRequests(ctx).data;
  const { role } = useBlocksChangeAccess(projectId);
  const features = useBlocksFeatureRefs(ctx);
  const draftApi = useSaveBlocksDraft(ctx.workspaceId, projectId);
  const submitApi = useSubmitBlocksChange(ctx.workspaceId, projectId);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  const originRef = open.target ? `feature:${open.target.id}` : "";
  const lane0: ChangeLane = open.lane;
  const loaded = useMemo(() => {
    if (open.draftId) return requests.find((r) => r.id === open.draftId) ?? null;
    return newestBlocksDraft(requests, lane0, lane0 === "add" ? "" : originRef);
  }, [open.draftId, requests, lane0, originRef]);

  const [draftId, setDraftId] = useState<string | null>(loaded?.id ?? null);
  const [number, setNumber] = useState<number | null>(loaded?.number ?? null);
  const [lane, setLane] = useState<ChangeLane>(loaded?.lane ?? lane0);
  const [ref, setRef] = useState<string>(loaded?.featureRef ?? (lane0 === "add" ? "" : originRef));
  const [title, setTitle] = useState(loaded?.title ?? "");
  const [description, setDescription] = useState(loaded?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  const options = useMemo(() => {
    const list = features.map((f) => ({ value: f.ref, label: f.ref === originRef && open.target?.title ? open.target.title : `${f.name} · ${f.milestone}` }));
    if (originRef && !list.some((o) => o.value === originRef)) list.unshift({ value: originRef, label: open.target?.title || originRef.slice(8) });
    return list;
  }, [features, originRef, open.target]);

  // a product with no locked scope (an existing product attached as it is live): a change is about the product as a whole
  const needsTarget = lane !== "add" && options.length > 0;
  const effectiveRef = needsTarget ? ref : "";
  const readOnly = role === "viewer";
  const disabled = busy || readOnly;
  // newest first
  const others = byNewestNumber(requests.filter((r) => r.id !== draftId && r.featureRef === effectiveRef && effectiveRef !== ""), (r) => r.number);
  // files sent with the request (a design, a screenshot, a document): the business analyst and the developers read them
  const files = useAttachDraft({ projectId, owner: { ownerType: "change-request", forId: draftId }, disabled });
  const hold = attachHold(files);
  const sentFiles = useTalkAttachments(projectId, "change-request", draftId ? [draftId] : []).data?.get(draftId ?? "");

  useEffect(() => {
    if (!needsTarget || options.some((o) => o.value === ref)) return;
    setRef(options[0]?.value ?? "");
  }, [needsTarget, options, ref]);

  const pickLane = (next: ChangeLane) => { setLane(next); setError(""); setSaved(""); };
  const onRadioKey = (e: ReactKeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + BLOCKS_LANES.length) % BLOCKS_LANES.length;
    pickLane(BLOCKS_LANES[n]);
    radios.current[n]?.focus();
  };

  const problem = (forBuild: boolean): string | null => {
    if (needsTarget && !effectiveRef) return t("changes.panel.pickFeature", "Pick the feature this change is about.");
    if (!title.trim() && !description.trim()) return t("changes.panel.titleOrDescription", "Add a title or a description.");
    if (forBuild && (!title.trim() || !description.trim())) return t("changes.panel.titleAndDescription", "Add a title and a description before sending it for analysis.");
    return null;
  };

  const run = async (kind: "save" | "start") => {
    if (busy) return;
    const p = problem(kind === "start") ?? (hold || null);
    if (p) { setError(p); setSaved(""); return; }
    setBusy(true);
    setError(""); setSaved("");
    try {
      const draft = await draftApi.save({
        changeRequestId: draftId ?? undefined, lane, featureRef: effectiveRef, title: title.trim(), description: description.trim(),
        ...(files.ids.length ? { attachmentIds: files.ids, draftKey: files.draftKey } : {}),
      });
      // the files are the request's now; the form starts empty again
      files.reset();
      setDraftId(draft.changeRequestId);
      setNumber(draft.number);
      if (kind === "save") { setSaved(t("changes.panel.savedAs", "Saved as {code} (draft).", { code: crCodeOf(draft.number) })); return; }
      await submitApi.submit(draft.changeRequestId);
      dismissChangeRequest(parseChangeParam(params.get("change")));
      navigate(prefixPath(`/p/${projectId}/build?cr=${draft.number}`));
    } catch (e) {
      setError(blocksChangeMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-w-0">
      {readOnly && <p className="mb-3 text-[13px] leading-snug text-ink2">{t("changes.panel.readOnly", "Your role can read change requests but not create them.")}</p>}

      <div>
        <Label>{t("changes.panel.kind", "What kind of change")}</Label>
        <div role="radiogroup" aria-label={t("changes.panel.kind", "What kind of change")} className="space-y-2">
          {BLOCKS_LANES.map((l, i) => {
            const on = l === lane;
            return (
              <button key={l} ref={(el) => { radios.current[i] = el; }} type="button" role="radio" aria-checked={on} disabled={disabled}
                tabIndex={on ? 0 : -1} onClick={() => pickLane(l)} onKeyDown={(e) => onRadioKey(e, i)}
                className={cn("block w-full min-w-0 rounded-block px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-70",
                  on ? "bg-accent-soft ring-2 ring-accent/40" : "bg-surface2 hover:bg-line")}>
                <span className="block text-[14px] font-medium [overflow-wrap:anywhere]">{BLOCKS_LANE_META[l].label}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-ink2 [overflow-wrap:anywhere]">{laneLine(l, options.length > 0)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {needsTarget && (
        <div className="mt-4">
          <Label>{t("changes.panel.feature", "Feature")}</Label>
          <Select label={t("changes.panel.feature", "Feature")} value={ref} disabled={disabled} onChange={(v) => { setRef(v); setSaved(""); setError(""); }} options={options} />
        </div>
      )}

      <div className="mt-4">
        <Label>{t("changes.panel.title", "Title")}</Label>
        <Input aria-label={t("changes.panel.title", "Title")} value={title} disabled={disabled} maxLength={TITLE_MAX} placeholder={t("changes.panel.titlePlaceholder", "A short name for the change")}
          onChange={(e) => { setTitle(e.target.value); setSaved(""); }} />
      </div>
      <div className="mt-4">
        <Label>{t("changes.panel.description", "What changes and why")}</Label>
        <AttachZone draft={files}>
          <Textarea aria-label={t("changes.panel.description", "What changes and why")} value={description} disabled={disabled} maxLength={DESCRIPTION_MAX} className="min-h-[96px]"
            placeholder={t("changes.panel.descriptionPlaceholder", "What changes and why…")} onChange={(e) => { setDescription(e.target.value); setSaved(""); }} />
        </AttachZone>
        <SentFiles projectId={projectId} files={sentFiles} />
        <AttachChipList draft={files} disabled={disabled} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AttachButton draft={files} disabled={disabled} label={t("changes.panel.attach", "Attach a design, screenshot or document")} />
          <span className="text-[12px] text-ink3">{hold || t("changes.panel.attachHint", "Add a design, a screenshot or a document if it helps. You can also drop or paste it.")}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" size="sm" disabled={disabled || !!hold} onClick={() => void run("save")}>{t("changes.panel.saveDraft", "Save draft")}</Button>
        <Button variant="primary" size="sm" disabled={disabled || !!hold} icon={<Send size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={() => void run("start")}>{t("changes.page.primary.send", "Send for analysis")}</Button>
      </div>
      <p className="mt-3 text-[12px] leading-snug text-ink3">
        {lane === "add" && options.length === 0
          ? t("changes.panel.howFeature", "The business analyst analyses the feature against the product as it is today, asks what is unclear and plans its tickets in small builds. You see the plan and approve it before the first build starts.")
          : t("changes.panel.how", "The business analyst analyses the change, asks what is unclear and plans the tickets. You approve it before the build starts.")}
      </p>
      <p role="status" aria-live="polite" className={cn(saved ? "mt-3 text-[13px] text-ink2" : "sr-only")}>{saved}</p>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger [overflow-wrap:anywhere]">{error}</p>}
      {number !== null && !saved && !error && <p className="mt-3 text-[12px] text-ink3">{t("changes.panel.editing", "Editing {code}.", { code: crCodeOf(number) })}</p>}

      {others.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <Label>{t("changes.panel.others", "Other change requests")}</Label>
          <ul className="space-y-1.5">
            {others.map((r) => (
              <li key={r.id} className="flex min-w-0 items-baseline gap-2 text-[13px]">
                <span className="num shrink-0 text-ink3">{crCodeOf(r.number)}</span>
                <span className="min-w-0 flex-1 text-ink2 [overflow-wrap:anywhere]">{r.title}</span>
                <span className="shrink-0 text-[12px] text-ink3">{r.version ? `v${r.version}` : crStatusLabel(r.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
