/** The film's other layers: captions while walking, the place's title as you arrive, the drop target for files, the
 *  optional transcript (hidden by default) and the journey tracker. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileUp, X } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import { STAGES, STAGE_ORDER } from "../journey/places";
import { useJourney } from "../journey/store";
import { projectAtRest } from "../world/viewport";
import { useReveal } from "./stream";
import { GUIDE_NAME, GuideAvatar } from "./Avatar";

export function Captions() {
  useT();
  const line = useJourney((s) => s.line);
  const walk = useJourney((s) => s.walk);
  const { text, caret } = useReveal(line && walk ? line : null);
  if (!line || !walk) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center px-10">
      <p key={line.id} className="cine-caption-line cine-rise">
        <span className="mr-2 text-white/60">{GUIDE_NAME[line.who]}</span>
        <span ref={text} />
        <span ref={caret} className="cine-caret cine-caret-light" />
      </p>
    </div>
  );
}

export function PlaceTitle() {
  useT();
  const stage = useJourney((s) => s.stage);
  const phase = useJourney((s) => s.phase);
  const walk = useJourney((s) => s.walk);
  if (phase !== "journey" || walk) return null;
  return (
    <div key={stage} className="cine-caption pointer-events-none absolute left-12 top-28 select-none">
      <div className="text-[12.5px] font-medium uppercase tracking-[0.18em] text-ink3">{STAGES[stage].kicker}</div>
      <div className="text-[44px] font-medium leading-none tracking-[-0.03em] text-ink">{STAGES[stage].label}</div>
    </div>
  );
}

type Drag = "off" | "page" | "target";
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** While the files question is open, dragging files over the stage lights up the meeting room's wall screen as the
 *  drop target. A drop anywhere on the stage answers with the dropped files (the same answer as "Add files"): in the
 *  real office they are uploaded to the project; the files card follows their real upload. Files dropped at any other moment are refused, so the
 *  browser never opens one in place of the visit. The target ([data-cine-drop], its value off / page / target) is in
 *  the page while the question is open; drag events are taken on the window, wherever they are dispatched. */
export function DropZone({ aspect }: { aspect: number }) {
  const t = useT();
  const live = useJourney((s) => s.askId === "files" && s.ask !== null && s.walk === null);
  const [drag, setDrag] = useState<Drag>("off");
  const target = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDrag("off");
    let depth = 0;
    const where = (e: DragEvent): Drag => {
      const r = target.current?.getBoundingClientRect();
      return r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? "target" : "page";
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (live) setDrag(where(e));
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = live ? "copy" : "none";
      if (!live) return;
      depth = Math.max(depth, 1);
      setDrag(where(e));
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // leaving the window ends the drag even when the enter/leave pairs did not balance
      const out = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
      depth = out ? 0 : Math.max(0, depth - 1);
      if (depth === 0) setDrag("off");
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDrag("off");
      const files = Array.from(e.dataTransfer?.files ?? []);
      const s = useJourney.getState();
      if (live && files.length && s.askId === "files" && s.ask) s.answerFiles(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [live]);

  // the wall screen (with its bezel) as seen from the meeting room's resting view, in % of the stage
  const box = useMemo(() => {
    const a = projectAtRest("meeting", [10.5 - 1.85, 2.2 + 0.95, -5.95], aspect);
    const b = projectAtRest("meeting", [10.5 + 1.85, 2.2 - 0.95, -5.95], aspect);
    return { left: a.x - 1, top: a.y - 1.6, width: b.x - a.x + 2, height: b.y - a.y + 3.2 };
  }, [aspect]);

  if (!live) return null;
  const on = drag !== "off";
  return (
    <>
      <div aria-hidden className={cn("cine-drop-dim pointer-events-none absolute inset-0", on && "is-on")} />
      <div
        ref={target}
        data-cine-drop={drag}
        aria-hidden={!on}
        className={cn("cine-drop pointer-events-none absolute", on && "is-on", drag === "target" && "is-over")}
        style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
      >
        <div className="flex flex-col items-center text-center">
          <span className="cine-drop-badge"><FileUp size={30} strokeWidth={1.75} aria-hidden /></span>
          <div className="mt-4 text-[30px] font-medium leading-none tracking-[-0.02em]">{t("studio.cinematic.drop.title", "Drop your files")}</div>
          <div className="mt-2.5 text-[16px] text-white/75">{t("studio.cinematic.drop.text", "They go straight up on the screen.")}</div>
        </div>
      </div>
    </>
  );
}

export function Transcript() {
  const t = useT();
  const open = useJourney((s) => s.transcript);
  const setOpen = useJourney((s) => s.setTranscript);
  const messages = useJourney((s) => s.messages);
  const phase = useJourney((s) => s.phase);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages, open]);
  if (phase === "intro") return null;
  return (
    <>
      <aside
        aria-label={t("studio.cinematic.transcript.title", "Transcript")}
        aria-hidden={!open}
        className={cn("cine-card pointer-events-auto absolute bottom-32 right-6 top-24 flex w-[360px] flex-col overflow-hidden transition-[opacity,transform] duration-500", open ? "opacity-100" : "pointer-events-none translate-x-8 opacity-0")}
      >
        <div className="flex items-center justify-between border-b border-ink/5 px-4 py-3">
          <span className="text-[14px] font-semibold text-ink">{t("studio.cinematic.transcript.title", "Transcript")}</span>
          <button type="button" aria-label={t("studio.cinematic.transcript.close", "Close the transcript")} onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded-full text-ink3 hover:bg-ink/5 hover:text-ink"><X size={15} /></button>
        </div>
        <div ref={list} className="cine-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.map((m) => m.from === "user" ? (
            <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3 py-1.5 text-[13px] text-white">{m.text}</div></div>
          ) : (
            <div key={m.id} className="flex gap-2">
              <GuideAvatar who={m.from} size={24} />
              <div className="min-w-0 text-[13px] leading-snug text-ink"><div className="text-[11px] text-ink3">{GUIDE_NAME[m.from]}</div>{m.text}</div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

export function StepTracker() {
  const t = useT();
  const stage = useJourney((s) => s.stage);
  const done = useJourney((s) => s.done);
  const phase = useJourney((s) => s.phase);
  return (
    <nav aria-label={t("studio.cinematic.tracker.label", "The visit")} className={cn("cine-pill pointer-events-auto px-1.5 py-1.5 transition-opacity duration-700", phase === "intro" ? "opacity-0" : "opacity-100")}>
      <ol className="flex items-center">
        {STAGE_ORDER.map((id, i) => {
          const here = id === stage;
          const past = Boolean(done[id]) && !here;
          return (
            <li key={id} className="flex items-center">
              {i > 0 && <span aria-hidden className={cn("mx-1 h-px w-6 transition-colors duration-700", past || here ? "bg-ink/40" : "bg-ink/10")} />}
              <span aria-current={here ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-500", here ? "bg-ink text-white" : past ? "text-ink" : "text-ink3")}>
                {past && <Check size={12} strokeWidth={3} className="text-success" aria-hidden />}
                {STAGES[id].label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
