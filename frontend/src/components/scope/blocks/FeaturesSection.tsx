/** The Features card of the Blocks scope page: features and their stories, edited locally and saved by the autosave
 *  (scope.save on the Logic Function). Reads come from the hooks; this file never writes data itself. */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, RotateCcw, LoaderCircle } from "lucide-react";
import { Button, Card, EmptyState, Label, Textarea } from "@/ui/kit";
import { ViewOnlyNote } from "@/components/workspace/ViewOnlyNote";
import { VIEWER_TIP } from "@/data/rbac";
import type { ScopeContext } from "../../../blocks/scope/context";
import type { DesignScreenRecord, RequirementRecord, ScopeVersionRecord } from "../../../blocks/scope/records";
import { useDesignScreens, useFeatures, useRequirements, useStories } from "../../../blocks/scope/hooks";
import { useScopeAutosave, saveStatusText, type ScopeChangeInput } from "../../../blocks/scope/autosave";
import type { FeatureInput, StoryInput } from "../../../blocks/scope/mutations";
import { fieldIssueText } from "../../../blocks/scope/messages";
import { validateScopeChange, type FieldIssue } from "../../../domain/scope";
import type { ApplyRequest } from "./applyRequest";
import { AddFromRequirements } from "./AddFromRequirements";
import { FeatureEditor, type FeatureRow } from "./FeatureEditor";
import type { StoryRow } from "./StoryEditor";
import { readOnlyText, type ReadOnlyReason } from "./pageState";
import { useT } from "@/i18n";

const EMPTY: never[] = [];
const NAME_MAX = 120;
const newKey = () => crypto.randomUUID();
const byOrder = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;
/** The position after the last one: max + 1, so a new row always sorts last, whatever numbering the list already has. */
const nextOrder = (list: readonly { sortOrder: number }[]): number => list.reduce((m, r) => Math.max(m, r.sortOrder + 1), 0);

const ROW_PATH = /^upsert(Features|Stories)\.\d+\./;

export const toDraftFeature = (f: FeatureRow): FeatureInput => ({
  id: f.id ?? undefined, clientKey: f.clientKey ?? undefined, name: f.name.trim(), description: f.description,
  priority: f.priority, excludedReason: f.priority === "excluded" && f.excludedReason ? f.excludedReason : undefined,
  requirementIds: f.requirementIds, screenIds: f.screenIds, sortOrder: f.sortOrder, expectedUpdatedAt: f.updatedAt ?? undefined,
});
export const toDraftStory =(s: StoryRow, featureRef: string): StoryInput => ({
  id: s.id ?? undefined, clientKey: s.clientKey ?? undefined, featureId: featureRef, actor: s.actor.trim(), text: s.text.trim(),
  acceptanceCriteria: s.acceptanceCriteria, sortOrder: s.sortOrder, expectedUpdatedAt: s.updatedAt ?? undefined,
});

