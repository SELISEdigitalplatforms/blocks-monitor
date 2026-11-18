/** The build as one track per stage: the multi-track timeline, the selected stage's inspector and its proof. The
 *  inspector follows the live stage until a stage is picked; a linked stage (?stage=test, the Projects page's Tests link)
 *  counts as picked until the person picks another or follows the live stage. Without a dated build job there is
 *  nothing to draw: the tracks stay empty and say why instead of drawing an invented clip. While the recorded build is
 *  replayed, `focus` and `window` are the records as they stood at the replay clock. */
import { useEffect, useRef, useState } from "react";
import type { StageState } from "@/madp/data/pipeline";
import type { StageId } from "@/madp/data/types";
import type { DeliveryTicket } from "@/madp/blocks/delivery/types";
import {
  focusName, focusStage, proofEntries, sendBacks, stageClips, stageCounts, workItems, type BuildFocus, type BuildWindow,
} from "./model";
import { Inspector } from "./Inspector";
import { ProofDrawer } from "./ProofDrawer";
import { STAGE_EMPTY_NOTE } from "./buildTabs";
import { EmptyTimeline, Timeline } from "./Timeline";
import { useT } from "@/madp/i18n";

export interface TimelineViewProps {
  focus: BuildFocus;
  window: BuildWindow | null;
  stages: StageState[];
  ticketCode: (t: DeliveryTicket) => string;
  columnName: (c: string) => string;
  /** the window's playhead is the replay clock */
  replaying?: boolean;
  /** the stage a link opened on: shown instead of the live stage until the person picks another or follows live */
  linkedStage?: StageId | null;
  /** the person picked a stage or followed the live one, so the linked stage no longer applies */
  onUnlink?: () => void;
  /** the linked stage, scrolled into view and lit for a moment (useLitStage) */
  lit?: StageId | null;
}

/** How long a linked stage stays lit. */
const LIT_MS = 1800;

/** A linked stage is lit once, when the timeline is ready to show it, for LIT_MS; a new link lights again. Kept by the
 *  page (the timeline remounts per build shown). */
export function useLitStage(linked: StageId | null, ready: boolean): StageId | null {
  const [lit, setLit] = useState<StageId | null>(null);
  const done = useRef<StageId | null>(null);
  useEffect(() => {
    if (!linked) {
      done.current = null;
      setLit(null);
      return;
    }
    if (!ready || done.current === linked) return;
    done.current = linked;
    setLit(linked);
  }, [linked, ready]);
  useEffect(() => {
    if (!lit) return;
    const t = window.setTimeout(() => setLit(null), LIT_MS);
    return () => window.clearTimeout(t);
  }, [lit]);
  return lit;
}

/** The inspector sits beside the timeline from 2xl; below that the timeline keeps the full width (its clips need the
 *  room) and the inspector lays out in two columns under it. */
export function TimelineView({ focus, window: w, stages, ticketCode, columnName, replaying = false, linkedStage = null, onUnlink, lit = null }: TimelineViewProps) {
  const [picked, setPicked] = useState<StageId | null>(linkedStage);
  useEffect(() => { if (linkedStage) setPicked(linkedStage); }, [linkedStage]);
  const pick = (id: StageId | null) => {
    setPicked(id);
    if (linkedStage) onUnlink?.();
  };
  const t = useT();
  const [proof, setProof] = useState<StageId | null>(null);
  const name = focusName(focus);
  const subtitle = name ? t("build.timeline.subtitleNamed", "{name} · one track per agent", { name }) : t("build.timeline.subtitle", "One track per agent");

  if (!focus.job || !w) {
    return (
      <EmptyTimeline title={focus.job ? t("build.timeline.notStarted", "The build has not started yet") : t("build.timeline.noBuild", "No build has run yet")}
        subtitle={subtitle}
        text={focus.job ? t("build.timeline.startsSoon", "The tracks start as soon as the build starts.") : t("build.timeline.startHint", "Start the next milestone's build. Each stage gets its own track as the tickets move through it.")}
        selected={picked} lit={lit} note={picked ? STAGE_EMPTY_NOTE[picked] ?? null : null} />
    );
  }

  const focusId = focusStage(stages);
  const stageId = picked ?? focusId;
  const status = stages.find((s) => s.id === stageId)?.status ?? "planned";
  const backs = sendBacks(focus, w);
  const proofList = proofEntries(focus, stageId);
  const clips = stageClips(focus, w);
  const emptyNote = STAGE_EMPTY_NOTE[stageId];
  const note = emptyNote && proofList.length === 0 && !clips.some((c) => c.stage === stageId) ? { stage: stageId, text: emptyNote } : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <Timeline window={w} stages={stages} clips={clips} backs={backs} tickets={focus.tickets}
        ticketCode={ticketCode} columnName={columnName} lit={lit} note={note}
        selected={stageId} onSelect={(id) => pick(id === focusId && picked === null ? null : id)} subtitle={subtitle} replaying={replaying} />
      <Inspector stageId={stageId} status={status} counts={stageCounts(focus, stageId)} focus={focus} window={w}
        items={workItems(focus, stageId, status)} proof={proofList} backs={backs} ticketCode={ticketCode} columnName={columnName}
        following={picked === null} onFollow={() => pick(null)} onOpenProof={setProof} />
      <ProofDrawer stageId={proof} entries={proof ? proofEntries(focus, proof) : []}
        final={proof !== null && stages.find((s) => s.id === proof)?.status === "done"} window={w}
        ticketCode={ticketCode} columnName={columnName} onClose={() => setProof(null)} />
    </div>
  );
}