export function FeaturesSection({ ctx, version, editable, readOnlyReason, apply, onApplyHandled, drafting = false }: {
  ctx: ScopeContext;
  version: ScopeVersionRecord | null;
  editable: boolean;
  readOnlyReason: ReadOnlyReason;
  apply: ApplyRequest | null;
  onApplyHandled: () => void;
  /** the business analyst is drafting the features from the requirements: a calm waiting state instead of "No features yet" */
  drafting?: boolean;
}) {
  const features = useFeatures(ctx, version).data?.items ?? EMPTY;
  const stories = useStories(ctx, version).data?.items ?? EMPTY;
  const requirements: RequirementRecord[] = useRequirements(ctx).data?.items ?? EMPTY;
  const screens: DesignScreenRecord[] = useDesignScreens(ctx).data?.items ?? EMPTY;
  const autosave = useScopeAutosave(ctx, version);
  const canEdit = editable && ctx.can("requirements.edit");
  const t = useT();

  const [featureEdits, setFeatureEdits] = useState<Record<string, FeatureRow>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const [storyEdits, setStoryEdits] = useState<Record<string, StoryRow>>({});
  const [removedFeatures, setRemovedFeatures] = useState<ReadonlySet<string>>(new Set());
  const [removedStories, setRemovedStories] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [suggestText, setSuggestText] = useState("");
  const [refused, setRefused] = useState<string[]>([]);

  const state = autosave.status.state;
  // Once everything is saved the cache holds the server's rows again; the overlay is only for changes in flight.
  // A new row keeps its key (so its editor does not remount) but takes the server id once a save named it.
  useEffect(() => {
    setFeatureEdits((m) => {
      let changed = false;
      const next: Record<string, FeatureRow> = {};
      for (const [k, e] of Object.entries(m)) {
        const id = e.id === null && e.clientKey ? autosave.idFor(e.clientKey) : undefined;
        if (id) { next[k] = { ...e, id }; changed = true; } else next[k] = e;
      }
      return changed ? next : m;
    });
    setStoryEdits((m) => {
      let changed = false;
      const next: Record<string, StoryRow> = {};
      for (const [k, e] of Object.entries(m)) {
        const id = e.id === null && e.clientKey ? autosave.idFor(e.clientKey) : undefined;
        const featureId = autosave.idFor(e.featureId);
        if (id || featureId) { next[k] = { ...e, id: id ?? e.id, featureId: featureId ?? e.featureId }; changed = true; } else next[k] = e;
      }
      return changed ? next : m;
    });
  }, [state, features, stories]);
  // Once saved, only the overlay edits the cache already lists are dropped; an unsaved row (id null) is never dropped.
  useEffect(() => {
    if (state !== "saved") return;
    const featureIds = new Set(features.map((f) => f.id));
    const storyIds = new Set(stories.map((s) => s.id));
    const dropped: string[] = [];
    const keep = <T extends { id: string | null; key: string }>(m: Record<string, T>, ids: ReadonlySet<string>) => {
      const next: Record<string, T> = {};
      for (const [k, e] of Object.entries(m)) { if (e.id !== null && ids.has(e.id)) dropped.push(e.key); else next[k] = e; }
      return Object.keys(next).length === Object.keys(m).length ? m : next;
    };
    setFeatureEdits((m) => keep(m, featureIds));
    setStoryEdits((m) => keep(m, storyIds));
    const prune = (s: ReadonlySet<string>, ids: ReadonlySet<string>) => {
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    };
    setRemovedFeatures((s) => prune(s, featureIds));
    setRemovedStories((s) => prune(s, storyIds));
    setTouched((t) => {
      const next = new Set([...t].filter((k) => !dropped.includes(k)));
      return next.size === t.size ? t : next;
    });
  }, [state, features, stories]);
  useEffect(() => { setSuggestText(apply?.text ?? ""); }, [apply]);

  const rows = useMemo<FeatureRow[]>(() => {
    const out = new Map<string, FeatureRow>();
    const editIds = new Set(Object.values(featureEdits).map((e) => e.id).filter((id): id is string => id !== null));
    for (const f of features) {
      if (removedFeatures.has(f.id) || editIds.has(f.id)) continue;
      out.set(f.id, { key: f.id, id: f.id, clientKey: null, name: f.name, description: f.description, priority: f.priority,
        excludedReason: f.excludedReason ?? "", requirementIds: f.requirementIds, screenIds: f.screenIds, sortOrder: f.sortOrder, updatedAt: f.updatedAt });
    }
    for (const e of Object.values(featureEdits)) if (!removedFeatures.has(e.key)) out.set(e.key, e);
    return [...out.values()].sort(byOrder);
  }, [features, featureEdits, removedFeatures]);

  const storyRows = useMemo<StoryRow[]>(() => {
    const out = new Map<string, StoryRow>();
    const editIds = new Set(Object.values(storyEdits).map((e) => e.id).filter((id): id is string => id !== null));
    for (const s of stories) {
      if (removedStories.has(s.id) || editIds.has(s.id)) continue;
      out.set(s.id, { key: s.id, id: s.id, clientKey: null, featureId: s.featureId, actor: s.actor, text: s.text,
        acceptanceCriteria: s.acceptanceCriteria, sortOrder: s.sortOrder, updatedAt: s.updatedAt });
    }
    for (const e of Object.values(storyEdits)) if (!removedStories.has(e.key)) out.set(e.key, e);
    return [...out.values()].sort(byOrder);
  }, [stories, storyEdits, removedStories]);

  // A story's featureId is its feature's ItemId (or the clientKey of a feature that is not saved yet).
  const featureRef = (f: FeatureRow) => f.id ?? f.clientKey ?? f.key;
  /** saved feature id -> its stored Key (what a change request targets) */
  const changeKeys = useMemo(() => new Map(features.map((f) => [f.id, f.key])), [features]);
  const storiesOf = (f: FeatureRow) => storyRows.filter((s) => s.featureId === featureRef(f) || s.featureId === f.key);

  // Rows that are not saved yet count as known, so a story of a new feature passes the local check.
  const refs = useMemo(() => ({
    requirementIds: requirements.map((r) => r.id),
    screenIds: screens.map((x) => x.id),
    features: rows.map((f) => ({ id: featureRef(f) })),
    stories: storyRows.filter((x) => x.id).map((x) => ({ id: x.id as string, featureId: x.featureId })),
  }), [requirements, screens, rows, storyRows]);

  /** Local validation of a change; the same rules the function applies. */
  const check = (change: ScopeChangeInput): FieldIssue[] => validateScopeChange(change, refs, "save");
  const parentOf = (s: StoryRow) => rows.find((x) => x.key === s.featureId || featureRef(x) === s.featureId);

  /** Issues of the rows the person has touched, by row key (paths are 'upsertFeatures.<i>.<field>'). */
  const issueMap = useMemo(() => {
    const fs = rows.filter((r) => touched.has(r.key));
    const ss = storyRows.filter((x) => touched.has(x.key));
    const found = validateScopeChange({
      upsertFeatures: fs.map(toDraftFeature),
      upsertStories: ss.map((x) => { const f = parentOf(x); return toDraftStory(x, f ? featureRef(f) : x.featureId); }),
    }, refs, "save");
    const m = new Map<string, string[]>();
    for (const i of found) {
      const hit = /^upsert(Features|Stories)\.(\d+)\./.exec(i.path);
      const row = hit ? (hit[1] === "Features" ? fs : ss)[Number(hit[2])] : undefined;
      if (!row) continue;
      m.set(row.key, [...(m.get(row.key) ?? []), fieldIssueText(i)]);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, storyRows, touched, refs]);

  const conflictIds = autosave.conflicts;

  /** Queue a change unless it breaks a rule; a broken edit stays on screen with its reason until it is fixed. */
  const send = (change: ScopeChangeInput, flush = false) => {
    const issues = check(change);
    if (issues.length > 0) {
      const keys = [...(change.upsertFeatures ?? []), ...(change.upsertStories ?? [])].map((r) => r.id ?? r.clientKey);
      setTouched((t) => {
        const next = new Set(t);
        for (const k of keys) if (k) next.add(k);
        return next.size === t.size ? t : next;
      });
      setRefused([...new Set(issues.filter((i) => !ROW_PATH.test(i.path)).map(fieldIssueText))]);
      return;
    }
    setRefused((r) => (r.length === 0 ? r : []));
    autosave.queue(change);
    if (flush) void autosave.flush();
  };
  const touch = (key: string) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));

  const sendFeature = (f: FeatureRow, flush: boolean) => send({ upsertFeatures: [toDraftFeature(f)] }, flush);
  const sendStory = (s: StoryRow, flush: boolean) => {
    const f = parentOf(s);
    // A feature that is not saved yet travels with its story, so the function can resolve the clientKey.
    send({ ...(f && f.id === null ? { upsertFeatures: [toDraftFeature(f)] } : {}), upsertStories: [toDraftStory(s, f ? featureRef(f) : s.featureId)] }, flush);
  };

  const addFeature = (seed?: Partial<FeatureRow>): FeatureRow => {
    const ck = newKey();
    const f: FeatureRow = { key: ck, id: null, clientKey: ck, name: "", description: "", priority: "must", excludedReason: "", requirementIds: [],
      screenIds: [], sortOrder: nextOrder(rows), updatedAt: null, ...seed };
    setFeatureEdits((m) => ({ ...m, [f.key]: f }));
    setFocusKey(f.key);
    return f;
  };
  const fromRequirement = (r: RequirementRecord) => {
    const f = addFeature({ name: r.title.slice(0, NAME_MAX), requirementIds: [r.id] });
    touch(f.key);
    sendFeature(f, false);
    setPicking(false);
  };

  const changeFeature = (f: FeatureRow, patch: Partial<FeatureRow>, flush?: boolean) => {
    const next = { ...f, ...patch };
    setFeatureEdits((m) => ({ ...m, [next.key]: next }));
    touch(next.key);
    sendFeature(next, flush === true);
  };
  const moveFeature = (f: FeatureRow, dir: -1 | 1) => {
    const i = rows.findIndex((r) => r.key === f.key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const order = [...rows];
    [order[i], order[j]] = [order[j], order[i]];
    const changed = order.map((r, n) => ({ ...r, sortOrder: n })).filter((r, n) => order[n].sortOrder !== n || r.key === f.key);
    setFeatureEdits((m) => ({ ...m, ...Object.fromEntries(changed.map((r) => [r.key, r])) }));
    send({ upsertFeatures: changed.filter((r) => r.id || touched.has(r.key)).map(toDraftFeature) }, true);
  };
  const deleteFeature = (f: FeatureRow) => {
    const own = storiesOf(f);
    setRemovedFeatures((s) => new Set(s).add(f.key));
    setRemovedStories((s) => new Set([...s, ...own.map((x) => x.key)]));
    if (f.id) send({ removeFeatureIds: [f.id] }, true);
  };

  const addStory = (f: FeatureRow) => {
    const ck = newKey();
    const s: StoryRow = { key: ck, id: null, clientKey: ck, featureId: featureRef(f), actor: "", text: "", acceptanceCriteria: [],
      sortOrder: nextOrder(storiesOf(f)), updatedAt: null };
    setStoryEdits((m) => ({ ...m, [s.key]: s }));
  };
  const changeStory = (s: StoryRow, patch: Partial<StoryRow>, flush?: boolean) => {
    const next = { ...s, ...patch };
    setStoryEdits((m) => ({ ...m, [next.key]: next }));
    touch(next.key);
    sendStory(next, flush === true);
  };
  const moveStory = (f: FeatureRow, s: StoryRow, dir: -1 | 1) => {
    const list = storiesOf(f);
    const i = list.findIndex((x) => x.key === s.key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const order = [...list];
    [order[i], order[j]] = [order[j], order[i]];
    const changed = order.map((r, n) => ({ ...r, sortOrder: n })).filter((r, n) => list[n].key !== r.key);
    setStoryEdits((m) => ({ ...m, ...Object.fromEntries(changed.map((r) => [r.key, r])) }));
    send({ upsertStories: changed.filter((r) => r.id || touched.has(r.key)).map((r) => toDraftStory(r, featureRef(f))) }, true);
  };
  const deleteStory = (s: StoryRow) => {
    setRemovedStories((r) => new Set(r).add(s.key));
    if (s.id) send({ removeStoryIds: [s.id] }, true);
  };

  /** "Apply in the scope": the person reviews the suggested text, then it becomes a normal edit. */
  const applyTargetFeature = apply?.target
    ? rows.find((f) => (apply.target?.type === "feature" ? f.key === apply.target.id : storiesOf(f).some((s) => s.key === apply.target?.id)))
    : undefined;
  const useSuggestion = () => {
    if (!apply) return;
    const text = suggestText.trim();
    if (apply.target?.type === "story") {
      const s = storyRows.find((x) => x.key === apply.target?.id);
      if (s) changeStory(s, { text: text.slice(0, 500) }, true);
    } else if (apply.target?.type === "feature" && applyTargetFeature) {
      changeFeature(applyTargetFeature, { description: text.slice(0, 2000) }, true);
    } else {
      const f = addFeature({ name: text.split(/\r?\n/)[0].slice(0, NAME_MAX), description: text.slice(0, 2000) });
      touch(f.key);
      sendFeature({ ...f, name: f.name, description: f.description }, true);
    }
    onApplyHandled();
  };
  const suggestionPanel = apply ? (
    <div className="mb-3 rounded-block bg-surface p-4 ring-1 ring-line">
      <label htmlFor="scope-suggested-change"><Label>{t("analysis.scope.featuresSection.suggested", "Suggested change")}</Label></label>
      <Textarea id="scope-suggested-change" value={suggestText} rows={3} onChange={(e) => setSuggestText(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={suggestText.trim() === ""} onClick={useSuggestion}>{t("analysis.scope.featuresSection.useText", "Use this text")}</Button>
        <Button size="sm" variant="ghost" onClick={onApplyHandled}>{t("analysis.scope.featuresSection.discard", "Discard")}</Button>
      </div>
    </div>
  ) : null;

  const usedRequirements = rows.flatMap((f) => f.requirementIds);
  const requirementCodes = new Map(requirements.map((r) => [r.id, r.code]));
  const storyIssues = (f: FeatureRow) => new Map(storiesOf(f).map((x) => [x.key, issueMap.get(x.key) ?? []] as const));
  const failed = state === "error";

  return (
    <Card title={<>{t("analysis.scope.features", "Features")} <span className="num text-ink3">{rows.length}</span></>}
      action={canEdit ? (
        // wraps on a phone instead of pushing the page wider than the screen
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="ghost" icon={<FileText size={14} strokeWidth={1.75} aria-hidden />} aria-expanded={picking} onClick={() => setPicking((p) => !p)}>{t("analysis.scope.featuresSection.addFromReq", "Add from requirements")}</Button>
          <Button size="sm" variant="secondary" icon={<Plus size={14} strokeWidth={1.75} aria-hidden />} onClick={() => addFeature()}>{t("analysis.scope.featuresSection.addFeature", "Add a feature")}</Button>
        </div>
      ) : undefined}>
      <div ref={listRef} className="contents">
      <div role="status" aria-live="polite" className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-ink3">
        {saveStatusText(autosave.status)}
        {failed && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />} onClick={() => void autosave.retry()}>{t("analysis.scope.retry", "Retry")}</Button>
        )}
      </div>
      {refused.length > 0 && (
        <ul role="alert" className="mb-3 space-y-0.5 text-[13px] text-[rgb(var(--c-danger-text))]">
          {refused.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      {!canEdit && readOnlyText(readOnlyReason) && <p className="mb-3 text-[13px] text-ink2">{readOnlyText(readOnlyReason)}</p>}
      {!ctx.can("requirements.edit") && <ViewOnlyNote id="scope-features-viewonly" text={VIEWER_TIP} className="mb-3" />}
      {canEdit && picking && (
        <div className="mb-4"><AddFromRequirements requirements={requirements} usedRequirementIds={usedRequirements} onChoose={fromRequirement} /></div>
      )}
      {canEdit && apply && !applyTargetFeature && suggestionPanel}
      {rows.length === 0 && drafting ? (
        <EmptyState icon={<LoaderCircle size={26} strokeWidth={1.75} aria-hidden className="animate-spin motion-reduce:animate-none" />}
          title={t("analysis.scope.featuresSection.draftingTitle", "Your business analyst is drafting the features.")}
          text={t("analysis.scope.featuresSection.draftingText", "Features, user stories and milestones come from the approved requirements. They appear here in a moment, ready for you to review.")} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("analysis.scope.noFeaturesYetDot", "No features yet.")} text={canEdit ? t("analysis.scope.featuresSection.emptyHint", "Add the first feature, or start from the requirements.") : undefined}
          action={canEdit ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => addFeature()}>{t("analysis.scope.featuresSection.addFeature", "Add a feature")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>{t("analysis.scope.featuresSection.addFromReq", "Add from requirements")}</Button>
            </div>
          ) : undefined} />
      ) : (
        <ul aria-label={t("analysis.scope.features", "Features")} className="space-y-3">
          {rows.map((f, i) => (
            <FeatureEditor key={f.key} feature={f} stories={storiesOf(f)} editable={canEdit} first={i === 0} last={i === rows.length - 1}
              screens={screens} requirementCodes={requirementCodes} issues={issueMap.get(f.key) ?? []} storyIssues={storyIssues(f)}
              conflicted={f.id !== null && conflictIds.has(f.id)} conflictedStories={conflictIds}
              suggestion={canEdit && apply && applyTargetFeature?.key === f.key ? suggestionPanel : undefined}
              autoFocus={focusKey === f.key} changeKey={f.id ? changeKeys.get(f.id) ?? null : null}
              onChange={(p, fl) => changeFeature(f, p, fl)} onBlur={() => void autosave.flush()} onMove={(d) => moveFeature(f, d)}
              onDelete={() => deleteFeature(f)} onReload={(id) => void autosave.reload(id)}
              onStoryAdd={() => addStory(f)} onStoryChange={changeStory} onStoryMove={(s, d) => moveStory(f, s, d)} onStoryDelete={deleteStory} />
          ))}
        </ul>
      )}
      </div>
    </Card>
  );
}
